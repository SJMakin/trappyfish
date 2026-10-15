import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Chess, type Color } from 'chess.js';
import { NodeUci } from '../benchmarks/node-uci';
import { NodeMaiaPolicy } from './maia-node';
import { TrappyEngine, DEFAULT_TRAPPY_SETTINGS, moveToUci, normalizePolicy, playUci,
  type CandidateInfo, type MoveDecision, type PolicyMove } from '../src/engine/trappy';

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1] ?? fallback;
};
const maxPlies = Number(arg('--plies', '12'));
assert.ok(Number.isInteger(maxPlies) && maxPlies >= 2 && maxPlies <= 24, 'Use 2–24 plies for this bounded smoke.');
const outputPath = resolve(arg('--output', 'artifacts/benchmarks/review/maia-game.json'));
const settings = { ...DEFAULT_TRAPPY_SETTINGS };
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex').toUpperCase();
const uci = new NodeUci();
const maia = new NodeMaiaPolicy();
const engine = new TrappyEngine(uci, maia);
const startedAt = Date.now();

type PlyRecord = {
  ply: number; side: Color; player: 'engine' | 'maia1000'; fenBefore: string; fenAfter: string;
  move: string; san: string; oracleCpBefore: number; oracleCpAfter: number; materialAfter: Material;
  elapsedMs: number; maiaProbability?: number; maiaRank?: number; randomDraw?: number;
  decision?: ReturnType<typeof summarize>;
};
type Material = { white: number; black: number; engineBalance: number; units: 'centipawns, P100/N300/B300/R500/Q900' };
type GameRecord = {
  engineColor: Color; seed: number; startFen: string; finalFen: string; startOracleCp: number; endOracleCp: number;
  startMaterial: Material; endMaterial: Material; stop: string; pgn: string; plies: PlyRecord[]; elapsedMs: number;
};
const report = {
  purpose: 'Two bounded starting-position integration games; not a win-rate or Elo measurement.',
  startedAt: new Date(startedAt).toISOString(), finishedAt: '', settings, maxPlies,
  opponentPolicy: 'Actual Maia-3 1000 vs 2400 legal distribution, seeded inverse-CDF sampling; fixed seeds chosen before observing outcomes.',
  randomGenerator: '32-bit LCG: state = (1664525*state + 1013904223) mod 2^32; draw = state/2^32.',
  oracle: 'Actual Stockfish 18 lite single-thread WASM, cold hash depth12 MultiPV1 after every ply; fixed engine-color POV.',
  productionSha256: hash(await readFile('src/engine/trappy.ts')),
  maiaModelSha256: hash(await readFile('public/maia/maia3-5m.onnx')),
  stockfishWasmSha256: hash(await readFile('node_modules/stockfish/bin/stockfish-18-lite-single.wasm')),
  games: [] as GameRecord[], analyses: 0, elapsedMs: 0,
};

function material(board: Chess, engineColor: Color): Material {
  const values = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
  let white = 0;
  let black = 0;
  for (const rank of board.board()) for (const piece of rank) if (piece) {
    if (piece.color === 'w') white += values[piece.type];
    else black += values[piece.type];
  }
  return { white, black, engineBalance: (white - black) * (engineColor === 'w' ? 1 : -1),
    units: 'centipawns, P100/N300/B300/R500/Q900' };
}
async function oracle(board: Chess, engineColor: Color): Promise<number> {
  if (board.isGameOver()) return board.isCheckmate() ? (board.turn() === engineColor ? -100_000 : 100_000) : 0;
  const result = await uci.analyzeFen(board.fen(), 12, 1);
  assert.ok(result.lines.length, 'Stockfish oracle must score the live position.');
  return result.lines[0].score.cp * (board.turn() === engineColor ? 1 : -1);
}
function summarize(decision: MoveDecision) {
  const slim = (candidate: CandidateInfo) => ({ move: candidate.move, san: candidate.san,
    objectiveCp: candidate.rootScoreCp, expectedScore: candidate.expectedScore, adjustedCp: candidate.adjustedScoreCp,
    riskCp: candidate.riskCp, mistakeProbability: candidate.mistakeProbability, policyCoverage: candidate.policyCoverage });
  return { mode: decision.mode, policySource: decision.policySource, warning: decision.warning,
    rootBestMove: decision.rootBestMove, rootBestSan: decision.rootBestSan, rootBestScoreCp: decision.rootBestScoreCp,
    selected: decision.selected, candidates: decision.candidates.map(slim) };
}
function sample(distribution: PolicyMove[], randomDraw: number): { reply: PolicyMove; rank: number } {
  let mass = 0;
  for (let index = 0; index < distribution.length; index++) {
    mass += distribution[index].probability;
    if (randomDraw < mass || index === distribution.length - 1) return { reply: distribution[index], rank: index + 1 };
  }
  throw new Error('Cannot sample an empty Maia distribution.');
}
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x1_0000_0000; };
}
async function save() {
  report.analyses = uci.analyses;
  report.elapsedMs = Date.now() - startedAt;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
}

