import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MAX_POLYGLOT_BYTES, PolyglotBook, polyglotKey, validatePolyglotSize } from '../src/openings/polyglot';
import provenance from '../src/openings/polyglotProvenance.json';
import { POLYGLOT_RANDOM_ARRAY } from '../src/openings/polyglotRandom';

const rawCanonical = await readFile('src/openings/source/python-chess-polyglot.py');
const license = await readFile('src/openings/source/python-chess-LICENSE.txt');
assert.equal(createHash('sha256').update(rawCanonical).digest('hex'), provenance.sourceSha256);
assert.equal(createHash('sha256').update(license).digest('hex'), provenance.licenseSha256);
const canonicalConstants = rawCanonical.toString('utf8').match(/POLYGLOT_RANDOM_ARRAY = \[([\s\S]*?)\]/)![1].match(/0x[0-9A-Fa-f]+/g)!.map(value => BigInt(value));
assert.equal(canonicalConstants.length, 781); assert.deepEqual(POLYGLOT_RANDOM_ARRAY, canonicalConstants);

// Independent published compatibility vectors from the pinned python-chess test.py,
// which in turn credits the original Polyglot format examples.
const vectors: [string, bigint][] = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 0x463b96181691fc9cn],
  ['rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 0x823c9b50fd114196n],
  ['rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 0x0756b94461c50fb0n],
  ['rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2', 0x662fafb965db29d4n],
  ['rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', 0x22a48b5a8e47ff78n],
  ['rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPPKPPP/RNBQ1BNR b kq - 1 3', 0x652a607ca3f242c1n],
  ['rnbq1bnr/ppp1pkpp/8/3pPp2/8/8/PPPPKPPP/RNBQ1BNR w - - 2 4', 0x00fdd303c946bdd9n],
  ['rnbqkbnr/p1pppppp/8/8/PpP4P/8/1P1PPPP1/RNBQKBNR b KQkq c3 0 3', 0x3c8123ea7b067637n],
  ['rnbqkbnr/p1pppppp/8/8/P6P/R1p5/1P1PPPP1/1NBQKBNR b Kkq - 1 4', 0x5c3f9b829b279560n],
];
for (const [fen, expected] of vectors) assert.equal(polyglotKey(fen), expected, fen);
const initial = new Chess().fen();
assert.equal(polyglotKey(initial.replace(' w ', ' b ')), 0xbeedb0b2b9b67995n, 'White-to-move contributes the turn key');
assert.equal(polyglotKey(initial.replace('0 1', '17 54')), polyglotKey(initial), 'Half/full move counters do not affect book identity');
assert.equal(polyglotKey(vectors[1][0].replace(' - 0 1', ' e3 0 1')), vectors[1][1], 'An uncapturable EP target contributes no key');
const pinnedEp = 'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
assert.equal(new Chess(pinnedEp).moves().includes('exd6'), false);
assert.notEqual(polyglotKey(pinnedEp), polyglotKey(pinnedEp.replace(' d6 ', ' - ')), 'A pinned adjacent pawn still contributes its EP file');
assert.throws(() => polyglotKey('not a FEN'));

type Row = { key: bigint; move?: string; raw?: number; weight: number; learn?: number };
function encoded(move: string) {
  const from = move.charCodeAt(0) - 97 + (Number(move[1]) - 1) * 8;
  const to = move.charCodeAt(2) - 97 + (Number(move[3]) - 1) * 8;
  const promotion = move[4] ? ' nbrq'.indexOf(move[4]) : 0;
  return (promotion << 12) | (from << 6) | to;
}
function binary(rows: Row[], sort = true): Uint8Array {
  const ordered = sort ? [...rows].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : rows;
  const bytes = new Uint8Array(ordered.length * 16); const view = new DataView(bytes.buffer);
  ordered.forEach((row, index) => {
    view.setBigUint64(index * 16, row.key, false); view.setUint16(index * 16 + 8, row.raw ?? encoded(row.move!), false);
    view.setUint16(index * 16 + 10, row.weight, false); view.setUint32(index * 16 + 12, row.learn ?? 0, false);
  });
  return bytes;
}
const startKey = vectors[0][1];
const bytes = binary([
  { key: 0n, move: 'a2a3', weight: 1 },
  { key: startKey, move: 'e2e4', weight: 2, learn: 0x89abcdef },
  { key: startKey, move: 'd2d4', weight: 7 },
  { key: startKey, move: 'e2e4', weight: 3, learn: 7 },
  { key: startKey, move: 'b1c3', weight: 0 },
  { key: startKey, move: 'a1a8', weight: 100 }, // structurally encoded but illegal on this board
  { key: 0xffffffffffffffffn, move: 'a7a6', weight: 1 },
]);
const book = PolyglotBook.fromBuffer(bytes);
assert.equal(book.entryCount, 7); assert.equal(book.positionCount, 3); assert.equal(book.activeEntryCount, 6); assert.equal(book.activePositionCount, 3);
assert.deepEqual(book.lookup(initial), [
  { move: 'd2d4', weight: 7, learn: 0, records: 1 },
  { move: 'e2e4', weight: 5, learn: 0x89abcdef, records: 2 },
]);
assert.deepEqual(book.lookup(vectors[1][0]), [], 'Unknown positions are not inferred from nearby keys');
bytes.fill(0); assert.equal(book.lookup(initial).length, 2, 'Validated books are immutable snapshots');
const offsetBook = binary([{ key: startKey, move: 'g1f3', weight: 4 }]);
const padded = new Uint8Array(64); padded.set(offsetBook, 16);
assert.equal(PolyglotBook.fromBuffer(new Uint8Array(padded.buffer, 16, 16)).lookup(initial)[0].move, 'g1f3');

for (const side of ['w', 'b']) {
  const fen = `r3k2r/8/8/8/8/8/8/R3K2R ${side} KQkq - 0 1`; const key = polyglotKey(fen); const rank = side === 'w' ? '1' : '8';
  const castles = PolyglotBook.fromBuffer(binary([{ key, move: `e${rank}h${rank}`, weight: 3 }, { key, move: `e${rank}a${rank}`, weight: 2 }]));
  assert.deepEqual(castles.lookup(fen).map(row => row.move), [`e${rank}g${rank}`, `e${rank}c${rank}`]);
}
const inCheck = '4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1';
assert.deepEqual(PolyglotBook.fromBuffer(binary([{ key: polyglotKey(inCheck), move: 'e1h1', weight: 1 }])).lookup(inCheck), [], 'An encoded castle must still be legal');
const promotionFen = '7k/P7/8/8/8/8/8/4K3 w - - 0 1';
const promotions = PolyglotBook.fromBuffer(binary(['n', 'b', 'r', 'q'].map((piece, i) => ({ key: polyglotKey(promotionFen), move: `a7a8${piece}`, weight: i + 1 }))));
assert.deepEqual(promotions.lookup(promotionFen).map(row => row.move), ['a7a8q', 'a7a8r', 'a7a8b', 'a7a8n']);
const epFen = vectors[4][0];
assert.equal(PolyglotBook.fromBuffer(binary([{ key: polyglotKey(epFen), move: 'e5f6', weight: 1 }])).lookup(epFen)[0].move, 'e5f6');
assert.deepEqual(PolyglotBook.fromBuffer(binary([{ key: polyglotKey(pinnedEp), move: 'e5d6', weight: 1 }])).lookup(pinnedEp), [], 'EP key compatibility does not bypass move legality');

assert.equal(PolyglotBook.fromBuffer(new ArrayBuffer(0)).entryCount, 0);
assert.deepEqual(PolyglotBook.fromBuffer(binary([{ key: startKey, raw: 0, weight: 0 }])).lookup(initial), [], 'Zero weights are inactive');
assert.throws(() => PolyglotBook.fromBuffer(new Uint8Array(17)), /16-byte/);
assert.throws(() => PolyglotBook.fromBuffer(binary([{ key: 2n, move: 'e2e4', weight: 1 }, { key: 1n, move: 'd2d4', weight: 1 }], false)), /sorted/);
assert.throws(() => PolyglotBook.fromBuffer(binary([{ key: 1n, raw: 0x8001, weight: 1 }])), /encoding/);
assert.throws(() => PolyglotBook.fromBuffer(binary([{ key: 1n, raw: 0x5001, weight: 1 }])), /encoding/);
assert.throws(() => PolyglotBook.fromBuffer(binary([{ key: 1n, raw: 0, weight: 1 }])), /null move/);
assert.throws(() => validatePolyglotSize(MAX_POLYGLOT_BYTES + 16), /128 MiB/);
assert.throws(() => PolyglotBook.fromBuffer(new ArrayBuffer(MAX_POLYGLOT_BYTES + 16)), /128 MiB/, 'The parser applies its cap before copying file contents');
assert.throws(() => validatePolyglotSize(NaN)); assert.throws(() => validatePolyglotSize(-16));
validatePolyglotSize(MAX_POLYGLOT_BYTES);
console.log('Polyglot passed: nine independent hashes, turn/castling/EP rules, immutable big-endian binary lookup, legal castles/promotions, weights/deduplication and file guards.');
