import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { TrappyEngine, DEFAULT_TRAPPY_SETTINGS, cpToExpectedScore, type AnalysisEngine,
  type CandidateInfo, type OpponentPolicyProvider, type PolicyMove, type TrappySettings } from '../src/engine/trappy';
import type { AnalysisLine, AnalysisResult } from '../src/engine/uci';

const settings: TrappySettings = { ...DEFAULT_TRAPPY_SETTINGS, opponentPlies: 2,
  continuationReplies: 2, continuationBranches: 3, replyCount: 2, replyCoverage: 0.95 };
const start = new Chess();
function position(...moves: string[]): Chess {
  const board = new Chess();
  for (const move of moves) board.move(move);
  return board;
}
const e4 = position('e4');
const d4 = position('d4');
const e4e5Nf3 = position('e4', 'e5', 'Nf3');
const d4d5c4 = position('d4', 'd5', 'c4');
function line(move: string, cp: number, pv: string[] = [move]): AnalysisLine {
  assert.equal(pv[0], move);
  return { depth: 12, multipv: 1, firstMove: move, score: { type: 'cp', raw: cp, cp }, pv, raw: '' };
}
function result(lines: AnalysisLine[]): AnalysisResult {
  return { bestMove: lines[0]?.firstMove ?? '0000', lines, linesByDepth: new Map([[12, lines]]) };
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
function close(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-10, message ?? `${actual} != ${expected}`);
}
function rootPolicy(): PolicyMove[] {
  return [{ move: 'e2e4', probability: 0.5 }, { move: 'd2d4', probability: 0.5 }];
}

test('Default search targets lower-rated opponents and looks for a second mistake', async () => {
  assert.ok(DEFAULT_TRAPPY_SETTINGS.opponentRating <= 1200);
  assert.ok(DEFAULT_TRAPPY_SETTINGS.engineRating >= 2000);
  assert.ok(DEFAULT_TRAPPY_SETTINGS.rootDepth >= 12);
  assert.equal(DEFAULT_TRAPPY_SETTINGS.opponentPlies, 2);
  assert.equal(DEFAULT_TRAPPY_SETTINGS.trappiness, 1);
  assert.ok(DEFAULT_TRAPPY_SETTINGS.maxRiskCp <= 100);
});

