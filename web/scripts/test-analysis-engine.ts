import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  TrappyEngine, DEFAULT_ANALYSIS_SETTINGS, moveToUci, playUci,
  type AnalysisEngine, type AnalysisProgress, type CandidateInfo, type OpponentPolicyProvider,
  type PolicyMove, type TrappySettings,
} from '../src/engine/trappy';
import { deriveCandidateLines, formatVariationSan, variationToPgn } from '../src/engine/analysisLines';
import { candidateLines, legalLine, lineTarget } from '../src/components/analysisView';
import type { AnalysisLine, AnalysisResult } from '../src/engine/uci';
import { TRAP_POSITIONS } from '../benchmarks/trap-positions';

const settings: TrappySettings = { ...DEFAULT_ANALYSIS_SETTINGS, opponentPlies: 1, replyCount: 2, replyCoverage: 0.95 };
const tests: { name: string; run: () => Promise<void> }[] = [];
const test = (name: string, run: () => Promise<void>) => tests.push({ name, run });
const start = new Chess();
const after = (fen: string, move: string) => { const board = new Chess(fen); assert.ok(playUci(board, move)); return board; };
const e4 = after(start.fen(), 'e2e4');
const d4 = after(start.fen(), 'd2d4');
function line(move: string, cp: number, pv = [move]): AnalysisLine {
  return { depth: 12, multipv: 1, firstMove: move, score: { type: 'cp', raw: cp, cp }, pv, raw: '' };
}
function result(lines: AnalysisLine[]): AnalysisResult {
  return { bestMove: lines[0]?.firstMove ?? '0000', lines, linesByDepth: new Map([[12, lines]]) };
}
class MockEngine implements AnalysisEngine {
  calls: { fen: string; depth: number; multipv: number; moves: string[] }[] = [];
  constructor(private readonly respond: (fen: string, moves: string[]) => AnalysisResult) {}
  async analyzeFen(fen: string, depth: number, multipv = 1, moves: string[] = []) {
    this.calls.push({ fen, depth, multipv, moves }); return this.respond(fen, moves);
  }
}
class MockPolicy implements OpponentPolicyProvider {
  calls: { fen: string; opponentRating: number; engineRating: number }[] = [];
  constructor(private readonly positions: Map<string, PolicyMove[]>, private readonly legalFallback = false) {}
  async predict(fen: string, opponentRating: number, engineRating: number) {
    this.calls.push({ fen, opponentRating, engineRating });
    const distribution = this.positions.get(fen);
    if (!distribution && this.legalFallback) return [{ move: moveToUci(new Chess(fen).moves({ verbose: true })[0]), probability: 1 }];
    assert.ok(distribution, `Unexpected policy position: ${fen}`); return distribution;
  }
}
function assertLegalLines(fen: string, candidate: CandidateInfo) {
  const lines = deriveCandidateLines(fen, candidate);
  assert.ok(lines.length, 'Every scored candidate must have a replayable line');
  for (const variation of lines) {
    const board = new Chess(fen);
    assert.equal(variation.moves.length, variation.san.length);
    assert.equal(variation.steps.length, variation.moves.length);
    for (let index = 0; index < variation.moves.length; index++) {
      const move = playUci(board, variation.moves[index]);
      assert.ok(move, `Illegal ${variation.kind} move ${variation.moves[index]}`);
      assert.equal(variation.san[index], move.san);
      assert.equal(variation.steps[index].fen, board.fen(), 'Replay snapshots must match the exact board after each move');
    }
  }
  for (const variation of candidateLines(candidate)) {
    const rendered = legalLine(fen, variation.moves);
    assert.equal(rendered.complete, true, 'The UI must render the same legal continuation as the engine');
    assert.deepEqual(rendered.moves, variation.moves);
    const board = new Chess(fen);
    for (let index = 0; index < variation.moves.length; index++) {
      assert.equal(rendered.fens[index], board.fen());
      const move = playUci(board, variation.moves[index]);
      assert.equal(rendered.sans[index], move?.san);
    }
    assert.equal(rendered.fens.at(-1), board.fen());
  }
  return lines;
}

