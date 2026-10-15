import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Chess } from 'chess.js';
import { TrappyEngine as BaselineEngine, DEFAULT_TRAPPY_SETTINGS as BASELINE_SETTINGS, playUci, moveToUci, cpToExpectedScore } from '../benchmarks/review/baseline-trappy';
import { NodeUci } from '../benchmarks/node-uci';
import { TRAP_POSITIONS } from '../benchmarks/trap-positions';
import { NodeMaiaPolicy } from './maia-node';

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1] ?? fallback;
};
const mode = arg('--mode', 'baseline');
const oracleEngineRating = Number(arg('--oracle-engine', mode === 'compare' || mode === 'production' ? '2400' : '2000'));
const output = resolve(arg('--output', `benchmarks/review/${mode}.json`));
const ids = arg('--positions', '').split(',').filter(Boolean);
const discoveryBoard = new Chess();
for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O']) discoveryBoard.move(san);
const discoveryPosition = { id: 'fishing-pole-discovery', name: 'Fishing Pole before Ng4', fen: discoveryBoard.fen(),
  setup: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O'], candidate: 'Ng4', temptingReply: 'h3',
  continuation: ['h5', 'hxg4', 'hxg4'], caution: 'Discovery sensitivity probe; no opening-specific production condition.' };
const positions = (mode === 'discovery' ? [discoveryPosition] : TRAP_POSITIONS)
  .filter((fixture) => !ids.length || ids.includes(fixture.id));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const uci = new NodeUci();
const maia = new NodeMaiaPolicy();
const report: any = {
  mode, startedAt: new Date().toISOString(), baselineSourceSha256: hash(await readFile('benchmarks/review/baseline-trappy.ts')),
  productionSourceSha256AtStart: hash(await readFile('src/engine/trappy.ts')),
  modelSha256: hash(await readFile('public/maia/maia3-5m.onnx')),
  stockfishSha256: hash(await readFile('node_modules/stockfish/bin/stockfish-18-lite-single.wasm')),
  utility: 'sigmoid(cp/200), terminal 0/0.5/1; true Maia mass, unsearched tail uses strongest known defense',
  caveat: 'Focused position diagnostics; utility is not calibrated game win probability or Elo evidence.',
  commonOracleSettings: { opponentRating: 1000, engineRating: oracleEngineRating, depth: 12, replyCount: 10, replyCoverage: .95 },
  positions: [],
};
async function save() {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}

/** Independent forced root + opponent searches; fixed original mover POV. */
async function oracle(fen: string, move: string, rating = 1000, depth = 12, replyCount = 10) {
  const board = new Chess(fen);
  const played = playUci(board, move);
  if (!played) throw new Error(`Illegal move ${move}`);
  if (board.isGameOver()) return { move, san: played.san, objectiveCp: board.isCheckmate() ? 100000 : 0,
    expectedUtility: board.isCheckmate() ? 1 : .5, coverage: 1, punishableProbability: 0, replies: [] };
  const root = await uci.analyzeFen(fen, depth, 1, [move]);
  const defense = await uci.analyzeFen(board.fen(), depth - 1, 1);
  const probabilities = await maia.predict(board.fen(), rating, oracleEngineRating);
  const selected: { move: string; probability: number }[] = [];
  let coverage = 0;
  for (const item of probabilities) {
    if (selected.length >= replyCount || coverage >= .95) break;
    selected.push(item); coverage += item.probability;
  }
  if (!selected.some((item) => item.move === defense.bestMove)) {
    const best = probabilities.find((item) => item.move === defense.bestMove);
    if (best) { selected.push(best); coverage += best.probability; }
  }
  const replies = [];
  for (const item of selected) {
    const copy = new Chess(board.fen());
    const response = playUci(copy, item.move)!;
    let cp: number;
    let pv: string[] = [];
    if (copy.isGameOver()) cp = copy.isCheckmate() ? -100000 : 0;
    else {
      const analyzed = item.move === defense.bestMove ? defense
        : await uci.analyzeFen(board.fen(), depth - 1, 1, [item.move]);
      const line = analyzed.lines.find((line) => line.firstMove === item.move)!;
      cp = -line.score.cp; pv = line.pv.slice(1);
    }
    replies.push({ ...item, san: response.san, cp, utility: cpToExpectedScore(cp), punishment: pv });
  }
  const objectiveCp = Math.min(root.lines[0].score.cp, -defense.lines[0].score.cp, ...replies.map((reply) => reply.cp));
  const objectiveUtility = cpToExpectedScore(objectiveCp);
  const tail = Math.max(0, 1 - coverage);
  const expectedUtility = replies.reduce((total, reply) => total + reply.probability * reply.utility, tail * objectiveUtility);
  return { move, san: played.san, rootCp: root.lines[0].score.cp, bestDefense: defense.bestMove,
    defenseCp: -defense.lines[0].score.cp, objectiveCp, objectiveUtility, expectedUtility,
    coverage, residualProbability: tail,
    punishableProbability: replies.filter((reply) => reply.cp > objectiveCp + 100).reduce((total, reply) => total + reply.probability, 0),
    replies: replies.map((reply) => ({ ...reply, lossCp: Math.max(0, reply.cp - objectiveCp) })) };
}

