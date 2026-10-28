import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { DEFAULT_TRAPPY_SETTINGS, TrappyEngine, cpToExpectedScore, moveToUci, playUci, utilitySharpness,
  type AnalysisEngine, type OpponentPolicyProvider, type ReplyInfo, type TrappySettings } from '../src/engine/trappy';
import type { AnalysisLine, AnalysisResult, Wdl } from '../src/engine/uci';

type Outcome = { cp: number; wdl?: Wdl };
type Choice = Outcome & { move: string; pv?: string[]; defense?: Outcome; outcomes?: Record<string, Outcome> };
const settings: TrappySettings = { ...DEFAULT_TRAPPY_SETTINGS, trappiness: 0, opponentPlies: 1,
  candidateCount: 2, replyCount: 2, replyCoverage: 1 };
const start = new Chess().fen();
const reverse = (wdl?: Wdl) => wdl && ({ win: wdl.loss, draw: wdl.draw, loss: wdl.win });
const line = (move: string, cp: number, pv = [move], wdl?: Wdl): AnalysisLine => ({
  firstMove: move, score: { type: 'cp', raw: cp, cp }, pv, wdl, depth: 12, multipv: 1, raw: '',
});
const result = (lines: AnalysisLine[]): AnalysisResult => ({ bestMove: lines[0]?.firstMove ?? '0000',
  lines, linesByDepth: new Map([[12, lines]]) });

function fixture(choices: Choice[], random = () => 0, fen = start,
  distributions: Record<string, Record<string, number>> = {}, failPolicy = false) {
  let policyCalls = 0; let engineCalls = 0;
  const root = new Chess(fen);
  const afterMoves = new Map(root.moves({ verbose: true }).map((move) => {
    const after = new Chess(fen); after.move(move); return [after.fen(), moveToUci(move)];
  }));
  const uci: AnalysisEngine = { async analyzeFen(position, _depth, _multipv, moves = []) {
    engineCalls++;
    if (position === fen) return result((moves.length ? moves : choices.map((choice) => choice.move)).map((move) => {
      const choice = choices.find((row) => row.move === move);
      return line(move, choice?.cp ?? -2000, [move], choice?.wdl);
    }).sort((a, b) => b.score.cp - a.score.cp).slice(0, moves.length || _multipv));
    const candidateMove = afterMoves.get(position);
    assert.ok(candidateMove, `Unexpected search: ${position}`);
    const choice = choices.find((row) => row.move === candidateMove);
    const board = new Chess(position);
    const pv = choice?.pv ?? [moveToUci(board.moves({ verbose: true })[0])];
    const reply = moves[0] ?? pv[0];
    assert.ok(playUci(new Chess(position), reply), `Illegal fixture reply: ${reply}`);
    const outcome = choice?.outcomes?.[reply] ?? choice?.defense ?? choice ?? { cp: -2000 };
    return result([line(reply, -outcome.cp, reply === pv[0] ? pv : [reply], reverse(outcome.wdl))]);
  } };
  const policy: OpponentPolicyProvider = { async predict(position) {
    policyCalls++;
    if (failPolicy) throw new Error('Model unavailable');
    const custom = distributions[position];
    if (custom) return Object.entries(custom).map(([move, probability]) => ({ move, probability }));
    return new Chess(position).moves({ verbose: true }).slice(0, 1)
      .map((move) => ({ move: moveToUci(move), probability: 1 }));
  } };
  return { engine: new TrappyEngine(uci, policy, random), engineCalls: () => engineCalls, policyCalls: () => policyCalls };
}
const quiet: Choice[] = [{ move: 'e2e4', cp: 20, pv: ['e7e5'] }, { move: 'd2d4', cp: 0, pv: ['d7d5'] }];
const after = (move: string) => { const board = new Chess(); playUci(board, move); return board.fen(); };

