import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { DEFAULT_TRAPPY_SETTINGS, TrappyEngine, moveToUci, playUci,
  type AnalysisEngine, type OpponentPolicyProvider, type TrappySettings } from '../src/engine/trappy';
import { scorePlayingStyle, styleBonusCp } from '../src/engine/playingStyle';
import type { AnalysisLine, AnalysisResult } from '../src/engine/uci';

const settings: TrappySettings = { ...DEFAULT_TRAPPY_SETTINGS, trappiness: 0, opponentPlies: 1 };
type Choice = { move: string; cp: number; pv?: string[]; outcomes?: Record<string, number> };
function line(move: string, cp: number, pv = [move]): AnalysisLine {
  return { firstMove: move, score: { type: 'cp', raw: cp, cp }, pv, depth: 12, multipv: 1, raw: '' };
}
function result(lines: AnalysisLine[]): AnalysisResult {
  return { bestMove: lines[0].firstMove, lines, linesByDepth: new Map([[12, lines]]) };
}
function mock(fen: string, choices: Choice[], probabilities: Record<string, Record<string, number>> = {}) {
  let policyCalls = 0;
  const uci: AnalysisEngine = { async analyzeFen(position, _depth, _multipv, moves = []) {
    if (position === fen) return result(moves.length
      ? moves.map((move) => line(move, choices.find((choice) => choice.move === move)?.cp ?? -2000))
      : choices.map((choice) => line(choice.move, choice.cp)).sort((a, b) => b.score.cp - a.score.cp));
    const choice = choices.find((choice) => {
      const after = new Chess(fen); playUci(after, choice.move); return after.fen() === position;
    });
    assert.ok(choice, `Unexpected search: ${position}`);
    const board = new Chess(position);
    const pv = choice.pv ?? [moveToUci(board.moves({ verbose: true })[0])];
    const reply = moves[0] ?? pv[0];
    assert.ok(playUci(new Chess(position), reply), `Illegal fixture defense: ${reply}`);
    return result([line(reply, -(choice.outcomes?.[reply] ?? choice.cp), reply === pv[0] ? pv : [reply])]);
  } };
  const policy: OpponentPolicyProvider = { async predict(position) {
    policyCalls++;
    if (position === fen) return choices.map((choice) => ({ move: choice.move, probability: 1 / choices.length }));
    return Object.entries(probabilities[position] ?? {}).map(([move, probability]) => ({ move, probability }));
  } };
  return { engine: new TrappyEngine(uci, policy), calls: () => policyCalls, uci };
}
const attackFen = '6k1/5ppp/8/8/3Q4/8/5PPP/6K1 w - - 0 1';
const attackChoices = [{ move: 'd4a4', cp: 2, pv: ['h7h6'] }, { move: 'd4g4', cp: 0, pv: ['h7h6'] }];
const tensionBoard = new Chess();
for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) tensionBoard.move(san);
const tensionChoices = [{ move: 'b5c6', cp: 5, pv: ['d7c6'] }, { move: 'b5a4', cp: 0, pv: ['g8f6'] }];

test('Aggression changes a choice independently of trappiness and never calls Maia at zero trappiness', async () => {
  const neutral = mock(attackFen, attackChoices);
  const attacking = mock(attackFen, attackChoices);
  assert.equal((await neutral.engine.chooseMove(attackFen, settings, true)).move, 'd4a4');
  const choice = await attacking.engine.chooseMove(attackFen, { ...settings, aggression: 1 }, true);
  assert.equal(choice.move, 'd4g4');
  assert.equal(choice.styleApplied, true);
  assert.equal(attacking.calls(), 0);
  assert.equal(choice.selected.expectedScore, 0.5);
  assert.equal(choice.selected.rootScoreCp, 0);
  assert.equal(choice.selected.policyCoverage, 0);
  assert.ok(choice.selected.style!.aggressionBonusCp > 8);
});

