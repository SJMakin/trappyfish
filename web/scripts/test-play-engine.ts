import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { DEFAULT_TRAPPY_SETTINGS, TrappyEngine, cpToExpectedScore, type AnalysisEngine,
  type CandidateInfo, type OpponentPolicyProvider } from '../src/engine/trappy';
import type { AnalysisLine, AnalysisResult } from '../src/engine/uci';

const position = (...moves: string[]) => { const board = new Chess(); moves.forEach((move) => board.move(move)); return board; };
const line = (move: string, cp: number, pv = [move]): AnalysisLine => ({ firstMove: move, pv,
  depth: 12, multipv: 1, score: { type: 'cp', raw: cp, cp }, raw: '' });
const result = (lines: AnalysisLine[]): AnalysisResult => ({ bestMove: lines[0].firstMove, lines, linesByDepth: new Map([[12, lines]]) });
const start = new Chess();
const noPolicy: OpponentPolicyProvider = { async predict() { throw new Error('No policy should be requested.'); } };
const plain = { ...DEFAULT_TRAPPY_SETTINGS, trappiness: 0 };
for (const bookCp of [40, -200]) {
  const uci: AnalysisEngine = { async analyzeFen(fen, _depth, _width, moves = []) {
    if (fen === start.fen()) return result(moves.length ? moves.map((move) => line(move, bookCp)) : [line('e2e4', 100), line('d2d4', 80)]);
    const move = fen === position('c4').fen() ? 'e7e5' : 'd7d5';
    return result([line(move, fen === position('c4').fen() ? -bookCp : fen === position('e4').fen() ? -100 : -80)]);
  } };
  const choice = await new TrappyEngine(uci, noPolicy).chooseMove(start.fen(), plain, true, { bookMoves: ['c2c4'] });
  assert.equal(choice.move, bookCp > 0 ? 'c2c4' : 'e2e4');
  assert.equal(choice.provenance?.source, bookCp > 0 ? 'opening-book' : 'search');
  assert.equal(choice.provenance?.bookExitReason, bookCp > 0 ? undefined : 'outside-risk');
  assert.ok(choice.selected.riskCp <= plain.maxRiskCp);
  const disabled = await new TrappyEngine(uci, noPolicy).chooseMove(start.fen(),
    { ...DEFAULT_TRAPPY_SETTINGS, aggression: 1, sharpness: 1, variety: 1 }, false, { bookMoves: ['c2c4'] });
  assert.equal(disabled.move, choice.move);
  assert.equal(disabled.selection?.method, 'best');
  assert.equal(disabled.styleApplied, false);
}
{
  const uci: AnalysisEngine = { async analyzeFen(fen) { return result([line(fen === start.fen() ? 'e2e4' : 'e7e5', 0)]); } };
  const choice = await new TrappyEngine(uci, noPolicy).chooseMove(start.fen(), plain, true, { bookMoves: ['a1a8'] });
  assert.equal(choice.provenance?.bookExitReason, 'no-legal-book-move');
}
{
  const board = position('f3', 'e5', 'g4');
  const mate: AnalysisLine = { ...line('d8h4', 100000), score: { type: 'mate', raw: 1, cp: 100000 } };
  const uci: AnalysisEngine = { async analyzeFen() { return result([mate]); } };
  const choice = await new TrappyEngine(uci, noPolicy).chooseMove(board.fen(), plain, true, { bookMoves: ['b8c6'] });
  assert.equal(choice.move, 'd8h4');
  assert.equal(choice.provenance?.bookExitReason, 'forced-mate');
}

const afterE4 = position('e4');
const afterE5 = position('e4', 'e5');
const afterNf3 = position('e4', 'e5', 'Nf3');
const afterBc4 = position('e4', 'e5', 'Bc4');
function candidate(): CandidateInfo { return { move: 'e2e4', san: 'e4', rootScoreCp: 0, adjustedScoreCp: 0,
  riskCp: 0, bonusCp: 0, expectedScoreCp: 0, expectedScore: .5, objectiveScore: .5, policyCoverage: 0, replies: [] }; }
