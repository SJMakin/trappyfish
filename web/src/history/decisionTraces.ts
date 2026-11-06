import { Chess, validateFen } from 'chess.js';
import type { CandidateInfo, MoveDecision, ReplyInfo, TrappySettings } from '../engine/trappy';

export const MAX_TRACE_BYTES = 20 * 1024 * 1024;
const MAX_SINGLE_TRACE_BYTES = 192 * 1024;
const TRACE_WARNING = 'Detailed engine decisions are kept for this tab because browser storage is unavailable or full. The saved game and moves are kept separately.';
export type ActualReply = { move: string; san: string; ply: number; bookExitReason?: 'deviation' };
export type DecisionTrace = {
  book?: { id: string; name: string };
  gameId: string; ply: number; rootFen: string; settings: TrappySettings; styleEnabled: boolean;
  decision: MoveDecision; createdAt: number; actualReply?: ActualReply;
  openingExitReason?: string;
};
export type TraceInput = Omit<DecisionTrace, 'createdAt'> & { createdAt?: number };
export type TraceRow = { id: string; gameId: string; ply: number; createdAt: number; bytes: number; json: string };
export type TraceBackend = {
  getAll: () => Promise<TraceRow[]>;
  apply: (put: TraceRow[], remove: string[]) => Promise<void>;
};

function importantReplies(replies: ReplyInfo[], count: number, preferred?: string): ReplyInfo[] {
  return [...replies].sort((a, b) => Number(Boolean(b.bestDefense || b.move === preferred)) - Number(Boolean(a.bestDefense || a.move === preferred))
    || b.probability - a.probability).slice(0, count);
}
function trimReply(reply: ReplyInfo, nested = false, preferredNext?: string): ReplyInfo {
  return { ...reply, punishment: reply.punishment.slice(0, 14), continuation: !nested && reply.continuation ? {
    // Include the configured follow-up pool plus its separately verified defense.
    ...reply.continuation, replies: importantReplies(reply.continuation.replies, 11, preferredNext).map((item) => trimReply(item, true)),
  } : undefined };
}
function trimCandidate(candidate: CandidateInfo): CandidateInfo {
  // History settings allow thirty replies; a mandatory best defense can add one.
  // Preserve that distribution so the recorded probability ledger remains valid.
  return { ...candidate, replies: importantReplies(candidate.replies, 31, candidate.trap?.reply).map((reply) => trimReply(reply, false, candidate.trap?.nextReply?.reply)),
    pv: candidate.pv?.slice(0, 16), trap: candidate.trap ? { ...candidate.trap, punishment: candidate.trap.punishment.slice(0, 14) } : undefined };
}
/** Retain the selected move and relevant alternatives; a trace is never represented as a complete search tree. */
export function compactDecisionTrace(input: TraceInput): DecisionTrace {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.gameId) || !Number.isSafeInteger(input.ply) || input.ply < 1) throw new Error('Invalid decision trace identity.');
  const board = new Chess(input.rootFen);
  const move = input.decision.move;
  try { board.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }); }
  catch { throw new Error('Decision trace move does not match its position.'); }
  const selected = trimCandidate(input.decision.selected);
  const alternatives = input.decision.candidates.filter((candidate) => candidate.move !== selected.move)
    .sort((a, b) => Number(b.move === input.decision.rootBestMove) - Number(a.move === input.decision.rootBestMove)
      || Number(Boolean(b.trap)) - Number(Boolean(a.trap)) || b.adjustedScoreCp - a.adjustedScoreCp).slice(0, 7).map(trimCandidate);
  const trace: DecisionTrace = { ...input, settings: { ...input.settings }, createdAt: input.createdAt ?? Date.now(),
    decision: { ...input.decision, selected, candidates: [selected, ...alternatives], diagnostics: input.decision.diagnostics ? {
      ...input.decision.diagnostics, rootTrace: input.decision.diagnostics.rootTrace?.slice(-24),
    } : undefined } };
  // Serialize once to remove shared references and optional undefined values.
  const clean = JSON.parse(JSON.stringify(trace)) as DecisionTrace;
  if (new TextEncoder().encode(JSON.stringify(clean)).byteLength > MAX_SINGLE_TRACE_BYTES) {
    clean.decision.candidates = [clean.decision.selected];
  }
  return clean;
}
function rowFor(trace: DecisionTrace): TraceRow {
  const json = JSON.stringify(trace);
  return { id: `${trace.gameId}:${trace.ply}`, gameId: trace.gameId, ply: trace.ply, createdAt: trace.createdAt,
    bytes: new TextEncoder().encode(json).byteLength + 128, json };
}
function readableReply(reply: ReplyInfo, nested = false): boolean {
  return Boolean(reply && typeof reply.move === 'string' && typeof reply.san === 'string' && Number.isFinite(reply.probability)
    && Number.isFinite(reply.scoreCp) && Number.isFinite(reply.expectedScore) && Number.isFinite(reply.lossCp)
    && Array.isArray(reply.punishment) && reply.punishment.every((move) => typeof move === 'string')
    && (!reply.continuation || !nested && typeof reply.continuation.move === 'string' && Array.isArray(reply.continuation.replies)
      && reply.continuation.replies.every((item) => readableReply(item, true))));
}
function readableCandidate(candidate: CandidateInfo): boolean {
  return Boolean(candidate && typeof candidate.move === 'string' && typeof candidate.san === 'string'
    && [candidate.rootScoreCp, candidate.adjustedScoreCp, candidate.riskCp, candidate.expectedScore, candidate.objectiveScore, candidate.policyCoverage].every(Number.isFinite)
    && Array.isArray(candidate.replies) && candidate.replies.every((reply) => readableReply(reply))
    && (!candidate.trap || typeof candidate.trap.reply === 'string' && typeof candidate.trap.replySan === 'string'
      && Array.isArray(candidate.trap.punishment) && candidate.trap.punishment.every((move) => typeof move === 'string')));
}
function parseRow(row: TraceRow): DecisionTrace | undefined {
  if (typeof row.json !== 'string' || row.json.length > MAX_SINGLE_TRACE_BYTES) return;
  try {
    const trace = JSON.parse(row.json) as DecisionTrace;
    if (trace.gameId !== row.gameId || trace.ply !== row.ply || !Number.isSafeInteger(trace.ply) || trace.ply < 1 || typeof trace.rootFen !== 'string' || trace.rootFen.length > 200 || !validateFen(trace.rootFen).ok
      || !trace.settings || !trace.decision || !readableCandidate(trace.decision.selected)
      || !Array.isArray(trace.decision.candidates) || trace.decision.candidates.length > 8
      || !trace.decision.candidates.every(readableCandidate)) return;
    // Stored rows were compacted on write. Loading a whole database must not run a
    // legal-move search for every past position on the browser's main thread.
    return trace;
  } catch { return; }
}