test('Tension favours retaining the bishop and unresolved exchanges without increasing aggression', async () => {
  const neutral = mock(tensionBoard.fen(), tensionChoices);
  const tension = mock(tensionBoard.fen(), tensionChoices);
  assert.equal((await neutral.engine.chooseMove(tensionBoard.fen(), settings, true)).move, 'b5c6');
  const decision = await tension.engine.chooseMove(tensionBoard.fen(), { ...settings, tension: 1 }, true);
  assert.equal(decision.move, 'b5a4');
  assert.equal(decision.selected.style!.aggressionBonusCp, 0);
  const exchanged = decision.candidates.find((candidate) => candidate.move === 'b5c6')!;
  assert.ok(decision.selected.style!.tensionBonusCp > exchanged.style!.tensionBonusCp + 5);
});

test('Combined style preferences cannot cross the shared risk limit', async () => {
  const run = mock(attackFen, attackChoices);
  const decision = await run.engine.chooseMove(attackFen, { ...settings, aggression: 1, tension: 1, maxRiskCp: 0 }, true);
  assert.equal(decision.move, 'd4a4');
  assert.equal(decision.riskLimitCp, 0);
  assert.equal(decision.selected.riskCp, 0);
});

test('Style scoring is bounded and the candidate search preserves the original position', async () => {
  const board = new Chess(attackFen); const before = board.fen();
  for (const move of board.moves({ verbose: true })) {
    const style = scorePlayingStyle(before, moveToUci(move), [], { aggression: 1, tension: 1 });
    assert.ok(style.aggressionBonusCp >= 0 && style.aggressionBonusCp <= 60);
    assert.ok(style.tensionBonusCp >= 0 && style.tensionBonusCp <= 40);
    assert.ok(styleBonusCp(style) <= 100);
  }
  assert.equal(board.fen(), before);
});

test('Aggression scores Black attacks in the same perspective as White attacks', () => {
  const blackFen = `${attackFen.split(' ')[0].split('/').reverse().map((rank) => rank.replace(/[a-zA-Z]/g,
    (piece) => piece === piece.toLowerCase() ? piece.toUpperCase() : piece.toLowerCase())).join('/')} b - - 0 1`;
  const white = scorePlayingStyle(attackFen, 'd4g4', ['h7h6'], { aggression: 1, tension: 1 });
  const black = scorePlayingStyle(blackFen, 'd5g5', ['h2h3'], { aggression: 1, tension: 1 });
  assert.deepEqual(black, white);
});

test('Style changes ranking without changing the model score, probabilities, or verified risk', async () => {
  const probabilities: Record<string, Record<string, number>> = {};
  for (const choice of attackChoices) {
    const board = new Chess(attackFen); playUci(board, choice.move); probabilities[board.fen()] = { h7h6: 1 };
  }
  const neutral = await mock(attackFen, attackChoices, probabilities).engine.chooseMove(attackFen, { ...settings, trappiness: 1 }, true);
  const styled = await mock(attackFen, attackChoices, probabilities).engine.chooseMove(attackFen,
    { ...settings, trappiness: 1, aggression: 1, tension: 1 }, true);
  assert.equal(neutral.move, 'd4a4'); assert.equal(styled.move, 'd4g4');
  for (const before of neutral.candidates.filter((candidate) => candidate.analyzed)) {
    const after = styled.candidates.find((candidate) => candidate.move === before.move)!;
    assert.equal(after.rootScoreCp, before.rootScoreCp);
    assert.equal(after.expectedScore, before.expectedScore);
    assert.equal(after.mistakeProbability, before.mistakeProbability);
    assert.equal(after.riskCp, before.riskCp);
    assert.deepEqual(after.replies, before.replies);
  }
});