test('Draw aversion independently uses actual mover-perspective WDL, leaving objective scores intact', async () => {
  const choices: Choice[] = [{ ...quiet[0], wdl: { win: 0.1, draw: 0.85, loss: 0.05 } },
    { ...quiet[1], wdl: { win: 0.45, draw: 0.1, loss: 0.45 } }];
  const neutral = await fixture(choices).engine.chooseMove(start, settings, true);
  const run = fixture(choices);
  const wild = await run.engine.chooseMove(start, { ...settings, drawAversion: 1 }, true);
  assert.equal(neutral.move, 'e2e4'); assert.equal(wild.move, 'd2d4');
  assert.deepEqual(wild.selected.objectiveWdl, choices[1].wdl);
  assert.equal(wild.selected.style!.drawProbability, 0.1);
  assert.equal(wild.selected.style!.drawAversionPenaltyCp, 6);
  assert.equal(wild.selected.style!.drawAversionAvailable, true);
  assert.equal(wild.selected.expectedScore, 0.5); assert.equal(wild.selected.rootScoreCp, 0);
  assert.equal(run.policyCalls(), 0);
});

test('WDL follows the conservative defense, while absent WDL contributes no invented draw estimate', async () => {
  const choices: Choice[] = [{ ...quiet[0], cp: 50, wdl: { win: 0.6, draw: 0.2, loss: 0.2 },
    defense: { cp: 10, wdl: { win: 0.1, draw: 0.85, loss: 0.05 } } },
  { ...quiet[1], cp: 5, wdl: { win: 0.45, draw: 0.1, loss: 0.45 } }];
  const decision = await fixture(choices).engine.chooseMove(start, { ...settings, drawAversion: 1 }, true);
  const e4 = decision.candidates.find((row) => row.move === 'e2e4')!;
  assert.equal(e4.rootScoreCp, 10); assert.equal(e4.objectiveWdl!.draw, 0.85);
  assert.equal(decision.move, 'd2d4');
  const unavailable = await fixture(quiet).engine.chooseMove(start, { ...settings, drawAversion: 1 }, true);
  assert.equal(unavailable.move, 'e2e4');
  assert.equal(unavailable.selected.style!.drawProbability, undefined);
  assert.equal(unavailable.selected.style!.drawAversionAvailable, false);
  assert.equal(unavailable.selected.style!.drawAversionPenaltyCp, 0);
  const rootWdl = { win: 0.3, draw: 0.6, loss: 0.1 };
  const equal = await fixture([{ ...quiet[0], wdl: rootWdl, defense: { cp: quiet[0].cp } }, quiet[1]])
    .engine.chooseMove(start, { ...settings, drawAversion: 1 }, true);
  assert.deepEqual(equal.candidates.find((row) => row.move === 'e2e4')!.objectiveWdl, rootWdl,
    'equal-score verification without WDL must preserve the root model');
  const stronger = await fixture([{ ...quiet[0], wdl: rootWdl, defense: { cp: quiet[0].cp - 1 } }, quiet[1]])
    .engine.chooseMove(start, { ...settings, drawAversion: 1 }, true);
  assert.equal(stronger.candidates.find((row) => row.move === 'e2e4')!.objectiveWdl, undefined,
    'a worse verified defense without WDL cannot inherit the better root model');
});

test('Sharpness alone activates Maia and rewards utility dispersion without changing model expectations', async () => {
  const choices: Choice[] = [quiet[0], { ...quiet[1], outcomes: { e7e5: { cp: 800 } } }];
  const distributions = { [after('e2e4')]: { e7e5: 1 }, [after('d2d4')]: { d7d5: 0.5, e7e5: 0.5 } };
  const run = fixture(choices, () => 0, start, distributions);
  const decision = await run.engine.chooseMove(start, { ...settings, sharpness: 1 }, true);
  assert.equal(decision.move, 'd2d4'); assert.ok(run.policyCalls() > 0);
  assert.equal(decision.policySource, 'maia');
  assert.equal(decision.selected.rootScoreCp, 0);
  assert.equal(decision.selected.expectedScore, 0.5 * 0.5 + 0.5 * cpToExpectedScore(800));
  assert.ok(decision.selected.style!.sharpness! > 0.4);
  assert.ok(decision.selected.style!.sharpnessBonusCp! <= 60);
  assert.equal(decision.selected.style!.sharpnessAvailable, true);
  assert.equal(decision.candidates.find((row) => row.move === 'e2e4')!.style!.sharpness, 0);
});

