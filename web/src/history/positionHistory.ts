import { Chess, type Color } from 'chess.js';
import { DEFAULT_ANALYSIS_SETTINGS, DEFAULT_TRAPPY_SETTINGS, type TrappySettings } from '../engine/trappy';
import { validatePosition } from '../import/position';

export type SavedPosition = {
  id: string;
  kind: 'analysis' | 'game';
  name: string;
  fen: string;
  orientation: Color;
  playerColor?: Color;
  startFen?: string;
  pgn?: string;
  settings?: TrappySettings;
  styleEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
};
export type HistorySnapshot = { entries: SavedPosition[]; warning?: string };
export const POSITION_HISTORY_KEY = 'trappy.position-history.v1';
export const MAX_SAVED_POSITIONS = 40;
const VERSION = 1;
const MAX_PGN_LENGTH = 100_000;
const MAX_HISTORY_LENGTH = 2_000_000;
const SESSION_WARNING = 'Browser storage is unavailable or full. History changes are kept for this tab only and may be lost when it closes.';
const CORRUPT_WARNING = 'Some saved history could not be read. Valid positions are still available; unreadable data is left unchanged until you save or clear history.';
const VERSION_WARNING = 'Saved history uses an unsupported version. It is left unchanged until you save or clear history.';

type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StorageChange = { key: string | null; newValue: string | null };
/** An injectable browser boundary keeps persistence tests independent of the DOM. */
export type HistoryDriver = {
  storage: () => HistoryStorage | undefined;
  listen?: (listener: (event: StorageChange) => void) => () => void;
  now?: () => number;
};
type Decoded = { entries: SavedPosition[]; warning?: string; readable: boolean };

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
function color(input: unknown): input is Color { return input === 'w' || input === 'b'; }
function time(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && input <= 8_640_000_000_000_000;
}
function cleanName(input: unknown, fallback: string): string {
  return typeof input === 'string' ? input.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) || fallback : fallback;
}
function cleanFen(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 200) return;
  const fields = input.trim().split(/\s+/);
  if (fields.length !== 6 || !Number.isSafeInteger(Number(fields[4])) || !Number.isSafeInteger(Number(fields[5]))) return;
  try { return validatePosition(input).fen; } catch { return; }
}

/** Only known, finite values can become engine settings, independently of the position data. */
function cleanSettings(input: unknown, kind: SavedPosition['kind']): TrappySettings | undefined {
  if (!record(input)) return;
  const defaults = kind === 'analysis' ? DEFAULT_ANALYSIS_SETTINGS : DEFAULT_TRAPPY_SETTINGS;
  const number = (key: keyof TrappySettings, min: number, max: number, integer = false): number => {
    const raw = input[key];
    const safe = typeof raw === 'number' && Number.isFinite(raw) ? raw : defaults[key] as number;
    const bounded = Math.max(min, Math.min(max, safe));
    return integer ? Math.round(bounded) : bounded;
  };
  return {
    rootDepth: number('rootDepth', 1, 30, true), trapDepth: number('trapDepth', 1, 30, true),
    candidateCount: number('candidateCount', 1, 30, true), replyCount: number('replyCount', 1, 30, true),
    trappiness: number('trappiness', 0, 1), aggression: number('aggression', 0, 1), tension: number('tension', 0, 1),
    maxRiskCp: number('maxRiskCp', 0, 300), winningRiskCp: number('winningRiskCp', 0, 300),
    opponentRating: number('opponentRating', 400, 3000, true), engineRating: number('engineRating', 400, 3000, true),
    replyCoverage: number('replyCoverage', 0.01, 1), opponentPlies: input.opponentPlies === 1 ? 1 : 2,
    continuationReplies: number('continuationReplies', 1, 10, true),
    continuationBranches: number('continuationBranches', 1, 10, true),
  };
}

