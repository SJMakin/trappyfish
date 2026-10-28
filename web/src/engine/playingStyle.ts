import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export type StylePreferences = {
  aggression?: number; tension?: number; pawnStorm?: number; kingCaution?: number;
  sacrifice?: number; sharpness?: number; queenRetention?: number; drawAversion?: number; variety?: number;
};
export type StyleScore = {
  attackPressure: number; tension: number;
  aggressionBonusCp: number; tensionBonusCp: number;
  pawnStorm: number; kingExposure: number; materialInvestment: number; queenRetention: number;
  pawnStormBonusCp: number; kingCautionPenaltyCp: number; sacrificeBonusCp: number; queenRetentionBonusCp: number;
  positionalAvailable?: boolean;
  /** Reply-distribution features are populated by the engine, not positional sampling. */
  sharpness?: number; sharpnessBonusCp?: number; sharpnessAvailable?: boolean;
  drawProbability?: number; drawAversionPenaltyCp?: number; drawAversionAvailable?: boolean;
};
const values: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const opposite = (color: Color): Color => color === 'w' ? 'b' : 'w';
const unit = (value: number | undefined): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0;

/** Variety changes move selection, rather than a candidate's playing-style score. */
export function hasPlayingStyle(settings: StylePreferences): boolean {
  return (['aggression', 'tension', 'pawnStorm', 'kingCaution', 'sacrifice', 'sharpness', 'queenRetention', 'drawAversion'] as const)
    .some((name) => unit(settings[name]) > 0);
}

function material(board: Chess): number {
  return board.board().flat().reduce((sum, piece) => sum + (piece ? values[piece.type] : 0), 0);
}

function materialBalance(board: Chess, color: Color): number {
  return board.board().flat().reduce((sum, piece) => sum + (piece ? values[piece.type] * (piece.color === color ? 1 : -1) : 0), 0);
}

/** Control of the opposing king's two-square zone and participating-piece coordination. */
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
  let coordination = 0;
  for (const square of attackers) {
    if (!board.isAttacked(square, enemy) || board.isAttacked(square, color)) coordination += 5;
  }
  return Math.min(1, (zonePressure + coordination) / 70);
}

/**
 * Supported pawns on the king's file and adjacent files: relative rank 2 scores
 * zero, then each rank adds 1/4 up to rank 6. Two fully advanced pawns saturate
 * the feature. Pawns that have passed the enemy king are not a storm against it.
 * The smooth progression lets a preparatory advance receive discovery credit.
 */
function supportedPawnStorm(board: Chess, color: Color): number {
  const king = board.findPiece({ color: opposite(color), type: 'k' })[0];
  if (!king) return 0;
  const kingRank = color === 'w' ? Number(king[1]) : 9 - Number(king[1]);
  let storm = 0;
  for (const pawn of board.findPiece({ color, type: 'p' })) {
    const advancement = color === 'w' ? Number(pawn[1]) : 9 - Number(pawn[1]);
    if (Math.abs(pawn.charCodeAt(0) - king.charCodeAt(0)) > 1 || advancement > kingRank
      || !board.isAttacked(pawn, color)) continue;
    storm += unit((advancement - 2) / 4);
  }
  return Math.min(1, storm / 2);
}

/** Non-pawn, non-king control of available squares; opposing-half activity weighs more. */
function pieceActivity(board: Chess, color: Color): number {
  let activity = 0;
  for (let file = 97; file <= 104; file++) for (let rank = 1; rank <= 8; rank++) {
    const square = `${String.fromCharCode(file)}${rank}` as Square;
    if (board.get(square)?.color === color) continue;
    const hits = board.attackers(square, color).filter((from) => {
      const type = board.get(from)?.type;
      return type !== 'k' && type !== 'p';
    }).length;
    const advanced = color === 'w' ? rank >= 5 : rank <= 4;
    activity += Math.min(2, hits) * (advanced ? 1.5 : 1);
  }
  return Math.min(1, activity / 100);
}

