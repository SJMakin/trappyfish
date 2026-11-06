import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { createLocalBookStore, type LocalBookBackend, type LocalBookMetadata } from '../src/openings/localBooks';
import { MAX_POLYGLOT_BYTES } from '../src/openings/polyglot';
import { createPositionHistoryStore } from '../src/history/positionHistory';

const initialFen = new Chess().fen();
const initialKey = 0x463b96181691fc9cn;
// Independent Polyglot encodings: e2e4=0x031c and d2d4=0x02db.
function binary(move = 0x031c, weight = 7): ArrayBuffer {
  const buffer = new ArrayBuffer(16); const view = new DataView(buffer);
  view.setBigUint64(0, initialKey, false); view.setUint16(8, move, false); view.setUint16(10, weight, false);
  view.setUint32(12, 0x12345678, false); return buffer;
}
function file(buffer: ArrayBuffer, name = 'Book.bin') {
  return { name, size: buffer.byteLength, arrayBuffer: async () => buffer.slice(0) };
}
function backend() {
  const records = new Map<string, LocalBookMetadata>(); const buffers = new Map<string, ArrayBuffer>();
  let failPut: 'blocked' | 'quota' | undefined; let failRemove = false;
  let putCalls = 0; let removeCalls = 0;
  const storage: LocalBookBackend = {
    list: async () => [...records.values()].map(row => ({ ...row })),
    read: async id => buffers.get(id)?.slice(0),
    put: async (record, buffer) => {
      putCalls++;
      if (failPut === 'blocked') throw new DOMException('Storage blocked.', 'SecurityError');
      if (failPut === 'quota') throw new DOMException('Storage full.', 'QuotaExceededError');
      records.set(record.id, { ...record }); buffers.set(record.id, buffer.slice(0));
    },
    remove: async id => { removeCalls++; if (failRemove) throw new Error('Removal blocked.'); records.delete(id); buffers.delete(id); },
  };
  return { storage, records, buffers, blockPut: (reason: typeof failPut) => { failPut = reason; }, blockRemove: (value: boolean) => { failRemove = value; },
    get putCalls() { return putCalls; }, get removeCalls() { return removeCalls; } };
}