test('Independent positional nominations discover a quiet pawn advance outside the initial shortlist', async () => {
  const fen = '6k1/5ppp/8/8/8/8/6P1/K5R1 w - - 0 1';
  const run = fixture([{ move: 'g2g3', cp: 1, pv: ['h7h6'] }, { move: 'g2g4', cp: 0, pv: ['h7h6'] }], () => 0, fen);
  const decision = await run.engine.chooseMove(fen, { ...settings, candidateCount: 1, pawnStorm: 1 }, true);
  assert.equal(decision.move, 'g2g4');
  assert.equal(decision.selected.rootScoreCp, 0);
  assert.ok(decision.selected.style!.pawnStormBonusCp > 0);
  assert.equal(run.policyCalls(), 0);
});

test('An exact terminal draw supplies real certainty rather than requiring model WDL', async () => {
  const fen = '7k/4Q3/6K1/8/8/8/8/8 w - - 0 1';
  const board = new Chess(fen);
  const san = playUci(new Chess(fen), 'e7f7')!.san;
  const engine = fixture(quiet).engine;
  const evaluated = await engine.evaluateCandidate(board, { move: 'e7f7', san, rootScoreCp: 0,
    adjustedScoreCp: 0, riskCp: 0, bonusCp: 0, expectedScoreCp: 0, expectedScore: 0.5,
    objectiveScore: 0.5, policyCoverage: 0, replies: [] }, 0, { ...settings, drawAversion: 1, sharpness: 1 });
  assert.deepEqual(evaluated.objectiveWdl, { win: 0, draw: 1, loss: 0 });
  assert.equal(evaluated.style!.drawAversionPenaltyCp, 60);
  assert.equal(evaluated.style!.sharpness, 0);
  assert.equal(evaluated.expectedScore, 0.5); assert.equal(evaluated.adjustedScoreCp, -60);
});

test('A refined continuation ending in stalemate replaces a tied finite-search WDL estimate', async () => {
  const fen = '7k/4Q3/6K1/8/8/8/8/8 w - - 0 1';
  const board = new Chess(fen);
  const san = playUci(new Chess(fen), 'e7e5')!.san;
  const afterCandidate = new Chess(fen); playUci(afterCandidate, 'e7e5');
  const run = fixture([{ move: 'e7e5', cp: 0, pv: ['h8g8', 'e5f6'],
    wdl: { win: 0.25, draw: 0.5, loss: 0.25 } }], () => 0, fen,
  { [afterCandidate.fen()]: { h8g8: 1 } });
  const evaluated = await run.engine.evaluateCandidate(board, { move: 'e7e5', san, rootScoreCp: 0,
    adjustedScoreCp: 0, riskCp: 0, bonusCp: 0, expectedScoreCp: 0, expectedScore: 0.5,
    objectiveScore: 0.5, objectiveWdl: { win: 0.25, draw: 0.5, loss: 0.25 }, policyCoverage: 0, replies: [] }, 0,
  { ...settings, trappiness: 1, sharpness: 1, drawAversion: 1, opponentPlies: 2 });
  assert.deepEqual(evaluated.objectiveWdl, { win: 0, draw: 1, loss: 0 });
  assert.equal(evaluated.style!.drawAversionPenaltyCp, 60);
  assert.equal(evaluated.style!.sharpness, 0);
});

test('Sharpness retains omitted probability mass and nested joint outcomes', () => {
  const reply = (probability: number, expectedScore: number): ReplyInfo => ({ move: 'a7a6', san: 'a6',
    probability, expectedScore, scoreCp: 0, lossCp: 0, punishment: [] });
  assert.equal(utilitySharpness([reply(0.5, 1)], 0.5, 0), 1);
  assert.ok(Math.abs(utilitySharpness([reply(0.1, 1)], 0.1, 0) - 0.6) < 1e-12);
  const branch = reply(0.5, 0.5);
  branch.continuation = { move: 'a2a3', san: 'a3', scoreCp: 0, expectedScore: 0.5, policyCoverage: 1,
    replies: [reply(0.5, 0), reply(0.5, 1)] };
  assert.ok(Math.abs(utilitySharpness([branch], 0.5, 0.5) - Math.sqrt(0.5)) < 1e-12);
});

