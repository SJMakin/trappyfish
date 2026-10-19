import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { DEFAULT_ANALYSIS_SETTINGS, DEFAULT_TRAPPY_SETTINGS } from '../src/engine/trappy';
import { clearPositionHistory, createHistoryId, getHistorySnapshot, renamePosition } from '../src/history/positionHistory';
import { rememberAnalysisPosition, rememberPracticeGame, restorePracticeGame } from '../src/history/workspaceHistory';

test('Analysis history coalesces full positions and preserves names, orientation and independent controls', () => {
  clearPositionHistory();
  const fen = new Chess().fen();
  const id = rememberAnalysisPosition(fen, 'b', { ...DEFAULT_ANALYSIS_SETTINGS, aggression: 0.8, tension: 0.7 })!;
  renamePosition(id, 'My opening study');
  assert.equal(rememberAnalysisPosition(fen, 'w', { ...DEFAULT_ANALYSIS_SETTINGS, aggression: 0.9 }), id);
  const snapshot = getHistorySnapshot();
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].name, 'My opening study');
  assert.equal(snapshot.entries[0].orientation, 'w');
  assert.equal(snapshot.entries[0].settings?.aggression, 0.9);
  assert.equal(snapshot.entries[0].settings?.trappiness, 1);
  assert.equal(rememberAnalysisPosition('invalid', 'w', DEFAULT_ANALYSIS_SETTINGS), undefined);
});

test('Practice games update one history entry and resume complete PGN including undo context', () => {
  const board = new Chess(); for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) board.move(san);
  const id = createHistoryId();
  const metadata = { id, createdAt: Date.now(), playerColor: 'w' as const, orientation: 'b' as const,
    settings: { ...DEFAULT_TRAPPY_SETTINGS, aggression: 0.8, tension: 0.7 }, styleEnabled: false };
  rememberPracticeGame(board, metadata);
  renamePosition(id, 'A game to continue');
  board.move('Bc4'); rememberPracticeGame(board, metadata);
  const entries = getHistorySnapshot().entries.filter((entry) => entry.id === id);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.name, 'A game to continue');
  assert.equal(entry.playerColor, 'w'); assert.equal(entry.orientation, 'b'); assert.equal(entry.styleEnabled, false);
  const resumed = restorePracticeGame(undefined, entry);
  assert.deepEqual(resumed.history(), board.history());
  assert.equal(resumed.fen({ forceEnpassantSquare: true }), entry.fen);
  resumed.undo(); board.undo();
  assert.equal(resumed.fen({ forceEnpassantSquare: true }), board.fen({ forceEnpassantSquare: true }));
});

test('Custom starting games preserve castling, en passant and clocks through PGN history', () => {
  const start = 'r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 17 22';
  const board = new Chess(start); board.move('exd6'); board.move('O-O');
  const id = createHistoryId();
  rememberPracticeGame(board, { id, createdAt: Date.now(), playerColor: 'w', orientation: 'w', settings: DEFAULT_TRAPPY_SETTINGS, styleEnabled: true });
  const saved = getHistorySnapshot().entries.find((entry) => entry.id === id)!;
  assert.equal(saved.startFen, start); assert.ok(saved.pgn);
  const resumed = restorePracticeGame(undefined, saved);
  assert.deepEqual(resumed.history(), ['exd6', 'O-O']);
  resumed.undo(); resumed.undo();
  assert.equal(resumed.fen({ forceEnpassantSquare: true }), start);
});

test('PGN setup retains an uncapturable initial en-passant field without losing move history', () => {
  const start = '4k3/8/8/3p4/8/8/8/4K2R w - d6 17 22';
  const board = new Chess(start); board.move('Rh2');
  const id = createHistoryId();
  rememberPracticeGame(board, { id, createdAt: Date.now(), playerColor: 'w', orientation: 'w', settings: DEFAULT_TRAPPY_SETTINGS, styleEnabled: true });
  const saved = getHistorySnapshot().entries.find((entry) => entry.id === id)!;
  assert.equal(saved.startFen, start); assert.ok(saved.pgn, 'Setup metadata must agree with the PGN header');
  assert.deepEqual(restorePracticeGame(undefined, saved).history(), ['Rh2']);
});

test('A damaged or mismatching PGN still restores its valid saved board', () => {
  const board = new Chess(); board.move('d4'); board.move('d5');
  const saved = { id: createHistoryId(), kind: 'game' as const, name: 'Fallback',
    fen: board.fen({ forceEnpassantSquare: true }), orientation: 'w' as const, createdAt: Date.now(), updatedAt: Date.now(), pgn: 'broken PGN' };
  const resumed = restorePracticeGame(undefined, saved);
  assert.equal(resumed.fen({ forceEnpassantSquare: true }), saved.fen);
  assert.equal(resumed.history().length, 0);
});
