import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { DEFAULT_TRAPPY_SETTINGS } from '../src/engine/trappy';
import { createHistoryId, createPositionHistoryStore, MAX_SAVED_POSITIONS, POSITION_HISTORY_KEY,
  type HistoryDriver, type SavedPosition } from '../src/history/positionHistory';

function driver(initial?: string) {
  let raw = initial ?? null;
  let blocked = false;
  let quota = false;
  let writes = 0;
  let now = 1000;
  let receive: ((event: { key: string | null; newValue: string | null }) => void) | undefined;
  const storage = {
    getItem: (_key: string) => raw,
    setItem: (_key: string, value: string) => { if (quota) throw new Error('QuotaExceededError'); raw = value; writes++; },
    removeItem: (_key: string) => { if (quota) throw new Error('QuotaExceededError'); raw = null; writes++; },
  };
  const boundary: HistoryDriver = {
    storage: () => { if (blocked) throw new Error('SecurityError'); return storage; },
    now: () => now,
    listen: (listener) => { receive = listener; return () => { receive = undefined; }; },
  };
  return {
    boundary, raw: () => raw, writes: () => writes, block: () => { blocked = true; }, quota: () => { quota = true; },
    setNow: (value: number) => { now = value; },
    external: (value: string | null, key: string | null = POSITION_HISTORY_KEY) => {
      if (key === POSITION_HISTORY_KEY || key === null) raw = value;
      receive?.({ key, newValue: value });
    },
  };
}
function position(id: string, extra: Partial<SavedPosition> = {}): SavedPosition {
  return { id, kind: 'game', name: 'A practice game', fen: new Chess().fen(), orientation: 'b',
    playerColor: 'w', createdAt: 100, updatedAt: 200, ...extra };
}
const envelope = (entries: unknown[], version = 1) => JSON.stringify({ version, entries });
function first(store: ReturnType<typeof createPositionHistoryStore>) { return store.getHistorySnapshot().entries[0]; }

// Full game reconstruction includes rights, en passant, clocks, setup, and every move.
const setup = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const game = new Chess(setup);
game.move('d5'); game.move('exd5'); game.move('Nf6'); game.move('Nf3');
const fullFen = game.fen({ forceEnpassantSquare: true });
const full = position('roundtrip', { fen: fullFen, startFen: setup, pgn: game.pgn(),
  settings: { ...DEFAULT_TRAPPY_SETTINGS, trappiness: 0.85, aggression: 0.75, tension: 0.9 }, styleEnabled: true });
const disk = driver();
const store = createPositionHistoryStore(disk.boundary);
assert.equal(store.getHistorySnapshot(), store.getHistorySnapshot(), 'Reads must keep a stable snapshot reference');
let notifications = 0;
const unsubscribe = store.subscribeHistory(() => { notifications++; });
store.savePosition(full);
assert.equal(notifications, 1);
assert.equal(first(store).fen, fullFen);
assert.equal(first(store).startFen, setup);
assert.equal(first(store).pgn, game.pgn());
assert.equal(first(store).orientation, 'b');
assert.equal(first(store).settings?.aggression, 0.75);
assert.equal(first(store).settings?.tension, 0.9);
assert.equal(first(store).styleEnabled, true);
assert.equal(store.getHistorySnapshot().warning, undefined);
const reloaded = createPositionHistoryStore(disk.boundary);
assert.deepEqual(first(reloaded), first(store), 'Browser reload must preserve a complete playable game');
const rebuilt = new Chess(); rebuilt.loadPgn(first(reloaded).pgn!);
assert.equal(rebuilt.fen({ forceEnpassantSquare: true }), fullFen);
assert.equal(rebuilt.history().length, 4);
const stable = store.getHistorySnapshot();
const beforeWrites = disk.writes();
store.savePosition({ ...full, updatedAt: 400 });
assert.equal(store.getHistorySnapshot(), stable, 'Repeated autosave must not change snapshot just to update its clock');
assert.equal(disk.writes(), beforeWrites);

