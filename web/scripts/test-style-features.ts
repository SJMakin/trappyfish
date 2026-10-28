import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { hasPlayingStyle, scorePlayingStyle, styleBonusCp, type StylePreferences } from '../src/engine/playingStyle';

const all: StylePreferences = { aggression: 1, tension: 1, pawnStorm: 1, kingCaution: 1, sacrifice: 1, queenRetention: 1 };
const attackFen = '6k1/5ppp/8/8/3Q4/8/5PPP/6K1 w - - 0 1';
const stormFen = '6k1/5ppp/8/8/8/8/6P1/K5R1 w - - 0 1';
const giftFen = 'r1bq1rk1/ppp2ppp/2n1p3/3p4/3P4/3B1N2/PPP2PPP/RNBQ1RK1 w - - 0 8';
function continuation(fen: string, san: string[]) {
  const board = new Chess(fen);
  return san.map((text) => { const move = board.move(text); return move.from + move.to + (move.promotion ?? ''); });
}
function flipFen(fen: string) {
  const parts = fen.split(' ');
  parts[0] = parts[0].split('/').reverse().map((rank) => rank.replace(/[a-zA-Z]/g,
    (piece) => piece === piece.toLowerCase() ? piece.toUpperCase() : piece.toLowerCase())).join('/');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  return parts.join(' ');
}
const flipMove = (move: string) => `${move[0]}${9 - Number(move[1])}${move[2]}${9 - Number(move[3])}${move.slice(4)}`;

test('Every style preference has an independent, bounded contribution; missing controls remain neutral', () => {
  const zero = scorePlayingStyle(attackFen, 'd4g4', ['h7h6'], {});
  assert.equal(styleBonusCp(zero), 0);
  for (const [setting, contribution] of [
    ['aggression', 'aggressionBonusCp'], ['tension', 'tensionBonusCp'], ['pawnStorm', 'pawnStormBonusCp'],
    ['kingCaution', 'kingCautionPenaltyCp'], ['sacrifice', 'sacrificeBonusCp'], ['queenRetention', 'queenRetentionBonusCp'],
  ] as const) {
    const score = scorePlayingStyle(attackFen, 'd4g4', ['h7h6'], { [setting]: 1 });
    for (const field of ['aggressionBonusCp', 'tensionBonusCp', 'pawnStormBonusCp', 'kingCautionPenaltyCp', 'sacrificeBonusCp', 'queenRetentionBonusCp'] as const) {
      if (field !== contribution) assert.equal(score[field], 0, `${setting} cannot apply ${field}`);
    }
  }
  assert.equal(styleBonusCp({ aggressionBonusCp: 12, tensionBonusCp: 3 }), 15, 'legacy partial scores remain supported');
  assert.equal(styleBonusCp({ sharpnessBonusCp: 8, drawAversionPenaltyCp: 5, kingCautionPenaltyCp: 4 }), -1);
  assert.equal(hasPlayingStyle({}), false);
  assert.equal(hasPlayingStyle({ variety: 1 }), false, 'variety is selection, rather than a score');
  for (const name of ['aggression', 'tension', 'pawnStorm', 'kingCaution', 'sacrifice', 'sharpness', 'queenRetention', 'drawAversion'] as const) {
    assert.equal(hasPlayingStyle({ [name]: 0.1 }), true, name);
  }
});

test('Pawn storms reward supported advances smoothly, independently of king-zone attack', () => {
  const step = scorePlayingStyle(stormFen, 'g2g3', [], all);
  const double = scorePlayingStyle(stormFen, 'g2g4', [], all);
  assert.equal(step.pawnStorm, 0.125);
  assert.equal(double.pawnStorm, 0.25);
  assert.equal(double.pawnStormBonusCp, 12.5);
  assert.equal(step.attackPressure, double.attackPressure, 'pawn advancement is not hidden in king attack');
  const unsupported = stormFen.replace('K5R1', 'K7');
  assert.equal(scorePlayingStyle(unsupported, 'g2g4', [], { pawnStorm: 1 }).pawnStorm, 0);
  const wrongWing = '6k1/5ppp/8/8/8/8/P7/RK6 w - - 0 1';
  assert.equal(scorePlayingStyle(wrongWing, 'a2a4', [], { pawnStorm: 1 }).pawnStorm, 0);
  const passedKing = '8/6R1/8/6P1/8/6k1/8/K7 w - - 0 1';
  assert.equal(scorePlayingStyle(passedKing, 'g5g6', [], { pawnStorm: 1 }).pawnStorm, 0);
});

test('King caution independently discounts counterpressure without reducing the king-attack feature', () => {
  const fen = '6k1/5ppp/8/8/3Q4/7q/5PPP/6K1 w - - 0 1';
  const attack = scorePlayingStyle(fen, 'd4a4', [], { aggression: 1 });
  const careful = scorePlayingStyle(fen, 'd4a4', [], { aggression: 1, kingCaution: 1 });
  assert.ok(careful.kingExposure > 0);
  assert.ok(careful.kingCautionPenaltyCp > 0);
  assert.equal(attack.aggressionBonusCp, careful.aggressionBonusCp);
  assert.equal(attack.kingCautionPenaltyCp, 0);
  assert.ok(styleBonusCp(careful) < styleBonusCp(attack));
});