for (const rareDefense of [false, true]) {
  let ownSearches = 0;
  const uci: AnalysisEngine = { async analyzeFen(fen, _depth, width, moves = []) {
    if (fen === afterE4.fen()) return result([line('e7e5', 0, ['e7e5', 'g1f3'])]);
    if (fen === afterE5.fen()) { ownSearches++; assert.equal(width, 2); return result([line('g1f3', 0), line('f1c4', -20)]); }
    assert.ok(fen === afterNf3.fen() || fen === afterBc4.fen());
    const move = moves[0] ?? 'b8c6';
    const cp = move === 'a7a6' ? 500 : move === 'd7d6' ? (fen === afterBc4.fen() ? -600 : -20) : fen === afterBc4.fen() ? 20 : 0;
    return result([line(move, cp)]);
  } };
  const policy: OpponentPolicyProvider = { async predict(fen) {
    if (fen === afterE4.fen()) return [{ move: 'e7e5', probability: 1 }];
    return [{ move: 'b8c6', probability: .4 }, { move: 'd7d6', probability: .5 },
      ...(rareDefense && fen === afterBc4.fen() ? [{ move: 'a7a6', probability: .1 }] : [{ move: 'h7h6', probability: .1 }])];
  } };
  const choice = await new TrappyEngine(uci, policy).evaluateCandidate(start, candidate(), 0,
    { ...DEFAULT_TRAPPY_SETTINGS, continuationCandidates: 2, continuationBranches: 1,
      continuationReplies: rareDefense ? 3 : 2, replyCoverage: rareDefense ? 1 : .95 });
  assert.equal(ownSearches, 1);
  const branch = choice.replies[0];
  assert.equal(branch.continuation?.move, rareDefense ? 'g1f3' : 'f1c4');
  assert.equal(branch.punishment[0], branch.continuation?.move, 'Replay follows the chosen own continuation.');
  assert.equal(branch.continuation?.alternatives?.length, 2);
  assert.equal(branch.continuation?.alternatives?.filter((row) => row.selected).length, 1);
  assert.ok(Math.abs(branch.continuation!.policyCoverage - (rareDefense ? 1 : .9)) < 1e-10);
  if (!rareDefense) assert.ok(Math.abs(choice.expectedScore - (.5 * cpToExpectedScore(600) + .5 * cpToExpectedScore(-20))) < 1e-10,
    'The omitted10% keeps defensive utility rather than being renormalized.');
  assert.ok(choice.rootScoreCp >= -20, 'A rare defense disqualifies the unsound alternative.');
  assert.ok(choice.expectedScore <= 1 && choice.expectedScore >= 0);
}
{
  let queriesAfterHuman = 0;
  const uci: AnalysisEngine = { async analyzeFen(fen, _depth, _width, moves = []) {
    if (fen === afterE5.fen()) queriesAfterHuman++;
    return result(fen === afterE4.fen() ? [line('e7e5', 0, ['e7e5', 'g1f3'])] : [line(moves[0] ?? 'b8c6', 0)]);
  } };
  const policy: OpponentPolicyProvider = { async predict(fen) { return [{ move: fen === afterE4.fen() ? 'e7e5' : 'b8c6', probability: 1 }]; } };
  const choice = await new TrappyEngine(uci, policy).evaluateCandidate(start, candidate(), 0, DEFAULT_TRAPPY_SETTINGS);
  assert.equal(queriesAfterHuman, 0, 'Old settings retain one PV continuation and its old workload.');
  assert.equal(choice.replies[0].continuation?.alternatives, undefined);
  assert.equal(choice.expectedScore, cpToExpectedScore(0));
}
console.log('Play engine tests passed: book discovery/safety/provenance, forced mate, continuation width, defensive rejection, replay, and legacy defaults.');
