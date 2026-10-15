import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import type { AnalysisLine, AnalysisResult } from '../src/engine/uci';
import type { AnalysisEngine, CandidateInfo, OpponentPolicyProvider, PolicyMove } from '../benchmarks/practical';
import { TRAP_POSITIONS } from '../benchmarks/trap-positions';

const modulePath = process.argv.includes('--experimental') ? '../benchmarks/practical.ts' : '../src/engine/trappy.ts';
const implementation = await import(modulePath);
const PracticalEngine = implementation.PracticalEngine ?? implementation.TrappyEngine;
const { DEFAULT_TRAPPY_SETTINGS, cpToExpectedScore } = implementation as typeof import('../benchmarks/practical');
const settings = { ...DEFAULT_TRAPPY_SETTINGS, opponentPlies: 1 as const, replyCount: 2, replyCoverage: 0.95 };
const start = new Chess();
const e4 = new Chess(); e4.move('e4');
const d4 = new Chess(); d4.move('d4');
const e4e5 = new Chess(e4.fen()); e4e5.move('e5');

function line(move: string, cp: number, depth = 10): AnalysisLine {
  return { depth, multipv: 1, firstMove: move, score: { type: 'cp', raw: cp, cp }, pv: [move], raw: '' };
}
function result(lines: AnalysisLine[]): AnalysisResult {
  return { bestMove: lines[0]?.firstMove ?? '0000', lines, linesByDepth: new Map([[10, lines]]) };
}
function entry(board: Chess, move: string, cp = 0): CandidateInfo {
  const played = new Chess(board.fen()).move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  const score = cpToExpectedScore(cp);
  return { move, san: played.san, rootScoreCp: cp, adjustedScoreCp: cp, riskCp: 0, bonusCp: 0,
    expectedScoreCp: cp, expectedScore: score, objectiveScore: score, policyCoverage: 0, replies: [] };
}
class MockPolicy implements OpponentPolicyProvider {
  calls: { fen: string; opponentRating: number; engineRating: number }[] = [];
  constructor(private readonly distributions: Map<string, PolicyMove[]>) {}
  async predict(fen: string, opponentRating: number, engineRating: number): Promise<PolicyMove[]> {
    this.calls.push({ fen, opponentRating, engineRating });
    const distribution = this.distributions.get(fen);
    assert.ok(distribution, `Unexpected policy position: ${fen}`);
    return distribution;
  }
}
class MockEngine implements AnalysisEngine {
  calls: { fen: string; depth: number; multipv: number; searchMoves: string[] }[] = [];
  constructor(private readonly analyze: (fen: string, moves: string[]) => AnalysisResult) {}
  async analyzeFen(fen: string, depth: number, multipv = 1, searchMoves: string[] = []): Promise<AnalysisResult> {
    this.calls.push({ fen, depth, multipv, searchMoves });
    return this.analyze(fen, searchMoves);
  }
}
const tests: { name: string; run: () => Promise<void> }[] = [];
function test(name: string, run: () => Promise<void>) { tests.push({ name, run }); }
function close(actual: number, expected: number, message?: string) { assert.ok(Math.abs(actual - expected) < 1e-10, message ?? `${actual} != ${expected}`); }

test('White root outcomes retain probability mass and pessimistic residual tail', async () => {
  const policy = new MockPolicy(new Map([[e4.fen(), [
    { move: 'e7e5', probability: 0.6 }, { move: 'c7c5', probability: 0.3 }, { move: 'a7a6', probability: 0.1 },
  ]]]));
  const uci = new MockEngine((fen, moves) => {
    assert.equal(fen, e4.fen());
    return result([line(moves[0] ?? 'e7e5', moves[0] === 'c7c5' ? -400 : 0)]);
  });
  const evaluated = await new PracticalEngine(uci, policy).evaluateCandidate(start, entry(start, 'e2e4'), 0, settings);
  close(evaluated.policyCoverage, 0.9);
  close(evaluated.expectedScore, 0.6 * 0.5 + 0.3 * cpToExpectedScore(400) + 0.1 * 0.5);
  assert.equal(evaluated.replies.find((reply) => reply.move === 'c7c5')!.scoreCp, 400);
  assert.deepEqual(policy.calls[0], { fen: e4.fen(), opponentRating: settings.opponentRating, engineRating: settings.engineRating });
});

