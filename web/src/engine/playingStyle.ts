import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export type StylePreferences = { aggression?: number; tension?: number };
export type StyleScore = {
  attackPressure: number; tension: number;
  aggressionBonusCp: number; tensionBonusCp: number;
};
const values: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const opposite = (color: Color): Color => color === 'w' ? 'b' : 'w';

function material(board: Chess): number {
  return board.board().flat().reduce((sum, piece) => sum + (piece ? values[piece.type] : 0), 0);
}

function kingPressure(board: Chess, color: Color): number {
  const enemy = opposite(color);
  const king = board.findPiece({ color: enemy, type: 'k' })[0];
  if (!king) return 0;
  const attackers = new Set<Square>();
  let zonePressure = 0;
  for (let df = -2; df <= 2; df++) for (let dr = -2; dr <= 2; dr++) {
    const file = king.charCodeAt(0) + df; const rank = Number(king[1]) + dr;
    if (file < 97 || file > 104 || rank < 1 || rank > 8) continue;
    const square = `${String.fromCharCode(file)}${rank}` as Square;
    const hits = board.attackers(square, color).filter((sq) => board.get(sq)?.type !== 'k');
    if (!hits.length) continue;
    zonePressure += Math.max(Math.abs(df), Math.abs(dr)) <= 1 ? 3 : 1;
    hits.forEach((sq) => attackers.add(sq));
  }
  let supportedStorm = 0;
  for (const pawn of board.findPiece({ color, type: 'p' })) {
    const advancement = color === 'w' ? Number(pawn[1]) : 9 - Number(pawn[1]);
    if (advancement >= 5 && Math.abs(pawn.charCodeAt(0) - king.charCodeAt(0)) <= 1
      && board.isAttacked(pawn, color)) supportedStorm += 4;
  }
  // Coordination matters more than an isolated check; an exposed attacker is discounted.
  let coordination = 0;
  for (const square of attackers) {
    if (!board.isAttacked(square, enemy) || board.isAttacked(square, color)) coordination += 5;
  }
  return Math.min(1, (zonePressure + coordination + supportedStorm) / 70);
}

function unresolvedTension(board: Chess, initialMaterial: number): number {
  const contacts = new Set<string>();
  for (const target of board.board().flat()) {
    if (!target || target.type === 'k') continue;
    for (const square of board.attackers(target.square, opposite(target.color))) {
      const attacker = board.get(square)!;
      if (attacker.type === 'k') continue;
      // Count pawn contacts and defended pieces under attack, once per pair.
      if ((attacker.type === 'p' && target.type === 'p') || board.isAttacked(target.square, target.color)) {
        contacts.add([square, target.square].sort().join(':'));
      }
    }
  }
  const retained = 1 - Math.min(1, Math.max(0, initialMaterial - material(board)) / 12);
  return retained * 0.6 + Math.min(1, contacts.size / 4) * 0.4;
}

/** Style points are ranking preferences, never objective evaluation or human probabilities. */
export function scorePlayingStyle(fen: string, move: string, defensePv: string[], settings: StylePreferences): StyleScore {
  const zero: StyleScore = { attackPressure: 0, tension: 0, aggressionBonusCp: 0, tensionBonusCp: 0 };
  if (!(settings.aggression || settings.tension)) return zero;
  const board = new Chess(fen); const mover = board.turn(); const initialMaterial = material(board);
  const samples: { attack: number; tension: number }[] = [];
  // Sample the candidate and up to two full turns of its strongest-defense continuation.
  // This discounts pressure that disappears as soon as the opponent responds.
  for (const uci of [move, ...defensePv.slice(0, 4)]) {
    try { board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); }
    catch { break; }
    if (board.isGameOver()) break;
    samples.push({
      attack: settings.aggression ? Math.max(0, kingPressure(board, mover) - kingPressure(board, opposite(mover)) * 0.5) : 0,
      tension: settings.tension ? unresolvedTension(board, initialMaterial) : 0,
    });
  }
  if (!samples.length) return zero;
  const attackPressure = samples.reduce((sum, sample) => sum + sample.attack, 0) / samples.length;
  const tension = samples.reduce((sum, sample) => sum + sample.tension, 0) / samples.length;
  return { attackPressure, tension,
    aggressionBonusCp: 60 * (settings.aggression ?? 0) * attackPressure,
    tensionBonusCp: 40 * (settings.tension ?? 0) * tension };
}

export function styleBonusCp(score?: StyleScore): number {
  return score ? score.aggressionBonusCp + score.tensionBonusCp : 0;
}