test('Correct first defense can still lead to a second human mistake and is shown as a separate trap branch', async () => {
  const fixture = TRAP_POSITIONS.find((position) => position.id === 'englund')!;
  const entry: CandidateInfo = {
    move: 'e7b4', san: 'Qb4+', rootScoreCp: -200, adjustedScoreCp: 0, riskCp: 0, bonusCp: 200,
    expectedScoreCp: 0, expectedScore: 0.5, objectiveScore: 0.27, policyCoverage: 0.8,
    replies: [{ move: 'f4d2', san: 'Bd2', probability: 0.8, scoreCp: -200, expectedScore: 0.5,
      lossCp: 0, bestDefense: true, punishment: ['b4b2'], continuation: {
        move: 'b4b2', san: 'Qxb2', scoreCp: -200, expectedScore: 0.5, policyCoverage: 0.75,
        replies: [{ move: 'd2c3', san: 'Bc3', probability: 0.75, scoreCp: 900, expectedScore: 0.99, lossCp: 1100,
          punishment: ['f8b4', 'd1d2', 'b4c3', 'd2c3', 'b2c1'] }],
      } }],
    bestDefenseMove: 'f4d2', analyzed: true, status: 'evaluated',
  };
  const rendered = candidateLines(entry);
  const chain = rendered.find((variation) => variation.moves[3] === 'd2c3');
  assert.ok(chain, 'Best-defense first replies must not hide their conditional second trap');
  assert.equal(chain.probability, 0.8 * 0.75);
  assert.equal(chain.conditionalProbability, 0.75);
  assert.equal(legalLine(fixture.fen, chain.moves).complete, true);
  assert.equal(lineTarget(fixture.fen, chain.moves).text, 'Finish with checkmate.');
  assert.ok(rendered.some((variation) => variation.kind === 'defense'));
});