// Same games coalesce, while independent games at the same position remain separate.
store.savePosition(position('roundtrip', { name: 'Updated', updatedAt: 500, createdAt: 499 }));
assert.equal(store.getHistorySnapshot().entries.length, 1);
assert.equal(first(store).createdAt, 100);
store.savePosition(position('other-game', { updatedAt: 600 }));
assert.equal(store.getHistorySnapshot().entries.length, 2);
store.savePosition(position('analysis-a', { kind: 'analysis', updatedAt: 700 }));
store.savePosition(position('analysis-b', { kind: 'analysis', updatedAt: 800 }));
assert.equal(store.getHistorySnapshot().entries.filter((entry) => entry.kind === 'analysis').length, 1);
assert.equal(first(store).id, 'analysis-b');
disk.setNow(900);
store.renamePosition('other-game', '  My return game  ');
assert.equal(first(store).name, 'My return game');
assert.equal(first(store).updatedAt, 900);
store.renamePosition('other-game', 'x'.repeat(300));
assert.equal(first(store).name.length, 100);
store.removePosition('other-game');
assert.ok(!store.getHistorySnapshot().entries.some((entry) => entry.id === 'other-game'));
const beforeMissing = store.getHistorySnapshot();
store.removePosition('missing'); store.renamePosition('missing', 'No record');
assert.equal(store.getHistorySnapshot(), beforeMissing);
for (let i = 0; i < 50; i++) store.savePosition(position(`game-${i}`, { updatedAt: 1000 + i }));
assert.equal(store.getHistorySnapshot().entries.length, MAX_SAVED_POSITIONS);
assert.equal(first(store).id, 'game-49');
assert.equal(store.getHistorySnapshot().entries.at(-1)?.id, 'game-10');

// Storage events update existing consumers; malformed external writes cannot erase a valid tab snapshot.
const externalGame = position('external', { updatedAt: 5000 });
disk.external(envelope([externalGame]), 'some-other-key');
assert.equal(first(store).id, 'game-49');
disk.external(envelope([externalGame]));
assert.equal(first(store).id, 'external');
const externalSnapshot = store.getHistorySnapshot();
disk.external(envelope([externalGame]));
assert.equal(store.getHistorySnapshot(), externalSnapshot, 'Equivalent cross-tab events must also be stable');
disk.external('{broken');
assert.equal(first(store).id, 'external');
assert.match(store.getHistorySnapshot().warning!, /could not be read/);
disk.external(null);
assert.equal(store.getHistorySnapshot().entries.length, 0);
assert.equal(store.getHistorySnapshot().warning, undefined);
unsubscribe();

// Blocked and exhausted storage retain session state and never throw into the UI.
const blockedDisk = driver(); blockedDisk.block();
const blocked = createPositionHistoryStore(blockedDisk.boundary);
assert.match(blocked.getHistorySnapshot().warning!, /this tab only/);
blocked.savePosition(full);
assert.equal(first(blocked).fen, fullFen);
assert.match(blocked.getHistorySnapshot().warning!, /this tab only/);
blocked.clearPositionHistory();
assert.equal(blocked.getHistorySnapshot().entries.length, 0);
const quotaDisk = driver(envelope([full]));
const quotaStore = createPositionHistoryStore(quotaDisk.boundary);
assert.equal(first(quotaStore).id, full.id);
quotaDisk.quota();
quotaStore.savePosition(position('newer', { updatedAt: 6000 }));
assert.equal(quotaStore.getHistorySnapshot().entries.length, 2, 'Quota failure keeps previously valid history and the latest tab state');
assert.equal(first(quotaStore).id, 'newer');
assert.equal(JSON.parse(quotaDisk.raw()!).entries.length, 1, 'The last successful persisted snapshot survives a rejected write');
assert.match(quotaStore.getHistorySnapshot().warning!, /this tab only/);
quotaStore.removePosition('newer');
assert.equal(first(quotaStore).id, full.id);

// Unknown versions and corrupt JSON are diagnosed without overwriting their original data on read.
for (const raw of ['{invalid', 'null', envelope([full], 999), JSON.stringify({ version: 1, entries: {} })]) {
  const malformedDisk = driver(raw);
  const malformed = createPositionHistoryStore(malformedDisk.boundary);
  assert.equal(malformed.getHistorySnapshot().entries.length, 0);
  assert.ok(malformed.getHistorySnapshot().warning);
  assert.equal(malformedDisk.writes(), 0);
  assert.equal(malformedDisk.raw(), raw);
  malformed.savePosition(full);
  assert.equal(first(malformed).id, full.id);
  assert.equal(malformed.getHistorySnapshot().warning, undefined);
}
const missing = createPositionHistoryStore({ storage: () => undefined });
missing.savePosition(full);
assert.equal(first(missing).id, full.id);
assert.match(missing.getHistorySnapshot().warning!, /this tab only/);