function unresolvedTension(board: Chess, initialMaterial: number): number {
  const contacts = new Set<string>();
  for (const target of board.board().flat()) {
    if (!target || target.type === 'k') continue;
    for (const square of board.attackers(target.square, opposite(target.color))) {
      const attacker = board.get(square)!;
      if (attacker.type === 'k') continue;
      if ((attacker.type === 'p' && target.type === 'p') || board.isAttacked(target.square, target.color)) {
        contacts.add([square, target.square].sort().join(':'));
      }
    }
  }
  const retained = 1 - Math.min(1, Math.max(0, initialMaterial - material(board)) / 12);
  return retained * 0.6 + Math.min(1, contacts.size / 4) * 0.4;
}

/** Style points are bounded ranking preferences, never objective evaluation or human probabilities. */
export function scorePlayingStyle(fen: string, move: string, defensePv: string[], settings: StylePreferences): StyleScore {
  const zero: StyleScore = { attackPressure: 0, tension: 0, aggressionBonusCp: 0, tensionBonusCp: 0,
    pawnStorm: 0, kingExposure: 0, materialInvestment: 0, queenRetention: 0,
    pawnStormBonusCp: 0, kingCautionPenaltyCp: 0, sacrificeBonusCp: 0, queenRetentionBonusCp: 0, positionalAvailable: false };
  const board = new Chess(fen); const mover = board.turn(); const initialMaterial = material(board);
  const initialBalance = materialBalance(board, mover);
  const initialQueens = board.findPiece({ color: mover, type: 'q' }).length;
  const initialAttack = kingPressure(board, mover);
  const initialActivity = settings.sacrifice ? pieceActivity(board, mover) : 0;
  const samples: { attack: number; tension: number; storm: number; exposure: number; queens: number; activity: number }[] = [];
  // Candidate + up to two full turns of strongest defense: transient pressure is discounted.
  for (const uci of [move, ...defensePv.slice(0, 4)]) {
    try { board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); }
    catch { break; }
    // Terminal outcomes belong to mate/draw handling, rather than positional preferences.
    if (board.isGameOver()) break;
    samples.push({ attack: kingPressure(board, mover), tension: unresolvedTension(board, initialMaterial),
      storm: supportedPawnStorm(board, mover), exposure: kingPressure(board, opposite(mover)),
      queens: initialQueens ? Math.min(1, board.findPiece({ color: mover, type: 'q' }).length / initialQueens) : 0,
      activity: settings.sacrifice ? pieceActivity(board, mover) : 0 });
  }
  if (!samples.length) return zero;
  const mean = (name: keyof typeof samples[number]) => samples.reduce((sum, sample) => sum + sample[name], 0) / samples.length;
  const attackPressure = mean('attack'); const tension = mean('tension');
  const pawnStorm = mean('storm'); const kingExposure = mean('exposure'); const queenRetention = mean('queens');
  // Use the final net balance, not peak material surrendered during a normal exchange.
  // An existing material deficit is never counted again as a new sacrifice.
  const materialInvestment = Math.max(0, initialBalance - materialBalance(board, mover));
  // Require compensation still present after the continuation, rather than the
  // momentary activity of a queen/piece immediately before it gets captured.
  const finalSample = samples[samples.length - 1];
  const compensation = board.isGameOver() ? 0 : Math.min(1, Math.max(0, finalSample.attack - initialAttack) * 2
    + Math.max(0, finalSample.activity - initialActivity) * 4);
  return { attackPressure, tension, pawnStorm, kingExposure, materialInvestment, queenRetention, positionalAvailable: true,
    aggressionBonusCp: 60 * unit(settings.aggression) * attackPressure,
    tensionBonusCp: 40 * unit(settings.tension) * tension,
    pawnStormBonusCp: 50 * unit(settings.pawnStorm) * pawnStorm,
    kingCautionPenaltyCp: 60 * unit(settings.kingCaution) * kingExposure,
    sacrificeBonusCp: 60 * unit(settings.sacrifice) * Math.min(1, materialInvestment / 3) * compensation,
    queenRetentionBonusCp: 30 * unit(settings.queenRetention) * queenRetention };
}

export function styleBonusCp(score?: Partial<StyleScore>): number {
  if (!score) return 0;
  return (score.aggressionBonusCp ?? 0) + (score.tensionBonusCp ?? 0) + (score.pawnStormBonusCp ?? 0)
    + (score.sacrificeBonusCp ?? 0) + (score.queenRetentionBonusCp ?? 0) + (score.sharpnessBonusCp ?? 0)
    - (score.kingCautionPenaltyCp ?? 0) - (score.drawAversionPenaltyCp ?? 0);
}