function cleanPosition(input: unknown): { entry?: SavedPosition; repaired?: boolean } {
  if (!record(input) || typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.id)
    || (input.kind !== 'analysis' && input.kind !== 'game') || !color(input.orientation)
    || !time(input.createdAt) || !time(input.updatedAt)) return {};
  const fen = cleanFen(input.fen);
  if (!fen) return {};
  let repaired = false;
  const entry: SavedPosition = {
    id: input.id, kind: input.kind, name: cleanName(input.name, input.kind === 'game' ? 'Practice game' : 'Analysis position'),
    fen, orientation: input.orientation, createdAt: input.createdAt, updatedAt: Math.max(input.createdAt, input.updatedAt),
  };
  if (color(input.playerColor)) entry.playerColor = input.playerColor;
  if (typeof input.styleEnabled === 'boolean') entry.styleEnabled = input.styleEnabled;
  if (input.startFen !== undefined) {
    entry.startFen = cleanFen(input.startFen);
    if (!entry.startFen) repaired = true;
  }
  if (input.settings !== undefined) {
    entry.settings = cleanSettings(input.settings, input.kind);
    if (!entry.settings) repaired = true;
  }
  // PGN is optional. An invalid or mismatching move history must never make its valid FEN disappear.
  if (input.pgn !== undefined) {
    if (typeof input.pgn === 'string' && input.pgn.length <= MAX_PGN_LENGTH) {
      try {
        const game = new Chess();
        game.loadPgn(input.pgn);
        const headers = game.getHeaders();
        const setupFen = Object.entries(headers).find(([key]) => key.toLowerCase() === 'fen')?.[1];
        const actualStart = setupFen ? cleanFen(setupFen) : new Chess().fen();
        if (!actualStart) throw new Error('Invalid PGN setup');
        if (game.fen({ forceEnpassantSquare: true }) === fen && (!entry.startFen || actualStart === entry.startFen)) {
          entry.pgn = input.pgn;
          entry.startFen = entry.startFen ?? actualStart;
        } else repaired = true;
      } catch { repaired = true; }
    } else repaired = true;
  }
  return { entry, repaired };
}

function recent(entries: SavedPosition[]): SavedPosition[] {
  const ids = new Set<string>();
  const analysisFens = new Set<string>();
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .filter((entry) => {
      if (ids.has(entry.id) || (entry.kind === 'analysis' && analysisFens.has(entry.fen))) return false;
      ids.add(entry.id);
      if (entry.kind === 'analysis') analysisFens.add(entry.fen);
      return true;
    }).slice(0, MAX_SAVED_POSITIONS);
}
function decode(raw: string | null): Decoded {
  if (raw === null) return { entries: [], readable: true };
  if (raw.length > MAX_HISTORY_LENGTH) return { entries: [], warning: CORRUPT_WARNING, readable: false };
  try {
    const data: unknown = JSON.parse(raw);
    if (!record(data)) return { entries: [], warning: CORRUPT_WARNING, readable: false };
    if (data.version !== VERSION) return { entries: [], warning: VERSION_WARNING, readable: false };
    if (!Array.isArray(data.entries)) return { entries: [], warning: CORRUPT_WARNING, readable: false };
    const entries: SavedPosition[] = [];
    let damaged = false;
    // Read only a bounded number even when another script writes an unexpectedly large envelope.
    for (const item of data.entries.slice(0, 1000)) {
      const cleaned = cleanPosition(item);
      if (cleaned.entry) entries.push(cleaned.entry); else damaged = true;
      damaged ||= cleaned.repaired === true;
    }
    return { entries: recent(entries), warning: damaged || data.entries.length > 1000 ? CORRUPT_WARNING : undefined, readable: true };
  } catch { return { entries: [], warning: CORRUPT_WARNING, readable: false }; }
}
function serialized(entries: SavedPosition[]): string { return JSON.stringify({ version: VERSION, entries }); }
function samePosition(a: SavedPosition, b: SavedPosition): boolean {
  return a.id === b.id && a.kind === b.kind && a.name === b.name && a.fen === b.fen
    && a.orientation === b.orientation && a.playerColor === b.playerColor && a.startFen === b.startFen
    && a.pgn === b.pgn && a.styleEnabled === b.styleEnabled && a.createdAt === b.createdAt
    && JSON.stringify(a.settings) === JSON.stringify(b.settings);
}

