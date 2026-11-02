import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { DEFAULT_TRAPPY_SETTINGS, type CandidateInfo, type MoveDecision } from '../src/engine/trappy';
import { compactDecisionTrace, createDecisionTraceStore, type TraceBackend, type TraceInput, type TraceRow } from '../src/history/decisionTraces';
import { decisionForReview, rerankStoredCandidates, strongestRecordedDefense, traceBaitLine, verifiedMotif } from '../src/history/reviewModel';
import { createPositionHistoryStore, type SavedPosition } from '../src/history/positionHistory';

function backend() {
  const rows = new Map<string, TraceRow>(); let fail = false; let limit = Infinity;
  const storage: TraceBackend = { getAll: async () => [...rows.values()], apply: async (put, remove) => {
    if (fail) throw new Error('Blocked');
    const next = new Map(rows); remove.forEach((id) => next.delete(id)); put.forEach((row) => next.set(row.id, row));
    if (next.size > limit) throw new Error('QuotaExceededError');
    rows.clear(); next.forEach((row, id) => rows.set(id, row));
  } };
  return { storage, rows, block: () => { fail = true; }, quota: (count: number) => { limit = count; } };
}
function candidate(move: string, san: string, rootScoreCp = 0): CandidateInfo {
  return { move, san, rootScoreCp, adjustedScoreCp: rootScoreCp, riskCp: 0, bonusCp: 0, expectedScoreCp: 0,
    expectedScore: .5, objectiveScore: .5, policyCoverage: .95, replies: [], analyzed: true, status: 'evaluated',
    style: { attackPressure: 0, tension: 0, aggressionBonusCp: 0, tensionBonusCp: 0, pawnStorm: 0, kingExposure: 0,
      materialInvestment: 0, queenRetention: 0, pawnStormBonusCp: 0, kingCautionPenaltyCp: 0, sacrificeBonusCp: 0, queenRetentionBonusCp: 0 } };
}
function input(gameId = 'game', ply = 1, createdAt = 1): TraceInput {
  const selected = candidate('e2e4', 'e4');
  const decision: MoveDecision = { move: selected.move, san: selected.san, mode: 'trappy', rootBestMove: selected.move,
    rootBestSan: selected.san, rootBestScoreCp: 0, candidates: [selected, candidate('d2d4', 'd4')], selected, policySource: 'maia' };
  return { gameId, ply, rootFen: new Chess().fen(), settings: DEFAULT_TRAPPY_SETTINGS, styleEnabled: true, decision, createdAt };
}

test('Decision traces retain original settings and survive a store reload independently of PGN history', async () => {
  const disk = backend(); const store = createDecisionTraceStore(disk.storage); const original = input();
  await store.writeDecisionTrace(original); original.settings = { ...original.settings, trappiness: 0 };
  await store.recordTraceReply('game', 1, { move: 'e7e5', san: 'e5', ply: 2 });
  const read = await createDecisionTraceStore(disk.storage).readDecisionTraces('game');
  assert.equal(read.traces.length, 1); assert.equal(read.traces[0].settings.trappiness, 1);
  assert.equal(read.traces[0].actualReply?.san, 'e5'); assert.equal(read.warning, undefined);
  assert.equal((await store.readDecisionTraces('old-game-without-traces')).traces.length, 0);
});

test('Undo invalidates future decisions and the removed actual reply, with queued writes preserved in order', async () => {
  const store = createDecisionTraceStore(backend().storage);
  const first = store.writeDecisionTrace(input('game', 1));
  const reply = store.recordTraceReply('game', 1, { move: 'e7e5', san: 'e5', ply: 2 });
  const next = store.writeDecisionTrace(input('game', 3, 3));
  const prune = store.pruneDecisionTraces('game', 1);
  await Promise.all([first, reply, next, prune]);
  const read = await store.readDecisionTraces('game');
  assert.equal(read.traces.length, 1); assert.equal(read.traces[0].actualReply, undefined);
});

test('Trace size eviction removes the oldest trace only and never mutates saved games', async () => {
  const disk = backend(); const oneBytes = new TextEncoder().encode(JSON.stringify(compactDecisionTrace(input()))).byteLength + 128;
  const store = createDecisionTraceStore(disk.storage, oneBytes * 2 + 100);
  await store.writeDecisionTrace(input('old', 1, 1)); await store.writeDecisionTrace(input('middle', 1, 2));
  await store.writeDecisionTrace(input('newest', 1, 3));
  assert.equal((await store.readDecisionTraces('old')).traces.length, 0);
  assert.equal((await store.readDecisionTraces('middle')).traces.length, 1);
  assert.equal((await store.readDecisionTraces('newest')).traces.length, 1);
  assert.ok([...disk.rows.values()].reduce((sum, row) => sum + row.bytes, 0) <= oneBytes * 2 + 100);
});