test('Black root uses the same fixed mover perspective and rating order', async () => {
  const policy = new MockPolicy(new Map([[e4e5.fen(), [
    { move: 'g1f3', probability: 0.6 }, { move: 'b1c3', probability: 0.3 }, { move: 'd2d3', probability: 0.1 },
  ]]]));
  const uci = new MockEngine((fen, moves) => {
    assert.equal(fen, e4e5.fen());
    return result([line(moves[0] ?? 'g1f3', moves[0] === 'b1c3' ? -400 : 0)]);
  });
  const evaluated = await new PracticalEngine(uci, policy).evaluateCandidate(e4, entry(e4, 'e7e5'), 0, settings);
  close(evaluated.expectedScore, 0.6 * 0.5 + 0.3 * cpToExpectedScore(400) + 0.1 * 0.5);
  assert.equal(evaluated.replies.find((reply) => reply.move === 'b1c3')!.scoreCp, 400);
  assert.equal(evaluated.trap?.reply, 'b1c3');
});

test('Rare best defense is included without renormalizing searched replies', async () => {
  const policy = new MockPolicy(new Map([[e4.fen(), [
    { move: 'c7c5', probability: 0.89 }, { move: 'a7a6', probability: 0.1 }, { move: 'e7e5', probability: 0.01 },
  ]]]));
  const uci = new MockEngine((_fen, moves) => result([line(moves[0] ?? 'e7e5', moves[0] === 'c7c5' ? -400 : 0)]));
  const evaluated = await new PracticalEngine(uci, policy).evaluateCandidate(start, entry(start, 'e2e4'), 0, { ...settings, replyCount: 1 });
  assert.equal(evaluated.replies.length, 2);
  close(evaluated.policyCoverage, 0.9);
  close(evaluated.replies.find((reply) => reply.move === 'e7e5')!.probability, 0.01);
  close(evaluated.expectedScore, 0.89 * cpToExpectedScore(400) + 0.11 * 0.5);
});

test('A very rare forced mate has bounded utility rather than an enormous centipawn bonus', async () => {
  const policy = new MockPolicy(new Map([[e4.fen(), [
    { move: 'e7e5', probability: 0.999 }, { move: 'c7c5', probability: 0.001 },
  ]]]));
  const uci = new MockEngine((_fen, moves) => result([line(moves[0] ?? 'e7e5', moves[0] === 'c7c5' ? -99_900 : 0)]));
  const evaluated = await new PracticalEngine(uci, policy).evaluateCandidate(start, entry(start, 'e2e4'), 0, { ...settings, replyCoverage: 1 });
  close(evaluated.expectedScore, 0.5005);
  assert.ok(evaluated.expectedScoreCp > 0 && evaluated.expectedScoreCp < 1);
  assert.equal(evaluated.trap, undefined);
});