export function createPositionHistoryStore(driver: HistoryDriver) {
  let snapshot: HistorySnapshot | undefined;
  let stopListening: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const now = driver.now ?? Date.now;
  const publish = (next: HistorySnapshot) => {
    if (snapshot && JSON.stringify(snapshot) === JSON.stringify(next)) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const getHistorySnapshot = (): HistorySnapshot => {
    if (!snapshot) {
      try {
        const storage = driver.storage();
        snapshot = storage ? decode(storage.getItem(POSITION_HISTORY_KEY)) : { entries: [], warning: SESSION_WARNING };
        // Internal parsing metadata is deliberately absent from public snapshots.
        snapshot = { entries: snapshot.entries, warning: snapshot.warning };
      } catch { snapshot = { entries: [], warning: SESSION_WARNING }; }
    }
    return snapshot;
  };
  const persist = (entries: SavedPosition[], warning?: string, clear = false) => {
    let bounded = recent(entries);
    // Very long games cannot fill storage indefinitely; keep the most recently used games first.
    while (serialized(bounded).length > MAX_HISTORY_LENGTH && bounded.length > 1) bounded = bounded.slice(0, -1);
    try {
      const storage = driver.storage();
      if (!storage) throw new Error('Storage unavailable');
      if (clear) storage.removeItem(POSITION_HISTORY_KEY);
      else storage.setItem(POSITION_HISTORY_KEY, serialized(bounded));
      publish({ entries: bounded, warning });
    } catch { publish({ entries: bounded, warning: SESSION_WARNING }); }
  };
  const subscribeHistory = (listener: () => void): (() => void) => {
    getHistorySnapshot();
    listeners.add(listener);
    if (!stopListening && driver.listen) stopListening = driver.listen((event) => {
      if (event.key !== null && event.key !== POSITION_HISTORY_KEY) return;
      try {
        const decoded = decode(event.key === null ? driver.storage()?.getItem(POSITION_HISTORY_KEY) ?? null : event.newValue);
        publish({ entries: decoded.readable ? decoded.entries : getHistorySnapshot().entries, warning: decoded.warning });
      } catch { publish({ entries: getHistorySnapshot().entries, warning: SESSION_WARNING }); }
    });
    return () => {
      listeners.delete(listener);
      if (!listeners.size) { stopListening?.(); stopListening = undefined; }
    };
  };
  const savePosition = (input: SavedPosition): void => {
    const previous = getHistorySnapshot();
    const { entry, repaired } = cleanPosition(input);
    if (!entry) { publish({ ...previous, warning: 'This position could not be saved because its position or metadata is invalid.' }); return; }
    const existing = previous.entries.find((item) => item.id === entry.id)
      ?? previous.entries.find((item) => item.kind === 'analysis' && entry.kind === 'analysis' && item.fen === entry.fen);
    if (existing) {
      entry.createdAt = existing.createdAt;
      // Autosave effects may run more than once. A fresh timestamp alone is not a history change.
      if (samePosition(existing, entry)) return;
    }
    entry.updatedAt = Math.max(entry.createdAt, entry.updatedAt);
    const entries = previous.entries.filter((item) => item.id !== entry.id && item.id !== existing?.id);
    persist([entry, ...entries], repaired ? 'The position was saved, but an invalid move history or optional setting was omitted.' : undefined);
  };
  const renamePosition = (id: string, name: string): void => {
    const previous = getHistorySnapshot();
    const entry = previous.entries.find((item) => item.id === id);
    if (!entry) return;
    const nextName = cleanName(name, entry.name);
    if (nextName === entry.name) return;
    persist(previous.entries.map((item) => item.id === id ? { ...item, name: nextName, updatedAt: Math.max(item.updatedAt, now()) } : item));
  };
  const removePosition = (id: string): void => {
    const entries = getHistorySnapshot().entries;
    if (entries.some((entry) => entry.id === id)) persist(entries.filter((entry) => entry.id !== id));
  };
  const clearPositionHistory = (): void => { getHistorySnapshot(); persist([], undefined, true); };
  return { getHistorySnapshot, subscribeHistory, savePosition, renamePosition, removePosition, clearPositionHistory };
}

const browserStore = createPositionHistoryStore({
  storage: () => typeof window === 'undefined' ? undefined : window.localStorage,
  listen: (listener) => {
    if (typeof window === 'undefined') return () => {};
    const receive = (event: StorageEvent) => {
      // Ignore sessionStorage events; accessing localStorage can itself throw in restricted browsers.
      try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { /* The store handles blocked storage. */ }
      listener(event);
    };
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  },
});

export const { getHistorySnapshot, subscribeHistory, savePosition, renamePosition, removePosition, clearPositionHistory } = browserStore;
export function createHistoryId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `position_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