test('A smaller browser quota evicts older durable traces; blocked storage retains a clear session fallback', async () => {
  const disk = backend(); const store = createDecisionTraceStore(disk.storage);
  await store.writeDecisionTrace(input('old')); disk.quota(1);
  await store.writeDecisionTrace(input('new', 1, 2));
  assert.equal((await store.readDecisionTraces('old')).traces.length, 0);
  assert.equal((await createDecisionTraceStore(disk.storage).readDecisionTraces('new')).traces.length, 1);
  disk.block(); await store.writeDecisionTrace(input('session', 1, 3));
  const fallback = await store.readDecisionTraces('session');
  assert.equal(fallback.traces.length, 1); assert.match(fallback.warning!, /tab/);
  assert.equal((await store.readDecisionTraces('new')).traces.length, 1, 'Blocked persistence must not discard earlier session traces while retrying a nonexistent quota problem');
  const disabled = createDecisionTraceStore(undefined); await disabled.writeDecisionTrace(input());
  assert.match((await disabled.readDecisionTraces('game')).warning!, /separately/);
});

test('Deleting a game clears only its traces, while compaction keeps selected and useful alternatives bounded', async () => {
  const store = createDecisionTraceStore(backend().storage); const original = input();
  original.decision.candidates.push(...Array.from({ length: 20 }, (_, index) => candidate(`extra${index}`, `Extra ${index}`)));
  const compact = compactDecisionTrace(original); assert.equal(compact.decision.candidates.length, 8);
  assert.equal(compact.decision.candidates[0].move, compact.decision.move);
  await store.writeDecisionTrace(original); await store.writeDecisionTrace(input('other'));
  await store.removeDecisionTraces('game');
  assert.equal((await store.readDecisionTraces('game')).traces.length, 0);
  assert.equal((await store.readDecisionTraces('other')).traces.length, 1);
  await store.retainDecisionTraces([]); assert.equal((await store.readDecisionTraces('other')).traces.length, 0);
});

test('Ended session, opening identity and old continuation budgets round-trip without disturbing full PGN', () => {
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } };
  const game = new Chess(); game.move('e4');
  const entry: SavedPosition = { id: 'finished', name: 'Ended game', kind: 'game', fen: game.fen({ forceEnpassantSquare: true }), pgn: game.pgn(),
    orientation: 'w', playerColor: 'w', createdAt: 1, updatedAt: 2, settings: DEFAULT_TRAPPY_SETTINGS,
    opening: { id: 'opening-1', name: 'King’s Pawn', eco: 'B00', startPly: 1, bookIds: Array.from({ length: 150 }, (_, index) => `opening-${index}`), bookExitReason: 'outside-risk' },
    result: { reason: 'resigned', winner: 'b' }, searchProfile: 'custom' };
  createPositionHistoryStore({ storage: () => storage }).savePosition(entry);
  const saved = createPositionHistoryStore({ storage: () => storage }).getHistorySnapshot().entries[0];
  assert.deepEqual(saved.result, entry.result); assert.deepEqual(saved.opening, entry.opening);
  assert.equal(saved.pgn, entry.pgn); assert.equal(saved.searchProfile, 'custom'); assert.equal(saved.settings?.continuationCandidates, 1);
});

test('Stored-pool reweighting changes relative preferences without changing the original trace or inventing moves', () => {
  const trace = compactDecisionTrace(input()); const human = trace.decision.candidates[1];
  human.replies = [{ move: 'd7d5', san: 'd5', probability: .95, scoreCp: 100, expectedScore: .7, lossCp: 100, punishment: [] }];
  human.expectedScore = .7; const before = JSON.stringify(trace);
  const low = rerankStoredCandidates(trace, { ...trace.settings, trappiness: 0 });
  const high = rerankStoredCandidates(trace, { ...trace.settings, trappiness: 1 });
  assert.ok(high.find((row) => row.candidate.move === 'd2d4')!.score > low.find((row) => row.candidate.move === 'd2d4')!.score);
  assert.equal(high.length, trace.decision.candidates.length); assert.equal(JSON.stringify(trace), before);
  human.riskCp = 200; assert.equal(rerankStoredCandidates(trace, trace.settings).find((row) => row.candidate.move === 'd2d4')!.eligible, false);
});