/** Same three first-reply branches for each move, then a wider independent second reply check. */
async function secondChance(fen: string, first: Awaited<ReturnType<typeof oracle>>) {
  const afterCandidate = new Chess(fen);
  playUci(afterCandidate, first.move);
  if (afterCandidate.isGameOver()) return { objectiveCp: first.objectiveCp, expectedUtility: first.expectedUtility,
    punishableProbability: 0, firstCoverage: 1, refinedProbability: 0, refinements: [], method: 'Exact terminal outcome.' };
  const branches = [...first.replies].sort((a, b) => b.probability - a.probability)
    .filter((reply) => Math.abs(reply.cp) < 90000).slice(0, 3);
  const refinements: any[] = [];
  for (const reply of branches) {
    const board = new Chess(afterCandidate.fen());
    playUci(board, reply.move);
    if (board.isGameOver() || !reply.punishment.length) continue;
    const continuation = await oracle(board.fen(), reply.punishment[0], 1000, 10);
    refinements.push({ firstReply: reply.move, firstSan: reply.san, firstProbability: reply.probability, continuation });
  }
  const objectiveCp = Math.min(first.objectiveCp, ...refinements.map((row) => row.continuation.objectiveCp));
  const expectedUtility = first.replies.reduce((sum, reply) => {
    const refinement = refinements.find((row) => row.firstReply === reply.move);
    return sum + reply.probability * (refinement?.continuation.expectedUtility ?? reply.utility);
  }, (first.residualProbability ?? 0) * cpToExpectedScore(objectiveCp));
  const punishableProbability = first.replies.reduce((sum, reply) => {
    if (reply.cp > objectiveCp + 100) return sum + reply.probability;
    const refinement = refinements.find((row) => row.firstReply === reply.move);
    const nextMass = refinement?.continuation.replies.filter((next: any) => next.cp > objectiveCp + 100)
      .reduce((total: number, next: any) => total + next.probability, 0) ?? 0;
    return sum + reply.probability * nextMass;
  }, 0);
  return { objectiveCp, expectedUtility, punishableProbability, firstCoverage: first.coverage,
    refinedProbability: refinements.reduce((sum, row) => sum + row.firstProbability, 0), refinements,
    method: 'Three largest non-mate first replies, Stockfish PV continuation, up to ten second replies/95% plus strongest defense; first/second depth 12/10.' };
}

