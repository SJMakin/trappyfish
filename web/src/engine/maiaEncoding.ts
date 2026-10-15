import { Chess } from 'chess.js';

/** The Maia-3 5M ONNX tensor contract, checked against the pinned model's I/O.
 * Original adapter; see public/maia/README.md for model provenance and references.
 */
export const MAIA_HISTORY = 8;
export const MAIA_TOKEN_WIDTH = 12 * MAIA_HISTORY;
export const MAIA_POLICY_SIZE = 4352;

export type OpponentReply = { move: string; probability: number };
export interface OpponentPolicyProvider {
  /** Ratings refer to the player moving in fen, then that player's opponent. */
  predict(fen: string, opponentRating: number, engineRating: number): Promise<OpponentReply[]>;
}

export function maiaRating(rating: number): number {
  if (!Number.isFinite(rating)) throw new Error('Maia needs a finite player rating.');
  return Math.min(5000, Math.max(0, Math.round(rating)));
}

function squareIndex(square: string): number {
  return (Number(square[1]) - 1) * 8 + square.charCodeAt(0) - 97;
}

/** Maia mirrors ranks and swaps colors for Black. Files stay unchanged. */
export function maiaMoveIndex(move: string, blackToMove = false): number {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
    throw new Error(`Invalid UCI move for Maia: ${move}`);
  }
  let from = squareIndex(move.slice(0, 2));
  let to = squareIndex(move.slice(2, 4));
  if (blackToMove) {
    from ^= 56;
    to ^= 56;
  }
  if (move.length === 4) return from * 64 + to;
  if (Math.floor(from / 8) !== 6 || Math.floor(to / 8) !== 7) {
    throw new Error(`Invalid promotion for Maia: ${move}`);
  }
  // All four promotions (including queens) have distinct lanes in the model.
  return 4096 + ((from % 8) * 8 + to % 8) * 4 + 'qrbn'.indexOf(move[4]);
}

/** Standalone FEN inference follows upstream's default: repeat the current
 * position in all eight history slots. Each square has 8 x 12 piece channels.
 */
export function encodeMaiaBoard(fen: string): Float32Array {
  const board = new Chess(fen);
  const blackToMove = board.turn() === 'b';
  const result = new Float32Array(64 * MAIA_TOKEN_WIDTH);
  for (const rank of board.board()) {
    for (const piece of rank) {
      if (!piece) continue;
      const square = squareIndex(piece.square) ^ (blackToMove ? 56 : 0);
      const friendly = piece.color === board.turn();
      const channel = 'pnbrqk'.indexOf(piece.type) + (friendly ? 0 : 6);
      for (let history = 0; history < MAIA_HISTORY; history++) {
        result[square * MAIA_TOKEN_WIDTH + history * 12 + channel] = 1;
      }
    }
  }
  return result;
}

export function legalMaiaPolicy(fen: string, logits: ArrayLike<number>): OpponentReply[] {
  if (logits.length !== MAIA_POLICY_SIZE) {
    throw new Error(`Maia returned ${logits.length} policy logits; expected ${MAIA_POLICY_SIZE}.`);
  }
  const board = new Chess(fen);
  const moves = board.moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`);
  if (!moves.length) return [];
  const scores = moves.map((move) => Number(logits[maiaMoveIndex(move, board.turn() === 'b')]));
  if (scores.some((score) => !Number.isFinite(score))) {
    throw new Error('Maia returned a non-finite legal-move logit.');
  }
  const maximum = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(score - maximum));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return moves.map((move, index) => ({ move, probability: weights[index] / total }))
    .sort((a, b) => b.probability - a.probability || a.move.localeCompare(b.move));
}

export function maiaCacheKey(fen: string, opponentRating: number, engineRating: number): string {
  const canonical = new Chess(fen).fen().split(' ').slice(0, 4).join(' ');
  return `${canonical}|${maiaRating(opponentRating)}|${maiaRating(engineRating)}`;
}

/** Bounded LRU: return copies so callers cannot poison subsequent predictions. */
export class MaiaPolicyCache {
  private entries = new Map<string, OpponentReply[]>();
  constructor(private readonly capacity = 512) {}

  get(key: string): OpponentReply[] | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value.map((reply) => ({ ...reply }));
  }

  set(key: string, value: OpponentReply[]): void {
    this.entries.delete(key);
    this.entries.set(key, value.map((reply) => ({ ...reply })));
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }

  clear(): void { this.entries.clear(); }
}