test('Sacrifice appetite measures actual net investment, with surviving activity or attack compensation', () => {
  const [move, ...pv] = continuation(giftFen, ['Bxh7+', 'Kxh7', 'Ng5+', 'Kg8', 'Qh5']);
  const sacrifice = scorePlayingStyle(giftFen, move, pv, { sacrifice: 1 });
  assert.equal(sacrifice.materialInvestment, 2, 'bishop for a pawn invests two material points');
  assert.ok(sacrifice.sacrificeBonusCp > 0, 'the surviving knight/queen attack supplies compensation');
  const noAppetite = scorePlayingStyle(giftFen, move, pv, { aggression: 1 });
  assert.equal(noAppetite.sacrificeBonusCp, 0);
  const alreadyInvested = new Chess(giftFen);
  alreadyInvested.move('Bxh7+'); alreadyInvested.move('Kxh7');
  const continuationOnly = scorePlayingStyle(alreadyInvested.fen(), pv[1], pv.slice(2), { sacrifice: 1 });
  assert.equal(continuationOnly.materialInvestment, 0, 'an existing material deficit is not a new sacrifice');
  assert.equal(continuationOnly.sacrificeBonusCp, 0);
  const exchangeFen = '6k1/5ppp/8/5n2/8/2B5/5PPP/3Q2K1 w - - 0 1';
  const [offer, ...exchangePv] = continuation(exchangeFen, ['Bd4', 'Nxd4', 'Qxd4']);
  assert.equal(scorePlayingStyle(exchangeFen, offer, exchangePv.slice(0, 1), { sacrifice: 1 }).materialInvestment, 3);
  const exchange = scorePlayingStyle(exchangeFen, offer, exchangePv, { sacrifice: 1 });
  assert.equal(exchange.materialInvestment, 0, 'a recapture settles the transient material deficit');
  assert.equal(exchange.sacrificeBonusCp, 0);
  const blunderFen = '6k1/5ppp/4p3/8/3Q4/8/5PPP/6K1 w - - 0 1';
  const blunder = scorePlayingStyle(blunderFen, 'd4d5', ['e6d5'], { sacrifice: 1 });
  assert.equal(blunder.materialInvestment, 9);
  assert.equal(blunder.sacrificeBonusCp, 0, 'hanging the sole attacking queen leaves no compensation');
  const drawnBlunder = scorePlayingStyle('6k1/8/8/8/3Q4/8/8/K7 w - - 0 1', 'd4g7', ['g8g7'], { sacrifice: 1 });
  assert.equal(drawnBlunder.materialInvestment, 9);
  assert.equal(drawnBlunder.sacrificeBonusCp, 0, 'a terminal queen loss cannot reuse the queen\'s earlier pressure as compensation');
});

test('Queen retention distinguishes queen exchange and cannot reward an absent root queen', () => {
  const fen = '3q1rk1/5ppp/8/8/3Q4/8/5PPP/6K1 w - - 0 1';
  const retain = scorePlayingStyle(fen, 'd4a4', ['h7h6'], { queenRetention: 1 });
  const traded = scorePlayingStyle(fen, 'd4d8', ['f8d8'], { queenRetention: 1 });
  assert.equal(retain.queenRetention, 1);
  assert.equal(retain.queenRetentionBonusCp, 30);
  assert.equal(traded.queenRetention, 0.5, 'averages retention across the sampled continuation');
  assert.equal(traded.queenRetentionBonusCp, 15);
  const absent = scorePlayingStyle(stormFen, 'g2g3', [], { queenRetention: 1 });
  assert.equal(absent.queenRetentionBonusCp, 0);
});

test('Every feature is invariant under exchanging colours and flipping ranks', () => {
  for (const [fen, move, pv] of [
    [attackFen, 'd4g4', ['h7h6']], [stormFen, 'g2g4', ['h7h6']],
    [giftFen, ...(() => { const [move, ...pv] = continuation(giftFen, ['Bxh7+', 'Kxh7', 'Ng5+', 'Kg8', 'Qh5']); return [move, pv] as const; })()],
  ] as [string, string, string[]][]) {
    assert.deepEqual(scorePlayingStyle(flipFen(fen), flipMove(move), pv.map(flipMove), all),
      scorePlayingStyle(fen, move, pv, all));
  }
});

test('Feature bonuses stay within declared caps, preserve the input and do not add points for immediate mate', () => {
  for (const fen of [attackFen, stormFen, giftFen]) {
    const board = new Chess(fen); const before = board.fen();
    for (const move of board.moves({ verbose: true })) {
      const score = scorePlayingStyle(fen, move.from + move.to + (move.promotion ?? ''), [], all);
      for (const [name, maximum] of [['aggressionBonusCp', 60], ['tensionBonusCp', 40], ['pawnStormBonusCp', 50],
        ['kingCautionPenaltyCp', 60], ['sacrificeBonusCp', 60], ['queenRetentionBonusCp', 30]] as const) {
        assert.ok(score[name] >= 0 && score[name] <= maximum, `${name}: ${score[name]}`);
      }
      assert.ok(styleBonusCp(score) <= 240 && styleBonusCp(score) >= -60);
    }
    assert.equal(board.fen(), before);
  }
  const mate = scorePlayingStyle('7k/4Q3/6K1/8/8/8/8/8 w - - 0 1', 'e7g7', [], all);
  assert.equal(styleBonusCp(mate), 0);
});