try {
  for (const [engineColor, seed] of [['w', 20261013], ['b', 20261014]] as const) {
    const began = Date.now();
    const draw = random(seed);
    const board = new Chess();
    let currentCp = await oracle(board, engineColor);
    const game: GameRecord = { engineColor, seed, startFen: board.fen(), finalFen: board.fen(),
      startOracleCp: currentCp, endOracleCp: currentCp, startMaterial: material(board, engineColor),
      endMaterial: material(board, engineColor), stop: 'ply cap', pgn: '', plies: [], elapsedMs: 0 };
    report.games.push(game);
    for (let ply = 1; ply <= maxPlies && !board.isGameOver(); ply++) {
      const moveStarted = Date.now();
      const fenBefore = board.fen();
      const side = board.turn();
      const row: PlyRecord = { ply, side, player: side === engineColor ? 'engine' : 'maia1000',
        fenBefore, fenAfter: '', move: '', san: '', oracleCpBefore: currentCp, oracleCpAfter: 0,
        materialAfter: material(board, engineColor), elapsedMs: 0 };
      if (side === engineColor) {
        const decision = await engine.chooseMove(fenBefore, settings, true);
        assert.equal(decision.warning, undefined, 'Real-play analysis must not fall back on a model failure.');
        const provenMate = decision.rootBestScoreCp >= 90_000;
        assert.ok(decision.policySource === 'maia' || (provenMate && decision.policySource === 'stockfish'),
          'Nonterminal practical decisions must use real Maia.');
        if (provenMate) assert.ok(decision.selected.rootScoreCp >= 90_000, 'Preserve a known forced mate.');
        const riskLimit = decision.rootBestScoreCp >= 500 ? Math.min(settings.maxRiskCp, 40) : settings.maxRiskCp;
        assert.ok(decision.selected.riskCp >= 0 && decision.selected.riskCp <= riskLimit + 1e-8,
          `Selected move exceeds the objective risk limit: ${decision.selected.riskCp}cp.`);
        assert.ok(Number.isFinite(decision.selected.expectedScore) && decision.selected.expectedScore >= 0
          && decision.selected.expectedScore <= 1, 'Expected utility must be bounded.');
        assert.ok(decision.selected.mistakeProbability === undefined || (decision.selected.mistakeProbability >= 0
          && decision.selected.mistakeProbability <= 1 + 1e-8), 'Modeled mistake probability must be bounded.');
        row.move = decision.move;
        row.decision = summarize(decision);
      } else {
        const legal = new Map(board.moves({ verbose: true }).map((move) => [moveToUci(move), move]));
        const distribution = normalizePolicy(await maia.predict(fenBefore, settings.opponentRating, settings.engineRating), legal);
        row.randomDraw = draw();
        const selected = sample(distribution, row.randomDraw);
        row.move = selected.reply.move;
        row.maiaProbability = selected.reply.probability;
        row.maiaRank = selected.rank;
      }
      const played = playUci(board, row.move);
      assert.ok(played, `Illegal game move ${row.move}.`);
      row.san = played.san;
      row.fenAfter = board.fen();
      currentCp = await oracle(board, engineColor);
      row.oracleCpAfter = currentCp;
      row.materialAfter = material(board, engineColor);
      row.elapsedMs = Date.now() - moveStarted;
      game.plies.push(row);
      game.finalFen = board.fen();
      game.endOracleCp = currentCp;
      game.endMaterial = row.materialAfter;
      game.pgn = board.pgn();
      game.elapsedMs = Date.now() - began;
      if (board.isGameOver()) game.stop = board.isCheckmate() ? 'checkmate' : 'draw';
      await save();
      console.log(`engine=${engineColor} ply=${ply} ${row.player} ${row.san} oracle=${currentCp}cp risk=${row.decision?.selected.riskCp ?? '-'} ${row.elapsedMs}ms`);
    }
  }
  report.finishedAt = new Date().toISOString();
  await save();
  assert.equal(report.productionSha256, hash(await readFile('src/engine/trappy.ts')), 'Production engine changed during real-play evidence collection.');
  console.log(`PASS ${report.games.length} bounded real Maia games; ${report.games.reduce((sum, game) => sum + game.plies.length, 0)} legal plies; no model fallback.`);
  console.log(outputPath);
} finally {
  uci.terminate();
  await maia.terminate();
}
