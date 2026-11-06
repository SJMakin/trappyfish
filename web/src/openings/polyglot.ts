// SPDX-License-Identifier: GPL-3.0-or-later
// Polyglot binary format and Zobrist-table interpretation follow python-chess.
// See polyglotProvenance.json and source/python-chess-NOTICE.txt for attribution.
import { Chess, type Square } from 'chess.js';
import { POLYGLOT_RANDOM_ARRAY } from './polyglotRandom';
import provenance from './polyglotProvenance.json';

export const MAX_POLYGLOT_BYTES = 128 * 1024 * 1024;
export const POLYGLOT_RECORD_BYTES = 16;
export const polyglotProvenance = provenance;
export const POLYGLOT_LICENSE_URL = new URL('./source/python-chess-LICENSE.txt', import.meta.url).href;
export type PolyglotMove = {
  /** Legal UCI move; king-to-rook castling is converted to normal chess UCI. */
  move: string;
  /** Sum of nonzero weights when multiple records encode the same legal move. */
  weight: number;
  /** Opaque learn field from the first matching record. It never affects selection. */
  learn: number;
  records: number;
};

export function validatePolyglotSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('The opening book has an invalid file size.');
  if (size > MAX_POLYGLOT_BYTES) throw new Error('The opening book exceeds the 128 MiB limit.');
  if (size % POLYGLOT_RECORD_BYTES !== 0) throw new Error('A Polyglot book must contain complete 16-byte records.');
}

function position(fen: string) {
  if (typeof fen !== 'string' || fen.trim().split(/\s+/).length !== 6) throw new Error('A complete FEN is required to look up an opening book.');
  const fields = fen.trim().split(/\s+/);
  const board = new Chess(fen);
  return { board, fields };
}

function hashPosition({ board, fields }: ReturnType<typeof position>): bigint {
  let key = 0n;
  for (let rank = 0; rank < 8; rank++) for (let file = 0; file < 8; file++) {
    const square = `${String.fromCharCode(97 + file)}${rank + 1}` as Square;
    const piece = board.get(square);
    if (!piece) continue;
    // Polyglot orders black before white for each pawn/knight/bishop/rook/queen/king pair.
    const pieceIndex = 'pnbrqk'.indexOf(piece.type) * 2 + (piece.color === 'w' ? 1 : 0);
    key ^= POLYGLOT_RANDOM_ARRAY[pieceIndex * 64 + rank * 8 + file];
  }
  const rights = fields[2];
  const has = (square: Square, type: string, color: 'w' | 'b') => {
    const piece = board.get(square); return piece?.type === type && piece.color === color;
  };
  if (has('e1', 'k', 'w')) {
    if (rights.includes('K') && has('h1', 'r', 'w')) key ^= POLYGLOT_RANDOM_ARRAY[768];
    if (rights.includes('Q') && has('a1', 'r', 'w')) key ^= POLYGLOT_RANDOM_ARRAY[769];
  }
  if (has('e8', 'k', 'b')) {
    if (rights.includes('k') && has('h8', 'r', 'b')) key ^= POLYGLOT_RANDOM_ARRAY[770];
    if (rights.includes('q') && has('a8', 'r', 'b')) key ^= POLYGLOT_RANDOM_ARRAY[771];
  }
  // Use the input EP target, not board.fen(): chess.js may hide a pinned capture.
  // Polyglot requires only an adjacent pawn, even when that pawn cannot legally move.
  const ep = fields[3];
  if (ep !== '-') {
    const file = ep.charCodeAt(0) - 97;
    const pawnRank = Number(ep[1]) + (board.turn() === 'w' ? -1 : 1);
    if ([file - 1, file + 1].some(adjacent => adjacent >= 0 && adjacent < 8
      && has(`${String.fromCharCode(97 + adjacent)}${pawnRank}` as Square, 'p', board.turn()))) {
      key ^= POLYGLOT_RANDOM_ARRAY[772 + file];
    }
  }
  if (board.turn() === 'w') key ^= POLYGLOT_RANDOM_ARRAY[780];
  return key;
}

/** FEN counters are ignored. Preserve an EP target with fen({forceEnpassantSquare:true}). */
export function polyglotKey(fen: string): bigint { return hashPosition(position(fen)); }