test('The second opponent chance changes selection through an optimal engine continuation', async () => {
  const policy = new MockPolicy(new Map([
    [start.fen(), rootPolicy()],
    [e4.fen(), [{ move: 'e7e5', probability: 1 }]],
    [d4.fen(), [{ move: 'd7d5', probability: 1 }]],
    [e4e5Nf3.fen(), [{ move: 'b8c6', probability: 0.25 }, { move: 'd7d6', probability: 0.75 }]],
    [d4d5c4.fen(), [{ move: 'e7e6', probability: 1 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === start.fen()) return result([line('d2d4', 60), line('e2e4', 0)]);
    if (fen === e4.fen()) return result([line('e7e5', 0, ['e7e5', 'g1f3', 'b8c6'])]);
    if (fen === d4.fen()) return result([line('d7d5', -60, ['d7d5', 'c2c4', 'e7e6'])]);
    if (fen === e4e5Nf3.fen()) return result([line(moves[0] ?? 'b8c6', moves[0] === 'd7d6' ? -400 : 0)]);
    assert.equal(fen, d4d5c4.fen());
    return result([line('e7e6', -60)]);
  });
  const chosen = await new TrappyEngine(uci, policy).chooseMove(start.fen(), settings, true);
  assert.equal(chosen.move, 'e2e4');
  assert.equal(chosen.rootBestMove, 'd2d4');
  close(chosen.selected.expectedScore, 0.25 * 0.5 + 0.75 * cpToExpectedScore(400));
  assert.equal(chosen.selected.replies[0].continuation?.move, 'g1f3');
  assert.equal(chosen.selected.replies[0].continuation?.san, 'Nf3');
  assert.ok(chosen.selected.riskCp <= settings.maxRiskCp);
  assert.ok(chosen.selected.replies[0].punishment[0] === 'g1f3');
  assert.equal(chosen.selected.trap?.nextReply?.reply, 'd7d6');
  assert.deepEqual(chosen.selected.trap?.punishment.slice(0, 2), ['g1f3', 'd7d6']);
});

test('Both chance layers preserve omitted probability mass and conditional mistake probability', async () => {
  const policy = new MockPolicy(new Map([
    [e4.fen(), [{ move: 'e7e5', probability: 0.6 }, { move: 'c7c5', probability: 0.3 }, { move: 'a7a6', probability: 0.1 }]],
    [e4e5Nf3.fen(), [{ move: 'b8c6', probability: 0.6 }, { move: 'd7d6', probability: 0.3 }, { move: 'a7a6', probability: 0.1 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === e4.fen()) {
      const move = moves[0] ?? 'e7e5';
      return result([line(move, move === 'c7c5' ? -200 : 0, [move, 'g1f3'])]);
    }
    assert.equal(fen, e4e5Nf3.fen());
    return result([line(moves[0] ?? 'b8c6', moves[0] === 'd7d6' ? -400 : 0)]);
  });
  const evaluated = await new TrappyEngine(uci, policy).evaluateCandidate(start, entry(start, 'e2e4'), 0,
    { ...settings, continuationBranches: 1 });
  const secondExpected = 0.7 * 0.5 + 0.3 * cpToExpectedScore(400);
  close(evaluated.policyCoverage, 0.9);
  close(evaluated.replies[0].continuation!.policyCoverage, 0.9);
  close(evaluated.replies[0].expectedScore, secondExpected);
  close(evaluated.expectedScore, 0.6 * secondExpected + 0.3 * cpToExpectedScore(200) + 0.1 * 0.5);
  close(evaluated.mistakeProbability!, 0.3 + 0.6 * 0.3);
});

test('A rare second-ply mate has bounded utility and cannot create a misleading trap label', async () => {
  const policy = new MockPolicy(new Map([
    [e4.fen(), [{ move: 'e7e5', probability: 1 }]],
    [e4e5Nf3.fen(), [{ move: 'b8c6', probability: 0.999 }, { move: 'd7d6', probability: 0.001 }]],
  ]));
  const uci = new MockEngine((fen, moves) => fen === e4.fen()
    ? result([line('e7e5', 0, ['e7e5', 'g1f3'])])
    : result([line(moves[0] ?? 'b8c6', moves[0] === 'd7d6' ? -99_900 : 0)]));
  const evaluated = await new TrappyEngine(uci, policy).evaluateCandidate(start, entry(start, 'e2e4'), 0,
    { ...settings, replyCoverage: 1 });
  close(evaluated.expectedScore, 0.5005);
  assert.ok(evaluated.expectedScoreCp > 0 && evaluated.expectedScoreCp < 1);
  assert.equal(evaluated.trap, undefined);
});

test('A nested trap label uses the joint probability of both required opponent replies', async () => {
  const e4c5Nf3 = position('e4', 'c5', 'Nf3');
  const policy = new MockPolicy(new Map([
    [e4.fen(), [{ move: 'e7e5', probability: 0.99 }, { move: 'c7c5', probability: 0.01 }]],
    [e4e5Nf3.fen(), [{ move: 'b8c6', probability: 1 }]],
    [e4c5Nf3.fen(), [{ move: 'b8c6', probability: 0.9 }, { move: 'd7d6', probability: 0.1 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === e4.fen()) return result([line(moves[0] ?? 'e7e5', 0, [moves[0] ?? 'e7e5', 'g1f3'])]);
    assert.ok(fen === e4e5Nf3.fen() || fen === e4c5Nf3.fen());
    return result([line(moves[0] ?? 'b8c6', moves[0] === 'd7d6' ? -99_900 : 0)]);
  });
  const evaluated = await new TrappyEngine(uci, policy).evaluateCandidate(start, entry(start, 'e2e4'), 0,
    { ...settings, replyCoverage: 1 });
  close(evaluated.expectedScore, 0.5005);
  assert.equal(evaluated.trap, undefined);
});

for (const forcedDefense of [false, true]) {
  test(`A rare second-ply ${forcedDefense ? 'forced' : 'best'} defense tightens the root risk limit`, async () => {
    const secondPolicy = forcedDefense
      ? [{ move: 'd7d6', probability: 0.99 }, { move: 'a7a6', probability: 0.005 }, { move: 'b8c6', probability: 0.005 }]
      : [{ move: 'd7d6', probability: 0.99 }, { move: 'b8c6', probability: 0.01 }];
    const policy = new MockPolicy(new Map([
      [start.fen(), rootPolicy()],
      [e4.fen(), [{ move: 'e7e5', probability: 1 }]],
      [d4.fen(), [{ move: 'd7d5', probability: 1 }]],
      [e4e5Nf3.fen(), secondPolicy],
      [d4d5c4.fen(), [{ move: 'e7e6', probability: 1 }]],
    ]));
    const uci = new MockEngine((fen, moves) => {
      if (fen === start.fen()) return result([line('e2e4', 100), line('d2d4', 80)]);
      if (fen === e4.fen()) return result([line('e7e5', -100, ['e7e5', 'g1f3'])]);
      if (fen === d4.fen()) return result([line('d7d5', -80, ['d7d5', 'c2c4'])]);
      if (fen === d4d5c4.fen()) return result([line('e7e6', -80)]);
      assert.equal(fen, e4e5Nf3.fen());
      const move = moves[0] ?? 'b8c6';
      const cp = move === 'd7d6' ? -1000 : forcedDefense ? (move === 'a7a6' ? 600 : -100) : 500;
      return result([line(move, cp)]);
    });
    const chosen = await new TrappyEngine(uci, policy).chooseMove(start.fen(),
      { ...settings, continuationReplies: 3, replyCoverage: 1 }, true);
    assert.equal(chosen.move, 'd2d4');
    const unsafe = chosen.candidates.find((candidate) => candidate.move === 'e2e4')!;
    assert.ok(unsafe.rootScoreCp <= -500);
    assert.ok(unsafe.riskCp >= 580);
    assert.ok(chosen.selected.riskCp <= settings.maxRiskCp);
  });
}

test('A known mating punishment keeps its first move and bypasses uncertain second-ply inference', async () => {
  const board = position('f3');
  const after = position('f3', 'e5');
  const policy = new MockPolicy(new Map([[after.fen(), [{ move: 'g2g4', probability: 1 }]]]));
  const uci = new MockEngine((fen) => {
    assert.equal(fen, after.fen());
    return result([line('g2g4', -99_900, ['g2g4', 'd8h4'])]);
  });
  const evaluated = await new TrappyEngine(uci, policy).evaluateCandidate(board, entry(board, 'e7e5'), 0, settings);
  assert.equal(evaluated.expectedScore, 1);
  assert.deepEqual(evaluated.replies[0].punishment, ['d8h4']);
  assert.equal(evaluated.replies[0].continuation, undefined);
  assert.equal(policy.calls.length, 1);
});

test('An actual second-ply opponent checkmate has exact loss utility', async () => {
  const after = position('f3');
  const continuation = position('f3', 'e5', 'g4');
  const policy = new MockPolicy(new Map([
    [after.fen(), [{ move: 'e7e5', probability: 1 }]],
    [continuation.fen(), [{ move: 'd8h4', probability: 1 }]],
  ]));
  const uci = new MockEngine((fen) => fen === after.fen()
    ? result([line('e7e5', 0, ['e7e5', 'g2g4', 'd8h4'])])
    : result([line('d8h4', 99_900)]));
  const evaluated = await new TrappyEngine(uci, policy).evaluateCandidate(start, entry(start, 'f2f3'), 0, settings);
  assert.equal(evaluated.expectedScore, 0);
  assert.equal(evaluated.replies[0].continuation?.replies[0].scoreCp, -100_000);
  assert.equal(evaluated.rootScoreCp, -100_000);
});

test('Black gets positive second-ply outcomes in the same fixed root perspective', async () => {
  const after = position('e4', 'e5');
  const continuation = position('e4', 'e5', 'Nf3', 'Nc6');
  const policy = new MockPolicy(new Map([
    [after.fen(), [{ move: 'g1f3', probability: 1 }]],
    [continuation.fen(), [{ move: 'f1b5', probability: 0.7 }, { move: 'f1c4', probability: 0.3 }]],
  ]));
  const uci = new MockEngine((fen, moves) => fen === after.fen()
    ? result([line('g1f3', 0, ['g1f3', 'b8c6', 'f1b5'])])
    : result([line(moves[0] ?? 'f1b5', moves[0] === 'f1c4' ? -400 : 0)]));
  const evaluated = await new TrappyEngine(uci, policy).evaluateCandidate(e4, entry(e4, 'e7e5'), 0, settings);
  close(evaluated.expectedScore, 0.7 * 0.5 + 0.3 * cpToExpectedScore(400));
  assert.equal(evaluated.replies[0].continuation?.replies.find((reply) => reply.move === 'f1c4')!.scoreCp, 400);
  for (const call of policy.calls) {
    assert.equal(call.opponentRating, settings.opponentRating);
    assert.equal(call.engineRating, settings.engineRating);
  }
});

test('A proven faster root mate is chosen before any practical modeling', async () => {
  const board = new Chess('7k/4Q3/6K1/8/8/8/8/8 w - - 0 1');
  const policy = new MockPolicy(new Map());
  const uci = new MockEngine(() => result([line('e7e8', 99_700), line('e7g7', 99_900)]));
  const chosen = await new TrappyEngine(uci, policy).chooseMove(board.fen(), settings, true);
  assert.equal(chosen.move, 'e7g7');
  assert.equal(policy.calls.length, 0);
  assert.equal(chosen.selected.rootScoreCp, 99_900);
});

test('Winning conversion does not spend 80cp to chase a saturated practical outcome', async () => {
  const policy = new MockPolicy(new Map([
    [start.fen(), rootPolicy()],
    [e4.fen(), [{ move: 'e7e5', probability: 1 }]],
    [d4.fen(), [{ move: 'd7d5', probability: 0.01 }, { move: 'e7e5', probability: 0.99 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === start.fen()) return result([line('e2e4', 800), line('d2d4', 720)]);
    if (fen === e4.fen()) return result([line('e7e5', -800)]);
    assert.equal(fen, d4.fen());
    return result([line(moves[0] ?? 'd7d5', moves[0] === 'e7e5' ? -1400 : -720)]);
  });
  const chosen = await new TrappyEngine(uci, policy).chooseMove(start.fen(), { ...settings, opponentPlies: 1 }, true);
  assert.equal(chosen.move, 'e2e4');
  assert.ok(chosen.selected.rootScoreCp >= 800);
});

test('A second-ply policy failure explicitly falls back to the objective root move', async () => {
  const uci = new MockEngine((fen) => {
    if (fen === start.fen()) return result([line('d2d4', 60), line('e2e4', 0)]);
    assert.equal(fen, d4.fen());
    return result([line('d7d5', -60, ['d7d5', 'c2c4'])]);
  });
  const policy = new MockPolicy(new Map([
    [start.fen(), rootPolicy()], [d4.fen(), [{ move: 'd7d5', probability: 1 }]],
  ]));
  const chosen = await new TrappyEngine(uci, policy).chooseMove(start.fen(), settings, true);
  assert.equal(chosen.move, 'd2d4');
  assert.equal(chosen.policySource, 'stockfish');
  assert.match(chosen.warning!, /Practical analysis unavailable/);
  assert.equal(chosen.selected.policyCoverage, 0);
});

test('Cancellation while waiting for the second policy rejects instead of playing a fallback', async () => {
  let arrive!: () => void;
  const arrived = new Promise<void>((resolve) => { arrive = resolve; });
  let release!: (moves: PolicyMove[]) => void;
  const waiting = new Promise<PolicyMove[]>((resolve) => { release = resolve; });
  const policy: OpponentPolicyProvider = { async predict(fen) {
    if (fen === start.fen()) return [{ move: 'e2e4', probability: 1 }];
    if (fen === e4.fen()) return [{ move: 'e7e5', probability: 1 }];
    assert.equal(fen, e4e5Nf3.fen());
    arrive();
    return waiting;
  } };
  const uci = new MockEngine((fen) => fen === start.fen()
    ? result([line('e2e4', 0)]) : result([line('e7e5', 0, ['e7e5', 'g1f3'])]));
  const engine = new TrappyEngine(uci, policy);
  const pending = engine.chooseMove(start.fen(), settings, true);
  await arrived;
  engine.cancel();
  release([{ move: 'b8c6', probability: 1 }]);
  await assert.rejects(pending, /cancelled/);
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}`, error); }
}
console.log(`${tests.length - failures}/${tests.length} ruthless-engine tests passed.`);
if (failures) process.exitCode = 1;