test('Local book identity uses bytes, sanitizes the label, and survives an independent store reload', async () => {
  const disk = backend(); const store = createLocalBookStore(disk.storage);
  const bytes = binary();
  const first = await store.import(file(bytes, ' \u0000Fish book.bin\n '));
  assert.equal(first.id, createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
  assert.match(first.id, /^[a-f0-9]{64}$/); assert.equal(first.name, 'Fish book.bin');
  assert.equal(first.byteLength, 16); assert.equal(first.entryCount, 1); assert.equal(first.positionCount, 1); assert.equal(first.activeEntryCount, 1);
  assert.equal(first.persistence, 'device');
  const same = await store.import(file(bytes, 'x'.repeat(200)));
  assert.equal(same.id, first.id); assert.equal(same.addedAt, first.addedAt); assert.equal(same.name.length, 120);
  assert.equal((await store.list()).books.length, 1, 'The same bytes do not consume another library slot');
  const restored = createLocalBookStore(disk.storage);
  assert.equal((await restored.list()).books[0].persistence, 'device');
  assert.deepEqual((await restored.read(first.id))?.lookup(initialFen).map(row => [row.move, row.weight]), [['e2e4', 7]]);
  assert.equal(await restored.read('not-a-book'), undefined);
});

test('Capacity is enforced across books without allocating a large fixture, and failed imports do not poison the queue', async () => {
  const disk = backend(); const store = createLocalBookStore(disk.storage, 32);
  const [first, second] = await Promise.all([store.import(file(binary())), store.import(file(binary(0x02db, 11)))]);
  assert.notEqual(first.id, second.id); assert.equal((await store.list()).books.length, 2);
  const before = disk.putCalls;
  await assert.rejects(store.import(file(binary(0x031c, 19))), /limited|Remove a book|capacity/i);
  assert.equal(disk.putCalls, before); assert.equal((await store.list()).books.length, 2);
  await store.remove(second.id);
  await store.import(file(binary(0x031c, 19)));
  assert.equal((await store.list()).books.length, 2);
  let read = false;
  await assert.rejects(store.import({ name: 'Too big.bin', size: MAX_POLYGLOT_BYTES + 16, arrayBuffer: async () => { read = true; throw new Error('Must not allocate.'); } }), /128 MiB/);
  assert.equal(read, false, 'Oversize files are rejected before reading their contents');
});

test('Malformed, empty, inactive and changed-size files are never stored', async () => {
  const disk = backend(); const store = createLocalBookStore(disk.storage);
  await assert.rejects(store.import(file(new ArrayBuffer(17))), /16-byte/);
  await assert.rejects(store.import(file(new ArrayBuffer(0))), /empty|record|active|usable/i);
  await assert.rejects(store.import(file(binary(0, 0))), /active|usable|positive|zero/i);
  await assert.rejects(store.import({ name: 'Changed.bin', size: 16, arrayBuffer: async () => new ArrayBuffer(32) }), /changed/);
  assert.equal(disk.putCalls, 0); assert.equal((await store.list()).books.length, 0);
  assert.equal((await store.import(file(binary()))).persistence, 'device');
});

test('Unavailable storage and quota failures preserve a clearly marked tab-only book', async () => {
  for (const reason of ['blocked', 'quota'] as const) {
    const disk = backend(); disk.blockPut(reason); const store = createLocalBookStore(disk.storage);
    const row = await store.import(file(binary()));
    assert.equal(row.persistence, 'session'); assert.match((await store.list()).warning ?? '', /tab only|this tab/i);
    assert.equal((await store.read(row.id))?.lookup(initialFen)[0].move, 'e2e4');
    assert.equal((await createLocalBookStore(disk.storage).list()).books.length, 0, 'A session fallback is not represented as durable');
    await store.remove(row.id); assert.equal((await store.list()).books.length, 0); assert.equal(disk.removeCalls, 0);
  }
  const session = createLocalBookStore(); const row = await session.import(file(binary()), false);
  assert.equal(row.persistence, 'session'); assert.equal((await session.read(row.id))?.entryCount, 1);
});

test('Reimporting durable identical bytes cannot leave a hidden durable copy that reappears after deletion', async () => {
  for (const retain of [false, true]) {
    const disk = backend(); const store = createLocalBookStore(disk.storage);
    const saved = await store.import(file(binary())); disk.blockPut('blocked');
    await store.import(file(binary(), 'Same bytes.bin'), retain);
    await store.remove(saved.id);
    assert.equal((await store.list()).books.length, 0);
    assert.equal((await createLocalBookStore(disk.storage).list()).books.length, 0, 'The deleted durable copy must stay deleted after reload');
    assert.equal(disk.buffers.has(saved.id), false);
  }
});

test('Persisted binary integrity is checked against the content ID before any move can be used', async () => {
  const disk = backend(); const saved = await createLocalBookStore(disk.storage).import(file(binary()));
  disk.buffers.set(saved.id, binary(0x02db, 11)); // Still a valid Polyglot file, but a different content identity.
  await assert.rejects(createLocalBookStore(disk.storage).read(saved.id), /changed|checksum|hash|identity|match/i);
  disk.buffers.set(saved.id, new ArrayBuffer(17));
  await assert.rejects(createLocalBookStore(disk.storage).read(saved.id));
});

test('Removing a book preserves game history, and a failed durable deletion remains visible', async () => {
  let historyText: string | null = null;
  const history = createPositionHistoryStore({ storage: () => ({ getItem: () => historyText, setItem: (_key, value) => { historyText = value; }, removeItem: () => { historyText = null; } }) });
  history.savePosition({ id: 'kept-game', name: 'Saved game', kind: 'game', fen: initialFen, pgn: new Chess().pgn(), orientation: 'w', playerColor: 'w', createdAt: 1, updatedAt: 1 });
  const before = historyText;
  const disk = backend(); const store = createLocalBookStore(disk.storage); const row = await store.import(file(binary()));
  disk.blockRemove(true); await assert.rejects(store.remove(row.id), /blocked/i);
  assert.equal((await store.list()).books.length, 1); assert.equal(historyText, before);
  disk.blockRemove(false); await store.remove(row.id);
  assert.equal((await store.list()).books.length, 0); assert.equal(historyText, before);
  assert.equal(history.getHistorySnapshot().entries[0].id, 'kept-game');
});