test('Motif labels require a legal stored line and prove checkmate or a fork', () => {
  const board = new Chess(); for (const san of ['f3', 'e5', 'g4']) board.move(san);
  assert.equal(verifiedMotif(board.fen(), ['d8h4']), 'Mating continuation');
  assert.equal(verifiedMotif(new Chess().fen(), ['e2e9']), 'Analyzed tactic');
  assert.equal(verifiedMotif(new Chess().fen(), ['e2e4']), 'Analyzed tactic');
  const legal = new Chess(); for (const san of ['e4','e5','Nf3','Nc6','Bc4','d6','Nc3','Bg4','h3','Bh5']) legal.move(san);
  const root = legal.fen();
  const lure = ['Nxe5','Bxd1','Bxf7+','Ke7','Nd5#'].map(san => { const move = legal.move(san); return `${move.from}${move.to}`; });
  assert.equal(verifiedMotif(root, lure), 'Queen lure leading to mate');
});

test('Review derives stronger forced defenses without rewriting original decisions or probability mass', () => {
  const trace = input();
  trace.decision.selected.replies = [
    { move: 'e7e5', san: 'e5', probability: .8, scoreCp: 50, expectedScore: .55, lossCp: 50, punishment: [], bestDefense: true },
    { move: 'c7c5', san: 'c5', probability: .1, scoreCp: 0, expectedScore: .5, lossCp: 0, punishment: [] },
  ];
  trace.decision.selected.bestDefenseMove = 'e7e5';
  const before = JSON.stringify(trace);
  assert.equal(strongestRecordedDefense(trace.decision.selected.replies)?.move, 'c7c5');
  const derived = decisionForReview(trace.decision);
  assert.equal(derived.selected.bestDefenseMove, 'c7c5');
  assert.equal(derived.selected.replies[1].bestDefense, true); assert.equal(derived.selected.replies[0].bestDefense, false);
  assert.equal(derived.selected.replies.reduce((sum, reply) => sum + reply.probability, 0), .9);
  assert.equal(JSON.stringify(trace), before);
});

test('Compaction keeps strongest defense and bait, and two-turn trap paths replay without doubled moves', () => {
  const trace = compactDecisionTrace(input()); const selected = trace.decision.selected;
  const reply = (index: number) => ({ move: `reply${index}`, san: `Reply ${index}`, probability: 1 / (index + 1), scoreCp: 0,
    expectedScore: .5, lossCp: 0, punishment: [] });
  selected.replies = Array.from({ length: 20 }, (_, index) => reply(index));
  selected.replies[19].bestDefense = true;
  selected.trap = { reply: 'reply18', replySan: 'Bait', probability: .1, profitCp: 100, scoreCp: 100,
    punishment: ['d8g5', 'e5f7', 'g5g2'], nextReply: { reply: 'e5f7', replySan: 'Nxf7', probability: .5, scoreCp: 100 } };
  const compact = compactDecisionTrace(trace);
  assert.ok(compact.decision.selected.replies.some((row) => row.move === 'reply19'));
  assert.ok(compact.decision.selected.replies.some((row) => row.move === 'reply18'));
  assert.deepEqual(traceBaitLine(compact), ['e2e4', 'reply18', 'd8g5', 'e5f7', 'g5g2']);
});

test('Corrupted trace data is skipped without affecting intact records or game history', async () => {
  const disk = backend(); await createDecisionTraceStore(disk.storage).writeDecisionTrace(input('intact'));
  const valid = [...disk.rows.values()][0];
  disk.rows.set('broken:1', { ...valid, id: 'broken:1', gameId: 'broken', json: JSON.stringify({ ...JSON.parse(valid.json), gameId: 'broken', rootFen: 'not a board' }) });
  disk.rows.set('bad-reply:1', { ...valid, id: 'bad-reply:1', gameId: 'bad-reply', json: JSON.stringify({ ...JSON.parse(valid.json), gameId: 'bad-reply', decision: { ...JSON.parse(valid.json).decision, selected: { replies: null } } }) });
  const reloaded = createDecisionTraceStore(disk.storage);
  assert.equal((await reloaded.readDecisionTraces('intact')).traces.length, 1);
  assert.equal((await reloaded.readDecisionTraces('broken')).traces.length, 0);
  assert.equal((await reloaded.readDecisionTraces('bad-reply')).traces.length, 0);
});
