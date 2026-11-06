import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { allOpenings, compatibleOpeningIds, getOpening, loadFavouriteIds, matchingBookMoves, openingAtPly, openingBranches, openingGuidance, openingPrefix, searchOpenings, setFavouriteIds } from '../src/openings/library';
import { defaultStatisticsFilters, fetchOpeningStatistics } from '../src/openings/statistics';
import puzzles from '../src/openings/puzzleExamples.json';
import { trapRepertoire } from '../src/openings/trapRepertoire';
import { allTrapStudies, selectableTrapStudies } from '../src/openings/trapLibrary';

const storage = new Map<string, string>();
let rejectStorage = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { if (rejectStorage) throw new Error('quota'); storage.set(key, value); },
} });
assert.equal(allOpenings.length, 3865 + selectableTrapStudies.length);
assert.equal(new Set(allOpenings.map((opening) => opening.id)).size, allOpenings.length);
const catalogueChecks = process.argv.includes('--catalogue') ? allOpenings
  : allOpenings.filter((opening, index) => allTrapStudies.some((study) => study.id === opening.id) || index % 700 === 0);
for (const opening of catalogueChecks) {
  const board = new Chess();
  for (const move of opening.uci) board.move(move);
  assert.equal(board.fen(), opening.fen, `${opening.id} has correct endpoint`);
}
const legal = getOpening('trap-legal')!;
assert.equal(legal.name, 'Légal queen lure · trap study');
const beforeBait = legal.uci.slice(0, -1);
assert.deepEqual(matchingBookMoves(beforeBait, [legal.id]), ['f3e5']);
assert.equal(openingGuidance(beforeBait, [legal.id])?.san, 'Nxe5');
assert.deepEqual(matchingBookMoves([...beforeBait, 'f1e1'], [legal.id]), []);
assert.deepEqual(matchingBookMoves(legal.uci, [legal.id]), []);
assert.deepEqual(compatibleOpeningIds(['e2e4'], ['trap-legal', 'trap-elephant']), ['trap-legal']);
assert.deepEqual(matchingBookMoves([], ['trap-legal', 'trap-elephant']), ['e2e4', 'd2d4']);
assert(searchOpenings('sicilian b20').every((opening) => opening.eco === 'B20' && opening.name.toLowerCase().includes('sicilian')));
assert.equal(searchOpenings('', ['trap-legal']).length, 1);
assert(openingBranches(['e2e4']).some((branch) => branch.move === 'c7c5'));
assert.equal(openingAtPly(legal, -1).history.length, 0);
assert.equal(openingAtPly(legal, 999).fen, legal.fen);
const prefix = openingPrefix(legal, 4);
const prefixBoard = new Chess(); prefixBoard.loadPgn(prefix.pgn);
assert.equal(prefixBoard.fen(), prefix.fen);
assert.equal(prefix.uci.length, 4); assert.equal(prefix.id, legal.id);
assert.deepEqual(matchingBookMoves(prefix.uci, [prefix.id]), [legal.uci[4]]);
assert.equal(setFavouriteIds(['trap-legal', 'missing', 'trap-legal']), true);
assert.deepEqual(loadFavouriteIds(), ['trap-legal']);
storage.set('trappy.opening-favourites.v1', JSON.stringify(['trap-fishing-pole']));
assert.deepEqual(loadFavouriteIds(), ['trap-fishing-pole'], 'New games see favourites changed elsewhere');
rejectStorage = true;
assert.equal(setFavouriteIds(['trap-elephant']), false);
// Session values must survive a failed persistence attempt.
assert.deepEqual(loadFavouriteIds(), ['trap-elephant']);
rejectStorage = false;
for (const puzzle of puzzles) {
  const board = new Chess(puzzle.preMistakeFen);
  board.move(puzzle.initialMove);
  assert.equal(board.fen(), puzzle.solverFen);
  for (const move of puzzle.solution) board.move(move);
  assert(puzzle.motifs.includes(puzzle.selectedMotif));
}
assert.equal(puzzles.length, 6);
assert.equal(trapRepertoire.length, 5);

const originalFetch = globalThis.fetch;
const response = () => new Response(JSON.stringify({ white: 4, draws: 2, black: 4, moves: [{ uci: 'e2e4', san: 'e4', white: 4, draws: 2, black: 4 }] }), { status: 200 });
let active = 0; let maxActive = 0; let requests = 0;
const urls: string[] = [];
globalThis.fetch = async (url, init) => {
  requests++; active++; maxActive = Math.max(maxActive, active); urls.push(String(url));
  assert.equal(init?.credentials, 'omit');
  await new Promise((resolve) => setTimeout(resolve, 10));
  active--; return response();
};
try {
  storage.set('trappy.opening-statistics.v1', JSON.stringify({ badNull: null, badString: 'bad', badObject: { fetchedAt: Date.now(), moves: [] }, badTimestamp: { fetchedAt: 'today' } }));
  const start = new Chess().fen();
  const afterE4 = new Chess(); afterE4.move('e4');
  const [first, second] = await Promise.all([fetchOpeningStatistics(start, defaultStatisticsFilters), fetchOpeningStatistics(afterE4.fen(), defaultStatisticsFilters)]);
  assert.equal(maxActive, 1, 'Explorer calls must be serial');
  assert.equal(requests, 2);
  assert.equal(first.cached, false); assert.equal(second.cached, false);
  const cached = await fetchOpeningStatistics(start, defaultStatisticsFilters);
  assert.equal(cached.cached, true); assert.equal(requests, 2);
  assert.equal(Object.keys(JSON.parse(storage.get('trappy.opening-statistics.v1')!)).length, 2, 'Corrupt cache rows must be discarded without blocking valid fetches');
  assert(urls.every((url) => new URL(url).origin === 'https://explorer.lichess.ovh'));
  assert.equal(new URL(urls[0]).searchParams.get('speeds'), 'rapid');
  assert.equal(new URL(urls[0]).searchParams.get('ratings'), '1000,1200,1400,1600');
  await assert.rejects(fetchOpeningStatistics(start, { ratings: [], speeds: ['rapid'] }), /Choose at least one/);
  globalThis.fetch = async () => new Response('{"invalid":true}', { status: 200 });
  await assert.rejects(fetchOpeningStatistics(start, { ratings: [1800], speeds: ['blitz'] }), /unreadable/);
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(fetchOpeningStatistics(start, { ratings: [2000], speeds: ['blitz'] }), /unavailable/);
  let limitedCalls = 0;
  globalThis.fetch = async () => { limitedCalls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); };
  await assert.rejects(fetchOpeningStatistics(start, { ratings: [2200], speeds: ['blitz'] }), /limiting/);
  await assert.rejects(fetchOpeningStatistics(start, { ratings: [2500], speeds: ['rapid'] }), /limiting/);
  assert.equal(limitedCalls, 1, '429 cooldown must prevent repeated calls');
} finally { globalThis.fetch = originalFetch; }
console.log('Opening catalogue, curated lines, puzzle semantics, favourites and Explorer serial/cache/failure checks passed.');