// Invalid primary positions are discarded, while optional metadata cannot invalidate a legal position.
const damagedDisk = driver(envelope([
  full, { ...full, id: 'bad-fen', fen: 'anything' }, { ...full, id: 'bad-color', orientation: 'purple' },
  { ...full, id: 'bad-time', updatedAt: 'yesterday' }, { ...full, id: '<unsafe-id>' },
  { ...full, id: 'broken-pgn', pgn: '1. e9 *' },
  { ...full, id: 'mismatched-pgn', pgn: '1. e4 *' },
  { ...full, id: 'oversize-pgn', pgn: 'x'.repeat(100_001) },
  { ...full, id: 'bad-optional', startFen: 'not fen', settings: 'not settings', pgn: undefined },
]));
const damaged = createPositionHistoryStore(damagedDisk.boundary);
assert.equal(damaged.getHistorySnapshot().entries.length, 5);
assert.equal(damaged.getHistorySnapshot().entries.find((entry) => entry.id === 'broken-pgn')?.pgn, undefined);
assert.equal(damaged.getHistorySnapshot().entries.find((entry) => entry.id === 'mismatched-pgn')?.pgn, undefined);
assert.equal(damaged.getHistorySnapshot().entries.find((entry) => entry.id === 'oversize-pgn')?.pgn, undefined);
assert.equal(damaged.getHistorySnapshot().entries.find((entry) => entry.id === 'bad-optional')?.settings, undefined);
assert.equal(damaged.getHistorySnapshot().entries.find((entry) => entry.id === 'bad-optional')?.startFen, undefined);
assert.match(damaged.getHistorySnapshot().warning!, /could not be read/);
assert.equal(damagedDisk.writes(), 0);
damaged.savePosition({ ...full, fen: 'invalid' });
assert.equal(damaged.getHistorySnapshot().entries.length, 5);
assert.match(damaged.getHistorySnapshot().warning!, /could not be saved/);

const unsafeSettings = position('safe-settings', { settings: {
  ...DEFAULT_TRAPPY_SETTINGS, rootDepth: 999, trapDepth: -1, replyCount: 2.6, trappiness: -8,
  aggression: 44, tension: Number.NaN, maxRiskCp: 5000, winningRiskCp: -3,
  opponentRating: Number.POSITIVE_INFINITY, engineRating: 99, replyCoverage: 0,
  opponentPlies: 4, continuationReplies: 0, continuationBranches: 80, unknown: '<image frame>',
} as unknown as SavedPosition['settings'] });
const safeStore = createPositionHistoryStore(driver().boundary);
safeStore.savePosition(unsafeSettings);
const safe = first(safeStore).settings!;
assert.equal(safe.rootDepth, 30); assert.equal(safe.trapDepth, 1); assert.equal(safe.replyCount, 3);
assert.equal(safe.trappiness, 0); assert.equal(safe.aggression, 1); assert.equal(safe.tension, 0);
assert.equal(safe.maxRiskCp, 300); assert.equal(safe.winningRiskCp, 0);
assert.equal(safe.opponentRating, DEFAULT_TRAPPY_SETTINGS.opponentRating); assert.equal(safe.engineRating, 400);
assert.equal(safe.replyCoverage, 0.01); assert.equal(safe.opponentPlies, 2);
assert.equal(safe.continuationReplies, 1); assert.equal(safe.continuationBranches, 10);
assert.ok(!('unknown' in safe));

// A just-created custom position still keeps its exact clocks, castling, and EP even before a move.
const fresh = new Chess(setup);
safeStore.savePosition(position('exact-fen', { fen: setup, startFen: setup, pgn: fresh.pgn(), updatedAt: 7000 }));
assert.equal(first(safeStore).fen, setup); assert.equal(first(safeStore).startFen, setup);
assert.equal(first(safeStore).pgn, fresh.pgn());
safeStore.savePosition({ ...position('whitelist'), image: 'a-frame', thumbnail: 'a-frame', unknown: 'no' } as SavedPosition);
const whitelisted = safeStore.getHistorySnapshot().entries.find((entry) => entry.id === 'whitelist')!;
assert.ok(!('image' in whitelisted)); assert.ok(!('thumbnail' in whitelisted));
const diskToClear = driver(envelope([full]));
const clearStore = createPositionHistoryStore(diskToClear.boundary);
clearStore.clearPositionHistory();
assert.equal(diskToClear.raw(), null); assert.equal(clearStore.getHistorySnapshot().entries.length, 0);
assert.equal(clearStore.getHistorySnapshot().warning, undefined);
assert.ok(/^[a-zA-Z0-9_-]{1,128}$/.test(createHistoryId()));
assert.notEqual(createHistoryId(), createHistoryId());
console.log('Position history checks passed (persistence, recovery, PGN/FEN, validation, bounds, autosave, and cross-tab updates).');