test('Variety samples only verified eligible choices, and Analyze exposes the same chances without sampling', async () => {
  const choose = (random: number, analysis = false) => fixture(quiet, () => random).engine.chooseMove(start,
    { ...settings, variety: 1 }, true, { analysis });
  const first = await choose(0); const second = await choose(0.999999);
  assert.equal(first.move, 'e2e4'); assert.equal(second.move, 'd2d4');
  assert.equal(second.selection!.method, 'sampled'); assert.equal(second.selection!.temperatureCp, 100);
  assert.equal(second.selection!.randomDraw, 0.999999);
  const expected = 1 / (1 + Math.exp(-20 / 100));
  assert.ok(Math.abs(first.candidates.find((row) => row.move === 'e2e4')!.selectionProbability! - expected) < 1e-12);
  const analysis = await choose(0.999999, true);
  assert.equal(analysis.move, 'e2e4'); assert.equal(analysis.selection!.method, 'analysis');
  assert.equal(analysis.selection!.randomDraw, undefined);
  for (const candidate of first.candidates) assert.equal(candidate.selectionProbability,
    analysis.candidates.find((row) => row.move === candidate.move)!.selectionProbability);
  assert.ok(Math.abs(second.selection!.probabilities.reduce((sum, row) => sum + row.probability, 0) - 1) < 1e-12);
  const deterministic = await fixture(quiet, () => { throw new Error('Should not sample'); })
    .engine.chooseMove(start, { ...settings, drawAversion: 1, variety: 0 }, true);
  assert.equal(deterministic.move, 'e2e4'); assert.equal(deterministic.selection!.method, 'best');
});

test('Maximum variety cannot cross evaluation risk or displace a proven faster mate', async () => {
  const risky = await fixture(quiet, () => 0.999999).engine.chooseMove(start,
    { ...settings, variety: 1, sharpness: 0, maxRiskCp: 0 }, true);
  assert.equal(risky.move, 'e2e4');
  assert.equal(risky.candidates.find((row) => row.move === 'd2d4')!.selectionProbability, 0);
  assert.ok(risky.candidates.filter((row) => row.selectionProbability! > 0).every((row) => row.riskCp === 0));
  const fen = '7k/4Q3/6K1/8/8/8/8/8 w - - 0 1';
  const run = fixture([{ move: 'e7e8', cp: 99_700 }, { move: 'e7g7', cp: 99_900 }],
    () => { throw new Error('Mate must not sample'); }, fen);
  const mate = await run.engine.chooseMove(fen, { ...settings, variety: 1, sharpness: 1,
    sacrifice: 1, drawAversion: 1, maxRiskCp: 300 }, true);
  assert.equal(mate.move, 'e7g7'); assert.equal(run.policyCalls(), 0); assert.equal(mate.selection!.temperatureCp, 0);
});

test('Unavailable sharpness preserves independent style and bounded variety with explicit availability', async () => {
  const decision = await fixture(quiet, () => 0.99999, start, {}, true).engine.chooseMove(start,
    { ...settings, sharpness: 1, drawAversion: 1, variety: 1 }, true);
  assert.match(decision.warning!, /Human-reply analysis unavailable/);
  assert.equal(decision.policySource, 'stockfish'); assert.equal(decision.selection!.method, 'sampled');
  assert.equal(decision.selected.style!.sharpnessAvailable, false);
  assert.equal(decision.selected.style!.sharpnessBonusCp, 0);
  assert.equal(decision.selected.policyCoverage, 0);
});

test('Every new setting rejects nonfinite and out-of-range values before searching', async () => {
  for (const key of ['pawnStorm', 'kingCaution', 'sacrifice', 'sharpness', 'queenRetention', 'drawAversion', 'variety'] as const) {
    for (const value of [NaN, Infinity, -0.01, 1.01]) {
      const run = fixture(quiet);
      await assert.rejects(run.engine.chooseMove(start, { ...settings, [key]: value }, true), /Invalid/);
      assert.equal(run.engineCalls(), 0); assert.equal(run.policyCalls(), 0);
    }
  }
});
