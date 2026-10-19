import { Chess, type Color } from 'chess.js';
import type { TrappySettings } from '../engine/trappy';
import { validatePosition } from '../import/position';
import { createHistoryId, getHistorySnapshot, savePosition, type SavedPosition } from './positionHistory';

export function rememberAnalysisPosition(fen: string, orientation: Color, settings: TrappySettings): string | undefined {
  const validated = validatePosition(fen);
  if (!validated.fen) return;
  const existing = getHistorySnapshot().entries.find((entry) => entry.kind === 'analysis' && entry.fen === validated.fen);
  const fields = validated.fen.split(' '); const now = Date.now();
  const entry: SavedPosition = { id: existing?.id ?? createHistoryId(), kind: 'analysis',
    name: existing?.name ?? `Analysis · ${fields[1] === 'w' ? 'White' : 'Black'} to move · move ${fields[5]}`,
    fen: validated.fen, orientation, settings: { ...settings }, createdAt: existing?.createdAt ?? now, updatedAt: now };
  savePosition(entry);
  return entry.id;
}

/** Rebuild legal game history from PGN so undo/repetition retain their original context. */
export function restorePracticeGame(fen?: string, saved?: SavedPosition): Chess {
  const position = validatePosition(saved?.fen ?? fen ?? new Chess().fen()).fen ?? new Chess().fen();
  if (saved?.pgn) {
    try {
      const game = new Chess(); game.loadPgn(saved.pgn);
      if (validatePosition(game.fen({ forceEnpassantSquare: true })).fen === position) return game;
    } catch { /* An intact FEN remains usable when PGN is unavailable or damaged. */ }
  }
  return new Chess(position);
}

export function rememberPracticeGame(game: Chess, metadata: {
  id: string; createdAt: number; orientation: Color; playerColor: Color;
  settings: TrappySettings; styleEnabled: boolean;
}): void {
  const existing = getHistorySnapshot().entries.find((entry) => entry.id === metadata.id);
  const moves = game.history({ verbose: true });
  const setup = Object.entries(game.getHeaders()).find(([key]) => key.toLowerCase() === 'fen')?.[1];
  const startFen = setup ? validatePosition(setup).fen : moves[0]?.before ?? game.fen({ forceEnpassantSquare: true });
  savePosition({ ...metadata, kind: 'game', name: existing?.name ?? `Practice · playing ${metadata.playerColor === 'w' ? 'White' : 'Black'}`,
    fen: game.fen({ forceEnpassantSquare: true }), startFen,
    pgn: game.pgn(), settings: { ...metadata.settings }, updatedAt: Date.now() });
}