/** Serialized mutations make a reply update, undo and a pending engine decision deterministic. */
export function createDecisionTraceStore(backend: TraceBackend | undefined, maxBytes = MAX_TRACE_BYTES) {
  let rows = new Map<string, TraceRow>();
  let initialized = false;
  let warning: string | undefined;
  let queue = Promise.resolve();
  let revision = 0;
  const listeners = new Set<() => void>();
  const notify = () => { revision++; listeners.forEach((listener) => listener()); };
  const initialize = async () => {
    if (initialized) return;
    initialized = true;
    try {
      if (!backend) throw new Error('No IndexedDB');
      for (const row of await backend.getAll()) {
        const trace = parseRow(row);
        if (trace) rows.set(row.id, rowFor(trace));
      }
    } catch { warning = TRACE_WARNING; }
  };
  const run = <T,>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(async () => { await initialize(); return action(); });
    queue = result.then(() => {}, () => {});
    return result;
  };
  const persist = async (put: TraceRow[], remove: string[]) => {
    const ordered = [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    let bytes = ordered.reduce((sum, row) => sum + row.bytes, 0);
    const evicted = [...remove];
    while (bytes > maxBytes && ordered.length) {
      const row = ordered.shift()!; rows.delete(row.id); bytes -= row.bytes; evicted.push(row.id);
    }
    try {
      if (!backend) throw new Error('No IndexedDB');
      await backend.apply(put.filter((row) => rows.has(row.id)), [...new Set(evicted)]);
    } catch (error) {
      // A browser can impose a lower quota. Evict the oldest durable traces and retry;
      // if even a single trace cannot be written, preserve it in this tab.
      const quota = error instanceof Error && (error.name === 'QuotaExceededError' || /quota/i.test(error.message));
      if (backend && put.length && quota) {
        const beforeRetries = new Map(rows);
        const keepIds = new Set(put.map((row) => row.id));
        const older = [...rows.values()].filter((row) => !keepIds.has(row.id)).sort((a, b) => a.createdAt - b.createdAt);
        let stored = false;
        while (older.length && !stored) {
          const old = older.shift()!; rows.delete(old.id); evicted.push(old.id);
          try { await backend.apply(put.filter((row) => rows.has(row.id)), [...new Set(evicted)]); stored = true; } catch { /* Try the next oldest trace. */ }
        }
        if (!stored) { rows = beforeRetries; warning = TRACE_WARNING; }
      } else warning = TRACE_WARNING;
    }
    notify();
  };
  const writeDecisionTrace = (input: TraceInput) => run(async () => {
    const trace = compactDecisionTrace(input); const row = rowFor(trace);
    rows.set(row.id, row); await persist([row], []); return trace;
  });
  const readDecisionTraces = (gameId: string) => run(async () => ({
    traces: [...rows.values()].filter((row) => row.gameId === gameId).sort((a, b) => a.ply - b.ply)
      .flatMap((row) => { const trace = parseRow(row); return trace ? [trace] : []; }), warning,
  }));
  const recordTraceReply = (gameId: string, enginePly: number, reply: ActualReply) => run(async () => {
    const row = rows.get(`${gameId}:${enginePly}`); const trace = row && parseRow(row);
    if (!trace || reply.ply !== enginePly + 1) return;
    trace.actualReply = { ...reply }; const updated = rowFor(trace); rows.set(updated.id, updated); await persist([updated], []);
  });
  const pruneDecisionTraces = (gameId: string, afterPly: number) => run(async () => {
    const remove: string[] = []; const put: TraceRow[] = [];
    for (const row of rows.values()) {
      if (row.gameId !== gameId) continue;
      if (row.ply > afterPly) { remove.push(row.id); continue; }
      const trace = parseRow(row);
      if (trace?.actualReply && trace.actualReply.ply > afterPly) {
        delete trace.actualReply; const updated = rowFor(trace); rows.set(row.id, updated); put.push(updated);
      }
    }
    remove.forEach((id) => rows.delete(id)); await persist(put, remove);
  });
  const removeDecisionTraces = (gameId: string) => pruneDecisionTraces(gameId, 0);
  const retainDecisionTraces = (gameIds: string[]) => run(async () => {
    const keep = new Set(gameIds); const remove = [...rows.values()].filter((row) => !keep.has(row.gameId)).map((row) => row.id);
    remove.forEach((id) => rows.delete(id)); if (remove.length) await persist([], remove);
  });
  return { writeDecisionTrace, readDecisionTraces, recordTraceReply, pruneDecisionTraces, removeDecisionTraces, retainDecisionTraces,
    subscribeDecisionTraces: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getDecisionTraceRevision: () => revision };
}

function indexedDbBackend(): TraceBackend | undefined {
  if (typeof indexedDB === 'undefined') return;
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('trappy.decision-traces.v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('traces', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Decision storage is blocked by another tab.'));
  });
  return {
    getAll: async () => {
      const db = await open();
      return new Promise<TraceRow[]>((resolve, reject) => {
        const request = db.transaction('traces').objectStore('traces').getAll();
        request.onsuccess = () => resolve(request.result as TraceRow[]); request.onerror = () => reject(request.error);
      });
    },
    apply: async (put, remove) => {
      const db = await open();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('traces', 'readwrite'); const store = transaction.objectStore('traces');
        remove.forEach((id) => store.delete(id)); put.forEach((row) => store.put(row));
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
  };
}
let browserBackend: TraceBackend | undefined;
try { browserBackend = indexedDbBackend(); } catch { /* Restricted browser contexts use the session fallback. */ }
const browserStore = createDecisionTraceStore(browserBackend);
export const { writeDecisionTrace, readDecisionTraces, recordTraceReply, pruneDecisionTraces, removeDecisionTraces,
  retainDecisionTraces, subscribeDecisionTraces, getDecisionTraceRevision } = browserStore;