function decodedMove(raw: number, board: Chess): string {
  const square = (file: number, rank: number) => `${String.fromCharCode(97 + file)}${rank + 1}`;
  const from = square((raw >> 6) & 7, (raw >> 9) & 7);
  let to = square(raw & 7, (raw >> 3) & 7);
  const promotion = (raw >> 12) & 7;
  if (!promotion && board.get(from as Square)?.type === 'k') {
    if (from === 'e1' && to === 'h1') to = 'g1';
    else if (from === 'e1' && to === 'a1') to = 'c1';
    else if (from === 'e8' && to === 'h8') to = 'g8';
    else if (from === 'e8' && to === 'a8') to = 'c8';
  }
  return `${from}${to}${promotion ? ' nbrq'[promotion] : ''}`;
}

/** Immutable, validated local-file reader. No network access, sampling, or engine policy. */
export class PolyglotBook {
  readonly entryCount: number;
  readonly positionCount: number;
  readonly activeEntryCount: number;
  readonly activePositionCount: number;
  readonly byteLength: number;

  private constructor(private readonly view: DataView, stats: { entries: number; positions: number; activeEntries: number; activePositions: number }) {
    this.entryCount = stats.entries; this.positionCount = stats.positions;
    this.activeEntryCount = stats.activeEntries; this.activePositionCount = stats.activePositions;
    this.byteLength = view.byteLength;
  }

  static fromBuffer(buffer: ArrayBuffer | ArrayBufferView): PolyglotBook {
    const input = buffer instanceof ArrayBuffer ? new Uint8Array(buffer)
      : ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : undefined;
    if (!input) throw new Error('The opening book must be supplied as binary data.');
    validatePolyglotSize(input.byteLength);
    // Keep a snapshot so caller mutations cannot invalidate the verified key order.
    const copy = new Uint8Array(input.byteLength); copy.set(input);
    const view = new DataView(copy.buffer);
    const entries = copy.byteLength / POLYGLOT_RECORD_BYTES;
    let previous: bigint | undefined; let positions = 0; let activeEntries = 0; let activePositions = 0; let previousActive: bigint | undefined;
    for (let index = 0; index < entries; index++) {
      const offset = index * POLYGLOT_RECORD_BYTES; const key = view.getBigUint64(offset, false);
      if (previous !== undefined && key < previous) throw new Error(`Polyglot records must be sorted by position key (record ${index + 1}).`);
      if (key !== previous) positions++;
      previous = key;
      const raw = view.getUint16(offset + 8, false); const weight = view.getUint16(offset + 10, false);
      if ((raw & 0x8000) !== 0 || ((raw >> 12) & 7) > 4) throw new Error(`Invalid Polyglot move encoding at record ${index + 1}.`);
      if (weight > 0) {
        if ((raw & 63) === ((raw >> 6) & 63)) throw new Error(`An active Polyglot record cannot contain a null move (record ${index + 1}).`);
        activeEntries++;
        if (key !== previousActive) activePositions++;
        previousActive = key;
      }
    }
    return new PolyglotBook(view, { entries, positions, activeEntries, activePositions });
  }

  lookup(fen: string): PolyglotMove[] {
    const current = position(fen); const key = hashPosition(current);
    // Lower bound in O(log n), then inspect only the records for this exact position.
    let low = 0; let high = this.entryCount;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.view.getBigUint64(middle * POLYGLOT_RECORD_BYTES, false) < key) low = middle + 1;
      else high = middle;
    }
    const legal = new Set(current.board.moves({ verbose: true }).map(move => `${move.from}${move.to}${move.promotion ?? ''}`));
    const matches = new Map<string, PolyglotMove>();
    for (let index = low; index < this.entryCount; index++) {
      const offset = index * POLYGLOT_RECORD_BYTES;
      if (this.view.getBigUint64(offset, false) !== key) break;
      const weight = this.view.getUint16(offset + 10, false); if (!weight) continue;
      const move = decodedMove(this.view.getUint16(offset + 8, false), current.board);
      if (!legal.has(move)) continue;
      const existing = matches.get(move);
      if (existing) { existing.weight += weight; existing.records++; }
      else matches.set(move, { move, weight, learn: this.view.getUint32(offset + 12, false), records: 1 });
    }
    return [...matches.values()].sort((a, b) => b.weight - a.weight || a.move.localeCompare(b.move));
  }
}
