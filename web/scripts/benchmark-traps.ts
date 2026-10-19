import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Chess } from 'chess.js';
import { TrappyEngine as LegacyEngine, DEFAULT_TRAPPY_SETTINGS, playUci, moveToUci } from '../benchmarks/legacy-trappy';
import { NodeUci } from '../benchmarks/node-uci';
import { TRAP_POSITIONS } from '../benchmarks/trap-positions';

const arg = (key: string, fallback: string) => {
  const index = process.argv.indexOf(key);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const depth = Number(arg('--depth', '8'));
const phase = arg('--phase', 'compare');
const ids = arg('--positions', '').split(',').filter(Boolean);
const positions = TRAP_POSITIONS.filter((position) => !ids.length || ids.includes(position.id));
if (!positions.length) throw new Error(`No fixtures match --positions ${ids.join(',')}.`);
const outputPath = resolve(arg('--output', `benchmarks/results/${phase}-depth${depth}.json`));
const legacySettings = { ...DEFAULT_TRAPPY_SETTINGS, rootDepth: depth, trapDepth: depth };
const practicalSettings = {
  rootDepth: depth, trapDepth: depth, candidateCount: 10, replyCount: 10,
  aggression: 1, maxRiskCp: 100, opponentRating: 1500, engineRating: 2000, replyCoverage: 0.95,
};
const originalHash = 'F599E54ED4443BB5260FA617AE745344B32F5272F9DDD81A88BE76138B08AB28';
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex').toUpperCase();
const productionHashAtStart = hash(await readFile('src/engine/trappy.ts'));
const report: Record<string, unknown> & { positions: unknown[] } = {
  phase, startedAt: new Date().toISOString(), depth,
  engine: 'Stockfish 18 lite single-thread WASM (stockfish npm 18.0.8)',
  stockfishWasmSha256: hash(await readFile('node_modules/stockfish/bin/stockfish-18-lite-single.wasm')),
  originalSourceSha256: originalHash,
  frozenLegacySha256: hash(await readFile('benchmarks/legacy-trappy.ts')),
  productionHashAtStart,
  sourceWasUnchangedAtStart: productionHashAtStart === originalHash,
  legacySettings, practicalSettings,
  positions: [],
};
const uci = new NodeUci();
let maia: any;
let PracticalEngine: any;
if (phase !== 'baseline') {
  const maiaModule = await import('./maia-node');
  const practicalModule = phase === 'production' ? await import('../src/engine/trappy') : await import('../benchmarks/practical');
  maia = new maiaModule.NodeMaiaPolicy();
  PracticalEngine = practicalModule.PracticalEngine ?? practicalModule.TrappyEngine;
  report.maiaModelSha256 = hash(await readFile('public/maia/maia3-5m.onnx'));
  report.practicalSourceSha256 = hash(await readFile(phase === 'production' ? 'src/engine/trappy.ts' : 'benchmarks/practical.ts'));
}

async function save() {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

try {
  for (const fixture of positions) {
    const startedAt = Date.now();
    const legacy = await new LegacyEngine(uci.asClient()).chooseMove(fixture.fen, legacySettings, true);
    const row: Record<string, unknown> = { ...fixture, legacy, elapsedMs: Date.now() - startedAt };
    if (phase !== 'baseline') {
      const liveSettings = phase === 'production'
        ? { ...practicalSettings, trappiness: practicalSettings.aggression, aggression: 0, tension: 0 }
        : practicalSettings;
      const practical = await new PracticalEngine(uci.asClient(), maia).chooseMove(fixture.fen, liveSettings, true);
      if (practical.policySource !== 'maia' && !new Chess(fixture.fen).moves({ verbose: true }).some((move) => {
        const board = new Chess(fixture.fen); board.move(move); return board.isCheckmate();
      })) throw new Error(`Real Maia policy was not used: ${practical.policySource}`);
      if (practical.selected.riskCp > practicalSettings.maxRiskCp + 1e-8) {
        throw new Error(`Selected move exceeds the hard risk limit: ${practical.selected.riskCp}cp.`);
      }
      if (!Number.isFinite(practical.selected.expectedScore) || practical.selected.expectedScore < 0 || practical.selected.expectedScore > 1) {
        throw new Error(`Invalid bounded expected score: ${practical.selected.expectedScore}.`);
      }
      row.practical = practical;
      row.legacyCommonOracle = await commonOracle(fixture.fen, legacy.move);
      row.practicalCommonOracle = legacy.move === practical.move ? row.legacyCommonOracle : await commonOracle(fixture.fen, practical.move);
      if (fixture.candidate) {
        const board = new Chess(fixture.fen);
        const candidate = moveToUci(board.move(fixture.candidate));
        row.namedTrapOracle = candidate === legacy.move ? row.legacyCommonOracle : candidate === practical.move ? row.practicalCommonOracle : await commonOracle(fixture.fen, candidate);
        const predictedReplies = await maia.predict(board.fen(), practicalSettings.opponentRating, practicalSettings.engineRating);
        if (fixture.temptingReply) {
          const reply = moveToUci(board.move(fixture.temptingReply));
          row.namedReplyProbability = predictedReplies.find((value: any) => value.move === reply)?.probability ?? 0;
          row.namedReplyRank = predictedReplies.findIndex((value: any) => value.move === reply) + 1;
        }
      }
    }
    row.elapsedMs = Date.now() - startedAt;
    report.positions.push(row);
    await save();
    console.log(`${fixture.id}: legacy=${legacy.san} practical=${(row.practical as any)?.san ?? '-'} ${Math.round(Number(row.elapsedMs) / 1000)}s`);
  }
  report.finishedAt = new Date().toISOString();
  report.productionHashAtEnd = hash(await readFile('src/engine/trappy.ts'));
  report.analyses = uci.analyses;
  await save();
  console.log(outputPath);
} finally {
  uci.terminate();
  await maia?.terminate();
}

/** A shared, cold-hash oracle, independent of either selector's candidate shortlist. */
async function commonOracle(fen: string, candidate: string) {
  const board = new Chess(fen);
  if (!playUci(board, candidate)) throw new Error(`Illegal selected move ${candidate}`);
  const selectedSan = board.history().at(-1);
  if (board.isGameOver()) return { move: candidate, san: selectedSan, objectiveScore: board.isCheckmate() ? 1 : 0.5, expectedScore: board.isCheckmate() ? 1 : 0.5, coverage: 1, replies: [] };
  const forced = await uci.analyzeFen(fen, depth, 1, [candidate]);
  const rootCp = forced.lines[0]?.score.cp;
  if (rootCp === undefined) throw new Error('Missing forced root score');
  const defense = await uci.analyzeFen(board.fen(), depth - 1, 1);
  const objectiveCp = -defense.lines[0].score.cp;
  const objectiveScore = sigmoid(objectiveCp);
  const policy = await maia.predict(board.fen(), practicalSettings.opponentRating, practicalSettings.engineRating);
  const legal = new Set(board.moves({ verbose: true }).map(moveToUci));
  const sorted = policy.filter((value: any) => legal.has(value.move)).sort((a: any, b: any) => b.probability - a.probability);
  const chosen: any[] = [];
  let coverage = 0;
  for (const reply of sorted) {
    if (coverage >= practicalSettings.replyCoverage || chosen.length >= practicalSettings.replyCount) break;
    chosen.push(reply);
    coverage += reply.probability;
  }
  if (!chosen.some((reply) => reply.move === defense.bestMove)) {
    const best = sorted.find((reply: any) => reply.move === defense.bestMove);
    if (best) { chosen.push(best); coverage += best.probability; }
  }
  let expectedScore = Math.max(0, 1 - coverage) * objectiveScore;
  const replies: any[] = [];
  for (const reply of chosen) {
    const copy = new Chess(board.fen());
    const move = playUci(copy, reply.move)!;
    let outcomeScore: number;
    let outcomeCp: number;
    if (copy.isGameOver()) {
      outcomeScore = copy.isCheckmate() ? 0 : 0.5;
      outcomeCp = copy.isCheckmate() ? -100000 : 0;
    } else {
      const analysis = reply.move === defense.bestMove ? defense : await uci.analyzeFen(board.fen(), depth - 1, 1, [reply.move]);
      outcomeCp = -analysis.lines[0].score.cp;
      // At finite depth a forced branch can appear slightly below minimax; be conservative and retain the raw value.
      outcomeScore = sigmoid(outcomeCp);
    }
    expectedScore += reply.probability * outcomeScore;
    replies.push({ move: reply.move, san: move.san, probability: reply.probability, outcomeCp, outcomeScore });
  }
  return { move: candidate, san: selectedSan, rootCp, objectiveCp, objectiveScore, expectedScore, coverage, residualProbability: Math.max(0, 1 - coverage), replies };
}

function sigmoid(cp: number) { return 1 / (1 + Math.exp(-cp / 200)); }