test('Position analysis searches the current side without moving and exposes progress, defense and risk metadata', async () => {
  const policy = new MockPolicy(new Map([
    [start.fen(), [{ move: 'e2e4', probability: 0.5 }, { move: 'd2d4', probability: 0.5 }]],
    [e4.fen(), [{ move: 'e7e5', probability: 1 }]],
    [d4.fen(), [{ move: 'e7e5', probability: 0.8 }, { move: 'd7d5', probability: 0.2 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === start.fen()) return result([line('e2e4', 40, ['e2e4', 'e7e5', 'g1f3']), line('d2d4', 0, ['d2d4', 'd7d5', 'c2c4'])]);
    if (fen === e4.fen()) return result([line('e7e5', -40, ['e7e5', 'g1f3'])]);
    assert.equal(fen, d4.fen());
    return result([moves[0] === 'e7e5' ? line('e7e5', -500, ['e7e5', 'd4e5']) : line('d7d5', 0, ['d7d5', 'c2c4'])]);
  });
  const progress: AnalysisProgress[] = [];
  const sourceFen = start.fen();
  const record = await new TrappyEngine(uci, policy).analyzePosition(sourceFen, settings, (entry) => progress.push(entry));
  assert.equal(start.fen(), sourceFen);
  assert.equal(record.fen, sourceFen);
  assert.equal(record.terminal, undefined);
  assert.ok(record.decision);
  assert.equal(record.decision.move, 'd2d4');
  assert.equal(record.decision.policySource, 'maia');
  assert.ok(progress.some((entry) => entry.stage === 'root'));
  assert.ok(progress.some((entry) => entry.stage === 'replies'));
  assert.equal(progress.at(-1)?.stage, 'complete');
  for (const entry of progress) {
    assert.ok(entry.message.length);
    assert.ok(entry.completed >= 0 && entry.total >= entry.completed);
  }
  const chosen = record.decision.selected;
  assert.equal(chosen.analyzed, true);
  assert.equal(chosen.status, 'evaluated');
  assert.equal(chosen.bestDefenseMove, 'd7d5');
  assert.equal(chosen.replies.find((reply) => reply.move === 'd7d5')?.bestDefense, true);
  assert.deepEqual(chosen.pv, ['d2d4', 'd7d5', 'c2c4']);
  assertLegalLines(sourceFen, chosen);
});

test('Black analysis keeps every outcome in the analyzed mover perspective', async () => {
  const e4e5 = after(e4.fen(), 'e7e5');
  const e4c5 = after(e4.fen(), 'c7c5');
  const policy = new MockPolicy(new Map([
    [e4.fen(), [{ move: 'e7e5', probability: 0.5 }, { move: 'c7c5', probability: 0.5 }]],
    [e4e5.fen(), [{ move: 'b1c3', probability: 0.9 }, { move: 'g1f3', probability: 0.1 }]],
    [e4c5.fen(), [{ move: 'g1f3', probability: 1 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === e4.fen()) return result([line('c7c5', 20, ['c7c5', 'g1f3']), line('e7e5', 0, ['e7e5', 'g1f3'])]);
    if (fen === e4c5.fen()) return result([line('g1f3', -20, ['g1f3', 'b8c6'])]);
    assert.equal(fen, e4e5.fen());
    return result([moves[0] === 'b1c3' ? line('b1c3', -400, ['b1c3', 'g8f6']) : line('g1f3', 0, ['g1f3', 'b8c6'])]);
  });
  const record = await new TrappyEngine(uci, policy).analyzePosition(e4.fen(), settings);
  assert.equal(record.decision?.move, 'e7e5');
  assert.equal(record.decision?.selected.trap?.reply, 'b1c3');
  assert.equal(record.decision?.selected.replies.find((reply) => reply.move === 'b1c3')?.scoreCp, 400);
  assert.equal(policy.calls[0].opponentRating, settings.engineRating);
  assert.equal(policy.calls[0].engineRating, settings.opponentRating);
  assert.equal(policy.calls[1].opponentRating, settings.opponentRating);
  const rendered = assertLegalLines(record.fen, record.decision!.selected);
  assert.match(formatVariationSan(rendered[0]), /^1\.\.\. e5 /);
});

test('Unsafe attractive sacrifices remain labeled and cannot outrank the recommendation', async () => {
  const policy = new MockPolicy(new Map([
    [start.fen(), [{ move: 'e2e4', probability: 0.5 }, { move: 'd2d4', probability: 0.5 }]],
    [e4.fen(), [{ move: 'c7c5', probability: 0.99 }, { move: 'e7e5', probability: 0.01 }]],
    [d4.fen(), [{ move: 'd7d5', probability: 1 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === start.fen()) return result([line('e2e4', 0), line('d2d4', 0)]);
    if (fen === d4.fen()) return result([line('d7d5', 0)]);
    assert.equal(fen, e4.fen());
    return result([line(moves[0] ?? 'e7e5', moves[0] === 'c7c5' ? -700 : 400)]);
  });
  const record = await new TrappyEngine(uci, policy).analyzePosition(start.fen(), { ...settings, maxRiskCp: 100 });
  assert.equal(record.decision?.move, 'd2d4');
  const unsafe = record.decision!.candidates.find((candidate) => candidate.move === 'e2e4')!;
  assert.ok(unsafe.expectedScore > record.decision!.selected.expectedScore);
  assert.equal(unsafe.status, 'outside-risk');
  assert.equal(unsafe.riskCp, 400);
  assert.equal(record.decision!.candidates[0].move, record.decision!.move, 'The first displayed recommendation must respect safety eligibility');
});

test('Légal analysis keeps the exact queen-bait mating punishment legal and replayable', async () => {
  const fixture = TRAP_POSITIONS.find((position) => position.id === 'legal-sound')!;
  const board = new Chess(fixture.fen);
  const bait = after(board.fen(), 'f3e5');
  const quiet = after(board.fen(), 'd2d3');
  const policy = new MockPolicy(new Map([
    [board.fen(), [{ move: 'd2d3', probability: 0.9 }, { move: 'f3e5', probability: 0.1 }]],
    [quiet.fen(), [{ move: 'h5g4', probability: 1 }]],
    [bait.fen(), [{ move: 'h5d1', probability: 0.6 }, { move: 'c6e5', probability: 0.4 }]],
  ]), true);
  const uci = new MockEngine((fen, moves) => {
    if (fen === board.fen()) return result(moves.length
      ? moves.map((move) => line(move, move === 'f3e5' ? 20 : -500))
      : [line('d2d3', 30, ['d2d3', 'h5g4']), line('f3e5', 20, ['f3e5', 'c6e5'])]);
    if (fen === quiet.fen()) return result([line('h5g4', -30)]);
    if (fen !== bait.fen()) return result([line(moves[0] ?? moveToUci(new Chess(fen).moves({ verbose: true })[0]), 500)]);
    return result([moves[0] === 'h5d1'
      ? line('h5d1', -99_700, ['h5d1', 'c4f7', 'e8e7', 'c3d5'])
      : line('c6e5', -20, ['c6e5', 'c4b5'])]);
  });
  const record = await new TrappyEngine(uci, policy).analyzePosition(board.fen(), settings);
  assert.equal(record.decision?.san, 'Nxe5');
  const variations = assertLegalLines(record.fen, record.decision!.selected);
  const mate = variations.find((variation) => variation.moves.includes('h5d1'));
  assert.ok(mate, 'Tempting queen capture must have a visible continuation');
  assert.deepEqual(mate.moves, ['f3e5', 'h5d1', 'c4f7', 'e8e7', 'c3d5']);
  assert.deepEqual(mate.san, ['Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#']);
  assert.equal(new Chess(mate.steps.at(-1)!.fen).isCheckmate(), true);
  assert.ok(mate.targets.some((target) => target.type === 'bait' && target.piece === 'q' && target.square === 'd1' && target.color === 'w'));
  assert.ok(mate.targets.some((target) => target.type === 'mate' && target.piece === 'k' && target.square === 'e7' && target.color === 'b'));
  assert.deepEqual(lineTarget(record.fen, mate.moves).squares, ['e7'], 'Mate highlights the targeted king, not the attacking knight destination');
  assert.ok(variations.some((variation) => variation.moves[1] === 'c6e5'), 'Best defense must remain inspectable beside the bait');
});

test('Promotion moves preserve the promotion piece and correct SAN in variation snapshots', async () => {
  const fen = '7k/P7/8/8/8/8/8/7K w - - 0 1';
  const promoted = after(fen, 'a7a8q');
  const policy = new MockPolicy(new Map([
    [fen, [{ move: 'a7a8q', probability: 1 }]], [promoted.fen(), [{ move: 'h8h7', probability: 1 }]],
  ]), true);
  const uci = new MockEngine((position, moves) => position === fen
    ? result((moves.length ? moves : ['a7a8q']).map((move) => line(move, move === 'a7a8q' ? 900 : -500, move === 'a7a8q' ? ['a7a8q', 'h8h7', 'a8h8'] : [move])))
    : position === promoted.fen() ? result([line('h8h7', -900, ['h8h7', 'a8h8'])])
    : result([line(moves[0] ?? moveToUci(new Chess(position).moves({ verbose: true })[0]), 500)]));
  const record = await new TrappyEngine(uci, policy).analyzePosition(fen, settings);
  assert.equal(record.decision?.move, 'a7a8q');
  const variations = assertLegalLines(fen, record.decision!.selected);
  assert.ok(variations.every((variation) => variation.san[0] === 'a8=Q+'));
  assert.equal(new Chess(variations[0].steps[0].fen).get('a8')?.type, 'q');
});

test('Forced mate roots have complete scored alternatives and a replayable mate instead of empty analysis', async () => {
  const fen = '7k/4Q3/6K1/8/8/8/8/8 w - - 0 1';
  const policy = new MockPolicy(new Map(), true);
  const uci = new MockEngine((position, moves) => position === fen
    ? result((moves.length ? moves : ['e7g7', 'e7f7']).map((move) => line(move, move === 'e7g7' ? 99_900 : move === 'e7f7' ? 0 : -500)))
    : result([line(moves[0] ?? moveToUci(new Chess(position).moves({ verbose: true })[0]), 1000)]));
  const progress: AnalysisProgress[] = [];
  const record = await new TrappyEngine(uci, policy).analyzePosition(fen, settings, (entry) => progress.push(entry));
  assert.ok(record.decision);
  assert.ok(record.decision.selected.rootMate);
  assert.equal(record.decision.policySource, 'maia');
  assert.ok(record.decision.candidates.length >= 2);
  const lines = assertLegalLines(fen, record.decision.selected);
  assert.equal(new Chess(lines[0].steps.at(-1)!.fen).isCheckmate(), true);
  assert.equal(progress.at(-1)?.stage, 'complete');
});

test('Checkmate and draw roots return explicit terminal analysis without querying either engine', async () => {
  const uci = new MockEngine(() => { throw new Error('Terminal roots must not search'); });
  const policy = new MockPolicy(new Map());
  const engine = new TrappyEngine(uci, policy);
  const mate = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';
  const draw = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
  assert.equal((await engine.analyzePosition(mate, settings)).terminal, 'checkmate');
  assert.equal((await engine.analyzePosition(draw, settings)).terminal, 'draw');
  assert.equal(uci.calls.length, 0);
  assert.equal(policy.calls.length, 0);
});

test('Cancelled position analysis rejects without completing or producing fallback recommendations', async () => {
  let finish!: (value: AnalysisResult) => void;
  const uci: AnalysisEngine = { analyzeFen: () => new Promise((resolve) => { finish = resolve; }) };
  const engine = new TrappyEngine(uci, new MockPolicy(new Map()));
  const progress: AnalysisProgress[] = [];
  const pending = engine.analyzePosition(start.fen(), settings, (entry) => progress.push(entry));
  engine.cancel();
  finish(result([line('e2e4', 30)]));
  await assert.rejects(pending, /cancelled/);
  assert.equal(progress.some((entry) => entry.stage === 'complete'), false);
});

test('Unavailable human model returns transparent objective lines with no invented reply probabilities', async () => {
  const uci = new MockEngine(() => result([line('e2e4', 30, ['e2e4', 'e7e5', 'g1f3']), line('d2d4', 20, ['d2d4', 'd7d5'])]));
  const policy = new MockPolicy(new Map([[start.fen(), [{ move: 'a1a8', probability: 1 }]]]));
  const progress: AnalysisProgress[] = [];
  const record = await new TrappyEngine(uci, policy).analyzePosition(start.fen(), settings, (entry) => progress.push(entry));
  assert.equal(record.decision?.policySource, 'stockfish');
  assert.match(record.decision!.warning!, /(?:Practical|Human-reply) analysis unavailable/);
  assert.equal(record.decision!.move, 'e2e4');
  for (const candidate of record.decision!.candidates) {
    assert.equal(candidate.policyCoverage, 0);
    assert.equal(candidate.status, 'objective-only');
    assert.deepEqual(candidate.replies, []);
    assert.equal(candidate.trap, undefined);
    assertLegalLines(record.fen, candidate);
  }
  assert.equal(progress.at(-1)?.stage, 'complete');
});

test('A rare defense uncovered by forced reply scoring becomes the marked and replayed best defense', async () => {
  const policy = new MockPolicy(new Map([
    [start.fen(), [{ move: 'e2e4', probability: 1 }]],
    [e4.fen(), [{ move: 'e7e5', probability: 0.99 }, { move: 'c7c5', probability: 0.01 }]],
  ]));
  const uci = new MockEngine((fen, moves) => fen === start.fen()
    ? result([line('e2e4', 0, ['e2e4', 'e7e5'])])
    : result([line(moves[0] ?? 'e7e5', moves[0] === 'c7c5' ? 300 : 0)]));
  const record = await new TrappyEngine(uci, policy).analyzePosition(start.fen(), { ...settings, replyCoverage: 1 });
  const selected = record.decision!.selected;
  assert.equal(selected.bestDefenseMove, 'c7c5');
  assert.equal(selected.replies.find((reply) => reply.move === 'c7c5')?.bestDefense, true);
  assert.equal(selected.replies.find((reply) => reply.move === 'e7e5')?.bestDefense, false);
  assert.equal(selected.rootScoreCp, -300);
  const defense = deriveCandidateLines(record.fen, selected).find((variation) => variation.kind === 'defense');
  assert.equal(defense?.moves[1], 'c7c5');
  assert.equal(defense?.scoreCp, -300);
});

test('A rare second-turn defense becomes the nested defense flag and exact replayed objective branch', async () => {
  const e4e5Nf3 = after(after(e4.fen(), 'e7e5').fen(), 'g1f3');
  const policy = new MockPolicy(new Map([
    [start.fen(), [{ move: 'e2e4', probability: 1 }]],
    [e4.fen(), [{ move: 'e7e5', probability: 1 }]],
    [e4e5Nf3.fen(), [{ move: 'b8c6', probability: 0.99 }, { move: 'g8f6', probability: 0.01 }]],
  ]));
  const uci = new MockEngine((fen, moves) => {
    if (fen === start.fen()) return result([line('e2e4', 0, ['e2e4', 'e7e5', 'g1f3', 'b8c6'])]);
    if (fen === e4.fen()) return result([line('e7e5', 0, ['e7e5', 'g1f3', 'b8c6'])]);
    assert.equal(fen, e4e5Nf3.fen());
    return result([line(moves[0] ?? 'b8c6', moves[0] === 'g8f6' ? 300 : 0)]);
  });
  const record = await new TrappyEngine(uci, policy).analyzePosition(start.fen(), {
    ...settings, opponentPlies: 2, continuationReplies: 2, continuationBranches: 1, replyCoverage: 1,
  });
  const selected = record.decision!.selected;
  const continuation = selected.replies[0].continuation!;
  assert.equal(continuation.bestDefenseMove, 'g8f6');
  assert.equal(continuation.replies.find((reply) => reply.move === 'g8f6')?.bestDefense, true);
  assert.equal(continuation.replies.find((reply) => reply.move === 'b8c6')?.bestDefense, false);
  const defense = deriveCandidateLines(record.fen, selected).find((variation) => variation.kind === 'defense');
  assert.deepEqual(defense?.moves, ['e2e4', 'e7e5', 'g1f3', 'g8f6']);
  assert.equal(defense?.scoreCp, -300);
});

test('PGN export roundtrips arbitrary roots, Black first moves, promotions, move numbers and results', async () => {
  const whiteRoot = TRAP_POSITIONS.find((position) => position.id === 'legal-sound')!.fen;
  const blackRoot = TRAP_POSITIONS.find((position) => position.id === 'mate-in-one')!.fen;
  for (const [fen, moves, expected] of [
    [whiteRoot, ['f3e5', 'h5d1', 'c4f7', 'e8e7', 'c3d5'], /6\. Nxe5 Bxd1 7\. Bxf7\+ Ke7 8\. Nd5# 1-0/],
    [blackRoot, ['d8h4'], /2\. \.\.\. Qh4# 0-1/],
    ['7k/P7/8/8/8/8/8/7K w - - 0 37', ['a7a8q', 'h8h7'], /37\. a8=Q\+ Kh7 \*/],
  ] as const) {
    const pgn = variationToPgn(fen, [...moves]);
    assert.ok(pgn.includes('[SetUp "1"]'));
    assert.ok(pgn.includes(`[FEN "${fen}"]`));
    assert.match(pgn, expected);
    const roundtrip = new Chess(); roundtrip.loadPgn(pgn);
    const original = new Chess(fen); for (const move of moves) assert.ok(playUci(original, move));
    assert.equal(roundtrip.fen(), original.fen());
  }
  assert.throws(() => variationToPgn(whiteRoot, ['f3f8']), /illegal continuation/);
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}`, error); }
}
console.log(`${tests.length - failures}/${tests.length} analysis-engine tests passed.`);
if (failures) process.exitCode = 1;