test('A defense discovered during reply search cannot bypass the hard risk limit', async () => {
  const policy = new MockPolicy(new Map([
    [start.fen(), [{ move: 'e2e4', probability: 0.5 }, { move: 'd2d4', probability: 0.5 }]],
    [e4.fen(), [{ move: 'c7c5', probability: 0.99 }, { move: 'e7e5', probability: 0.01 }]],
    [d4.fen(), [{ move: 'd7d5', probability: 1 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === start.fen()) return result([line('e2e4', 0), line('d2d4', 0)]);
    if (fen === e4.fen()) return result([line(moves[0] ?? 'e7e5', moves[0] === 'c7c5' ? -700 : 400)]);
    assert.equal(fen, d4.fen());
    return result([line('d7d5', 0)]);
  });
  const chosen = await new PracticalEngine(uci, policy).chooseMove(start.fen(), { ...settings, maxRiskCp: 100 }, true);
  assert.equal(chosen.move, 'd2d4');
  assert.ok(chosen.selected.riskCp <= 100);
  assert.equal(chosen.candidates.find((candidate) => candidate.move === 'e2e4')!.rootScoreCp, -400);
});

test('When every defense tightens the scores, compare risk against the verified best move', async () => {
  const policy = new MockPolicy(new Map([
    [start.fen(), [{ move: 'e2e4', probability: 0.5 }, { move: 'd2d4', probability: 0.5 }]],
    [e4.fen(), [{ move: 'e7e5', probability: 1 }]],
    [d4.fen(), [{ move: 'd7d5', probability: 1 }]],
  ]));
  const uci = new MockEngine((fen) => fen === start.fen() ? result([line('e2e4', 100), line('d2d4', 90)])
    : result([line(fen === e4.fen() ? 'e7e5' : 'd7d5', fen === e4.fen() ? 500 : 450)]));
  const chosen = await new PracticalEngine(uci, policy).chooseMove(start.fen(), { ...settings, maxRiskCp: 100 }, true);
  assert.equal(chosen.move, 'd2d4');
  assert.equal(chosen.rootBestMove, 'd2d4');
  assert.equal(chosen.rootBestScoreCp, -450);
  assert.equal(chosen.selected.riskCp, 0);
});

test('Candidate risk pruning revisits a move that becomes eligible after defensive verification', async () => {
  const c4 = new Chess(); c4.move('c4');
  const policy = new MockPolicy(new Map([
    [start.fen(), [{ move: 'e2e4', probability: 0.4 }, { move: 'd2d4', probability: 0.35 }, { move: 'c2c4', probability: 0.25 }]],
    [e4.fen(), [{ move: 'e7e5', probability: 1 }]],
    [d4.fen(), [{ move: 'd7d5', probability: 1 }]],
    [c4.fen(), [{ move: 'd7d5', probability: 0.9 }, { move: 'e7e5', probability: 0.1 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === start.fen()) return result([line('e2e4', 500), line('d2d4', 400), line('c2c4', 200)]);
    if (fen === e4.fen()) return result([line('e7e5', 400)]);
    if (fen === d4.fen()) return result([line('d7d5', 0)]);
    assert.equal(fen, c4.fen());
    return result([line(moves[0] ?? 'e7e5', moves[0] === 'd7d5' ? -400 : 0)]);
  });
  const chosen = await new PracticalEngine(uci, policy).chooseMove(start.fen(), { ...settings, maxRiskCp: 100 }, true);
  assert.equal(chosen.move, 'c2c4');
  assert.equal(chosen.selected.riskCp, 0);
  assert.ok(chosen.selected.replies.length > 0);
  assert.equal(chosen.selected.trap?.reply, 'd7d5');
  assert.ok(policy.calls.some((call) => call.fen === c4.fen()));
});

test('A stronger defense uncovered by a forced reply also tightens the safety baseline', async () => {
  const policy = new MockPolicy(new Map([
    [start.fen(), [{ move: 'e2e4', probability: 0.5 }, { move: 'd2d4', probability: 0.5 }]],
    [e4.fen(), [{ move: 'c7c5', probability: 0.98 }, { move: 'a7a6', probability: 0.01 }, { move: 'e7e5', probability: 0.01 }]],
    [d4.fen(), [{ move: 'd7d5', probability: 1 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === start.fen()) return result([line('e2e4', 0), line('d2d4', 0)]);
    if (fen === d4.fen()) return result([line('d7d5', 0)]);
    assert.equal(fen, e4.fen());
    const cp = moves[0] === 'c7c5' ? -700 : moves[0] === 'a7a6' ? 500 : 0;
    return result([line(moves[0] ?? 'e7e5', cp)]);
  });
  const chosen = await new PracticalEngine(uci, policy).chooseMove(start.fen(), { ...settings, replyCount: 3, replyCoverage: 1, maxRiskCp: 100 }, true);
  assert.equal(chosen.move, 'd2d4');
  const risky = chosen.candidates.find((candidate) => candidate.move === 'e2e4')!;
  assert.equal(risky.rootScoreCp, -500);
  assert.equal(risky.riskCp, 500);
});

test('Immediate root mate and stalemate have exact terminal utilities', async () => {
  const uci = new MockEngine(() => { throw new Error('Terminal candidates should not search further.'); });
  const policy = new MockPolicy(new Map());
  const engine = new PracticalEngine(uci, policy);
  const board = new Chess('7k/4Q3/6K1/8/8/8/8/8 w - - 0 1');
  const mate = await engine.evaluateCandidate(board, entry(board, 'e7g7'), 0, settings);
  assert.equal(mate.expectedScore, 1);
  assert.equal(mate.rootScoreCp, 100_000);
  const draw = await engine.evaluateCandidate(board, entry(board, 'e7f7'), 0, settings);
  assert.equal(draw.expectedScore, 0.5);
  assert.equal(draw.rootScoreCp, 0);
  assert.equal(uci.calls.length, 0);
  assert.equal(policy.calls.length, 0);
});

test('A modeled opponent checkmate is scored as a root loss', async () => {
  const board = new Chess(); for (const move of ['f3', 'e5']) board.move(move);
  const after = new Chess(board.fen()); after.move('g4');
  const policy = new MockPolicy(new Map([[after.fen(), [{ move: 'd8h4', probability: 1 }]]]));
  const uci = new MockEngine(() => result([line('d8h4', 99_900)]));
  const evaluated = await new PracticalEngine(uci, policy).evaluateCandidate(board, entry(board, 'g2g4'), 0, settings);
  assert.equal(evaluated.expectedScore, 0);
  assert.equal(evaluated.replies[0].scoreCp, -100_000);
});

test('Known root mate remains preferred when Maia is unavailable', async () => {
  const board = new Chess(); for (const move of ['f3', 'e5', 'g4']) board.move(move);
  const uci = new MockEngine(() => result([line('d8h4', 99_900)]));
  const policy = new MockPolicy(new Map());
  const chosen = await new PracticalEngine(uci, policy).chooseMove(board.fen(), settings, true);
  assert.equal(chosen.move, 'd8h4');
  assert.equal(chosen.policySource, 'stockfish');
  assert.equal(policy.calls.length, 0);
});

test('An invalid model distribution gives an explicit objective Stockfish fallback', async () => {
  const uci = new MockEngine(() => result([line('e2e4', 30)]));
  const policy = new MockPolicy(new Map([[start.fen(), [{ move: 'a1a8', probability: 1 }]]]));
  const chosen = await new PracticalEngine(uci, policy).chooseMove(start.fen(), settings, true);
  assert.equal(chosen.move, 'e2e4');
  assert.equal(chosen.policySource, 'stockfish');
  assert.match(chosen.warning!, /(?:Maia|Practical) analysis unavailable/);
  assert.equal(chosen.selected.policyCoverage, 0);
});

test('Forced candidate discovery includes a legal tactical move absent from Maia and the root shortlist', async () => {
  const fixture = TRAP_POSITIONS.find((position) => position.id === 'legal-sound')!;
  const board = new Chess(fixture.fen);
  const policy = new MockPolicy(new Map([[board.fen(), [{ move: 'd2d3', probability: 1 }]]]));
  const uci = new MockEngine((fen, moves) => {
    assert.equal(fen, board.fen());
    if (!moves.length) return result([line('d2d3', 50)]);
    return result(moves.map((move) => line(move, move === 'f3e5' ? 99_900 : -300)));
  });
  const chosen = await new PracticalEngine(uci, policy).chooseMove(board.fen(), settings, true);
  assert.equal(chosen.move, 'f3e5');
  assert.ok(uci.calls.some((call) => call.searchMoves.includes('f3e5')));
  const widened = uci.calls.find((call) => call.searchMoves.includes('f3e5'))!;
  assert.equal(widened.multipv, widened.searchMoves.length);
});

test('En passant is included in tactical candidate discovery', async () => {
  const board = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const policy = new MockPolicy(new Map([[board.fen(), [{ move: 'e1d1', probability: 1 }]]]));
  const uci = new MockEngine((fen, moves) => {
    assert.equal(fen, board.fen());
    if (!moves.length) return result([line('e1d1', 50)]);
    return result(moves.map((move) => line(move, move === 'e5d6' ? 99_900 : -300)));
  });
  const chosen = await new PracticalEngine(uci, policy).chooseMove(board.fen(), settings, true);
  assert.equal(chosen.move, 'e5d6');
  assert.ok(uci.calls.some((call) => call.searchMoves.includes('e5d6')));
});

test('Search cancellation cannot become a fallback move', async () => {
  let finish!: (value: AnalysisResult) => void;
  const uci: AnalysisEngine = { analyzeFen: () => new Promise((resolve) => { finish = resolve; }) };
  const engine = new PracticalEngine(uci, new MockPolicy(new Map()));
  const pending = engine.chooseMove(start.fen(), settings, true);
  engine.cancel();
  finish(result([line('e2e4', 30)]));
  await assert.rejects(pending, /cancelled/);
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}`, error); }
}
console.log(`${tests.length - failures}/${tests.length} practical-engine tests passed (${modulePath}).`);
if (failures) process.exitCode = 1;
