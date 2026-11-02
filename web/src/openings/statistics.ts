export interface OpeningStatisticsFilters { ratings: number[]; speeds: string[] }
export interface OpeningStatisticsMove { uci: string; san: string; white: number; draws: number; black: number; averageRating?: number }
export interface OpeningStatistics {
  white: number; draws: number; black: number; moves: OpeningStatisticsMove[];
  fetchedAt: number; cached: boolean;
}
export const defaultStatisticsFilters: OpeningStatisticsFilters = { ratings: [1000, 1200, 1400, 1600], speeds: ['rapid'] };
export const statisticsRatingGroups = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
export const statisticsSpeeds = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
const cacheKey = 'trappy.opening-statistics.v1';
const cacheLifetime = 24 * 60 * 60 * 1000;
let queue: Promise<unknown> = Promise.resolve();
let retryAfter = 0;
let memoryCache: Record<string, OpeningStatistics> = {};

export class OpeningStatisticsError extends Error {
  constructor(message: string, public readonly retryAt?: number) { super(message); this.name = 'OpeningStatisticsError'; }
}
function cacheId(fen: string, filters: OpeningStatisticsFilters): string {
  return `${fen.split(' ').slice(0, 4).join(' ')}|${[...filters.ratings].sort((a,b)=>a-b).join(',')}|${[...filters.speeds].sort().join(',')}`;
}
function readCache(): Record<string, OpeningStatistics> {
  try {
    const stored = JSON.parse(localStorage.getItem(cacheKey) ?? '{}');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const safeEntries: [string, OpeningStatistics][] = [];
      for (const [id, value] of Object.entries(stored)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const fetchedAt = (value as Record<string, unknown>).fetchedAt;
        if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt) || fetchedAt > Date.now() || fetchedAt <= Date.now() - cacheLifetime) continue;
        try { safeEntries.push([id, { ...validated(value), fetchedAt, cached: true }]); } catch { /* Ignore corrupt cache rows independently. */ }
      }
      memoryCache = { ...Object.fromEntries(safeEntries), ...memoryCache };
    }
  } catch { /* Cache is optional. */ }
  return memoryCache;
}
function saveCache(id: string, result: OpeningStatistics) {
  memoryCache[id] = result;
  memoryCache = Object.fromEntries(Object.entries(memoryCache).filter(([, item]) => item.fetchedAt > Date.now() - cacheLifetime)
    .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt).slice(0, 30));
  try { localStorage.setItem(cacheKey, JSON.stringify(memoryCache)); } catch { /* Session cache still works. */ }
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new OpeningStatisticsError('Lichess returned an unreadable response. Try again later.');
  return value;
}
function validated(value: unknown): Omit<OpeningStatistics, 'cached'> {
  if (!value || typeof value !== 'object') throw new OpeningStatisticsError('Lichess returned an unreadable response. Try again later.');
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.moves)) throw new OpeningStatisticsError('Lichess returned an unreadable response. Try again later.');
  return { white: count(data.white), draws: count(data.draws), black: count(data.black), fetchedAt: Date.now(),
    moves: data.moves.map((raw) => {
      if (!raw || typeof raw !== 'object') throw new OpeningStatisticsError('Lichess returned an unreadable move.');
      const move = raw as Record<string, unknown>;
      if (typeof move.uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move.uci) || typeof move.san !== 'string') throw new OpeningStatisticsError('Lichess returned an unreadable move.');
      return { uci: move.uci, san: move.san, white: count(move.white), draws: count(move.draws), black: count(move.black),
        ...(typeof move.averageRating === 'number' && Number.isFinite(move.averageRating) ? { averageRating: move.averageRating } : {}) };
    }) };
}

/** Only call in response to an explicit user request. Requests are serialized across browser instances. */
export function fetchOpeningStatistics(fen: string, filters: OpeningStatisticsFilters): Promise<OpeningStatistics> {
  const ratings = [...new Set(filters.ratings)].filter((rating) => statisticsRatingGroups.includes(rating));
  const speeds = [...new Set(filters.speeds)].filter((speed) => statisticsSpeeds.includes(speed));
  if (!ratings.length || !speeds.length) return Promise.reject(new OpeningStatisticsError('Choose at least one rating group and time control.'));
  const safeFilters = { ratings, speeds };
  const id = cacheId(fen, safeFilters);
  const task = queue.catch(() => undefined).then(async () => {
    const cached = readCache()[id];
    if (cached && typeof cached.fetchedAt === 'number' && Date.now() - cached.fetchedAt >= 0 && Date.now() - cached.fetchedAt < cacheLifetime) {
      try { return { ...validated(cached), fetchedAt: cached.fetchedAt, cached: true }; } catch { /* Bad cache is ignored. */ }
    }
    if (Date.now() < retryAfter) throw new OpeningStatisticsError('Lichess is limiting requests. Please try again later.', retryAfter);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OpeningStatisticsError('You are offline. The opening catalogue and games still work.');
    const query = new URLSearchParams({ variant: 'standard', fen, ratings: ratings.join(','), speeds: speeds.join(','), moves: '12', topGames: '0', recentGames: '0' });
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try { response = await fetch(`https://explorer.lichess.ovh/lichess?${query}`, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
    catch { throw new OpeningStatisticsError('Human statistics are unavailable. The opening catalogue and games still work.'); }
    finally { clearTimeout(timeout); }
    if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const seconds = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 60_000;
      retryAfter = Date.now() + Math.max(60_000, Number.isFinite(seconds) ? seconds : 60_000);
      throw new OpeningStatisticsError('Lichess is limiting requests. Please try again later.', retryAfter);
    }
    if (!response.ok) throw new OpeningStatisticsError(`Human statistics are unavailable (Lichess ${response.status}). Try again later.`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new OpeningStatisticsError('Lichess returned an unreadable response. Try again later.'); }
    const result: OpeningStatistics = { ...validated(body), cached: false };
    saveCache(id, result);
    return result;
  });
  queue = task;
  return task;
}