test('Trappiness independently favours a likely human mistake', async () => {
  const fen = new Chess().fen();
  const choices = [{ move: 'd2d4', cp: 40, pv: ['d7d5'] },
    { move: 'e2e4', cp: 0, pv: ['e7e5'], outcomes: { c7c5: 400 } }];
  const afterE4 = new Chess(); afterE4.move('e4');
  const afterD4 = new Chess(); afterD4.move('d4');
  const probabilities = { [afterE4.fen()]: { e7e5: 0.2, c7c5: 0.8 }, [afterD4.fen()]: { d7d5: 1 } };
  assert.equal((await mock(fen, choices, probabilities).engine.chooseMove(fen, settings, true)).move, 'd2d4');
  assert.equal((await mock(fen, choices, probabilities).engine.chooseMove(fen, { ...settings, trappiness: 1 }, true)).move, 'e2e4');
});

test('The visible winning-risk control changes eligibility and stays capped by the main risk limit', async () => {
  const fen = new Chess().fen();
  const choices = [{ move: 'e2e4', cp: 800, pv: ['e7e5'] },
    { move: 'd2d4', cp: 720, pv: ['d7d5'], outcomes: { e7e5: 1400 } }];
  const afterE4 = new Chess(); afterE4.move('e4');
  const afterD4 = new Chess(); afterD4.move('d4');
  const probabilities = { [afterE4.fen()]: { e7e5: 1 }, [afterD4.fen()]: { d7d5: 0.01, e7e5: 0.99 } };
  const choose = (winningRiskCp: number, maxRiskCp = 100) => mock(fen, choices, probabilities).engine.chooseMove(fen,
    { ...settings, trappiness: 1, winningRiskCp, maxRiskCp }, true);
  assert.equal((await choose(40)).move, 'e2e4');
  assert.equal((await choose(100)).move, 'd2d4');
  const capped = await choose(300, 25);
  assert.equal(capped.move, 'e2e4'); assert.equal(capped.riskLimitCp, 25);
});

test('Model failure preserves attacking preferences and reports the fallback', async () => {
  const run = mock(attackFen, attackChoices);
  const policy: OpponentPolicyProvider = { async predict() { throw new Error('Model unavailable'); } };
  const decision = await new TrappyEngine(run.uci, policy).chooseMove(attackFen,
    { ...settings, trappiness: 1, aggression: 1 }, true);
  assert.equal(decision.move, 'd4g4');
  assert.equal(decision.policySource, 'stockfish');
  assert.match(decision.warning!, /using Stockfish and your playing style/);
  assert.equal(decision.selected.policyCoverage, 0);
});

test('Maximum style preferences preserve a proven faster mate', async () => {
  const fen = '7k/4Q3/6K1/8/8/8/8/8 w - - 0 1';
  const run = mock(fen, [{ move: 'e7e8', cp: 99_700 }, { move: 'e7g7', cp: 99_900 }]);
  const decision = await run.engine.chooseMove(fen, { ...settings, trappiness: 1, aggression: 1, tension: 1, maxRiskCp: 300 }, true);
  assert.equal(decision.move, 'e7g7'); assert.equal(run.calls(), 0);
});

test('All-zero style controls and explicit Stockfish mode bypass human/style selection', async () => {
  const zero = mock(attackFen, attackChoices);
  const plain = mock(attackFen, attackChoices);
  assert.equal((await zero.engine.chooseMove(attackFen, settings, true)).move, 'd4a4');
  assert.equal((await plain.engine.chooseMove(attackFen, { ...settings, trappiness: 1, aggression: 1, tension: 1 }, false)).move, 'd4a4');
  assert.equal(zero.calls(), 0); assert.equal(plain.calls(), 0);
});

test('Invalid explicit control values are rejected before either engine is queried', async () => {
  for (const invalid of [{ trappiness: NaN }, { aggression: 1.01 }, { tension: -0.1 }, { tension: Infinity }, { winningRiskCp: -1 }]) {
    const run = mock(attackFen, attackChoices);
    await assert.rejects(run.engine.chooseMove(attackFen, { ...settings, ...invalid }, true), /Invalid/);
    assert.equal(run.calls(), 0);
  }
});