try {
  if (mode === 'punishments') {
    const live = await import('../src/engine/trappy');
    report.settings = live.DEFAULT_TRAPPY_SETTINGS;
    for (const id of ['blackburne', 'englund', 'elephant']) {
      const fixture = TRAP_POSITIONS.find((item) => item.id === id)!;
      const board = new Chess(fixture.fen);
      board.move(fixture.candidate!); board.move(fixture.temptingReply!);
      const checkpoints = id === 'blackburne' ? [0, 2, 4, 6] : [0];
      for (const offset of checkpoints) {
        if (offset) {
          board.move(fixture.continuation![offset - 2]);
          board.move(fixture.continuation![offset - 1]);
        }
        if (board.isGameOver()) break;
        const start = Date.now();
        const decision = await new live.TrappyEngine(uci.asClient(), maia).chooseMove(board.fen(), live.DEFAULT_TRAPPY_SETTINGS, true);
        const expected = fixture.continuation?.[offset];
        const row = { id, continuationOffset: offset, fen: board.fen(), expectedNamedContinuation: expected,
          actualSan: decision.san, elapsedMs: Date.now() - start, decision };
        report.positions.push(row); await save();
        console.log(`${id} offset${offset}: ${decision.san}, named=${expected}, objective=${decision.selected.rootScoreCp}, ${row.elapsedMs}ms`);
      }
    }
  } else if (mode === 'chains') {
    for (const id of ['blackburne', 'englund', 'elephant']) {
      const fixture = TRAP_POSITIONS.find((item) => item.id === id)!;
      const board = new Chess(fixture.fen);
      const candidate = moveToUci(board.move(fixture.candidate!));
      const firstPolicy = await maia.predict(board.fen(), 1000, 2000);
      const firstReply = moveToUci(board.move(fixture.temptingReply!));
      const continuationRoot = await uci.analyzeFen(board.fen(), 12, 6);
      const named = fixture.continuation?.[0];
      let namedUci: string | undefined;
      if (named) namedUci = moveToUci(new Chess(board.fen()).move(named));
      const candidates = new Set(continuationRoot.lines.slice(0, 4).map((line) => line.firstMove));
      if (namedUci) candidates.add(namedUci);
      const continuations = [];
      const before = Date.now();
      for (const move of candidates) continuations.push(await oracle(board.fen(), move, 1000, 12));
      const row = { id, fen: fixture.fen, candidate, firstReply,
        firstReplyProbability: firstPolicy.find((item) => item.move === firstReply)?.probability,
        afterFirstReplyFen: board.fen(), bestEngineContinuation: continuationRoot.lines[0], namedContinuation: namedUci,
        continuations, elapsedMs: Date.now() - before };
      report.positions.push(row); await save();
      console.log(`${id}: best=${continuationRoot.bestMove}, named=${namedUci}; ${continuations.map((item) => `${item.san}: u=${item.expectedUtility.toFixed(3)}, defense=${item.objectiveCp}, mistake=${(100 * item.punishableProbability).toFixed(1)}%`).join('; ')}`);
    }
  } else {
    const live = ['production', 'compare', 'discovery', 'control'].includes(mode) ? await import('../src/engine/trappy') : null;
    const ratingArguments = arg('--ratings', '800,1000,1200,1500').split(',').map(Number);
    const configs = mode === 'control' ? [{ label: 'production-onechance', settings: { ...live!.DEFAULT_TRAPPY_SETTINGS, opponentPlies: 1 } },
      { label: 'production-default', settings: live!.DEFAULT_TRAPPY_SETTINGS }]
      : mode === 'compare' || mode === 'discovery' ? [{ label: 'baseline-1500-10/10', settings: BASELINE_SETTINGS },
      { label: 'production-default', settings: live!.DEFAULT_TRAPPY_SETTINGS }]
      : mode === 'production' ? [{ label: 'production-default', settings: live!.DEFAULT_TRAPPY_SETTINGS }]
      : [...ratingArguments.map((opponentRating) => ({ label: `baseline-${opponentRating}-10/10`, settings: { ...BASELINE_SETTINGS, opponentRating } })),
        ...(process.argv.includes('--deeper') ? [{ label: 'baseline-1000-12/10', settings: { ...BASELINE_SETTINGS, opponentRating: 1000, rootDepth: 12 } }] : [])];
    report.configurations = configs;
    for (const fixture of positions) {
      const decisions = [];
      const oracles = new Map<string, any>();
      const secondOracles = new Map<string, any>();
      const independentRoot = await uci.analyzeFen(fixture.fen, 12, Math.min(10, new Chess(fixture.fen).moves().length));
      for (const config of configs) {
        const started = Date.now();
        const count = uci.analyses;
        const engine = config.label.startsWith('production-') ? new live!.TrappyEngine(uci.asClient(), maia) : new BaselineEngine(uci.asClient(), maia);
        const decision = await engine.chooseMove(fixture.fen, config.settings, true);
        const elapsedMs = Date.now() - started;
        const stockfishCalls = uci.analyses - count;
        if (decision.selected.riskCp > config.settings.maxRiskCp + 1e-6) throw new Error('Hard risk violation');
        if (decision.policySource !== 'maia' && decision.rootBestScoreCp < 90000) throw new Error(`Fallback: ${decision.warning}`);
        if (!oracles.has(decision.move)) oracles.set(decision.move, await oracle(fixture.fen, decision.move));
        const evaluated = oracles.get(decision.move);
        if (['compare', 'production', 'discovery', 'control'].includes(mode)) {
          if (!secondOracles.has(decision.move)) secondOracles.set(decision.move, await secondChance(fixture.fen, evaluated));
        }
        const row = { label: config.label, settings: config.settings, elapsedMs, stockfishCalls,
          decision, commonOracle: { ...evaluated, rootRiskCp: Math.max(0, independentRoot.lines[0].score.cp - evaluated.objectiveCp) },
          commonSecondChanceOracle: secondOracles.get(decision.move) };
        decisions.push(row);
        const second = secondOracles.get(decision.move);
        console.log(`${fixture.id} ${config.label}: ${decision.san}, risk=${decision.selected.riskCp}, u1000=${evaluated.expectedUtility.toFixed(3)}, mistake1000=${(100 * evaluated.punishableProbability).toFixed(1)}%, second=${second?.expectedUtility.toFixed(3) ?? '-'}, ${elapsedMs}ms`);
      }
      let namedTrap;
      if (fixture.candidate) {
        const move = moveToUci(new Chess(fixture.fen).move(fixture.candidate));
        namedTrap = oracles.get(move) ?? await oracle(fixture.fen, move);
      }
      report.positions.push({ ...fixture, independentRootBest: independentRoot.lines[0], decisions, namedTrap });
      await save();
    }
  }
  report.finishedAt = new Date().toISOString(); report.stockfishCalls = uci.analyses;
  report.productionSourceSha256AtEnd = hash(await readFile('src/engine/trappy.ts'));
  await save();
} finally { uci.terminate(); await maia.terminate(); }
