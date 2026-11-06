export type HumanTrapSample = {
  id: string; fen: string; mistake: string; fetchedAt: string;
  status: 'available' | 'unavailable' | 'rate-limited';
  gamesAtPosition: number | null; mistakeGames: number | null; mistakeFrequency: number | null;
  reason?: string;
};

/** Mate encodings describe outcomes, not ordinary centipawn distances between mates. */
export function evaluationLossCp(best: number, chosen: number): number {
  if (best >= 90_000 && chosen >= 90_000 || best <= -90_000 && chosen <= -90_000) return 0;
  return Math.max(0, best - chosen);
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Explorer count is unreadable.');
  return value;
}
function games(value: Record<string, unknown>): number {
  const total = count(value.white) + count(value.draws) + count(value.black);
  if (!Number.isSafeInteger(total)) throw new Error('Explorer total is unreadable.');
  return total;
}
/** Missing replies in a limited top-move response have unknown counts. Child-position totals are never substituted. */
export function humanTrapSample(id: string, fen: string, mistake: string, response: unknown, fetchedAt: string): HumanTrapSample {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Explorer response is unreadable.');
  const body = response as Record<string, unknown>;
  const gamesAtPosition = games(body);
  if (!Array.isArray(body.moves)) throw new Error('Explorer move list is unreadable.');
  const row = body.moves.find(value => value && typeof value === 'object' && (value as Record<string, unknown>).uci === mistake) as Record<string, unknown> | undefined;
  const base = { id, fen, mistake, fetchedAt, gamesAtPosition };
  if (!row) return { ...base, status: 'unavailable', mistakeGames: null, mistakeFrequency: null,
    reason: gamesAtPosition ? 'The selected reply was not included in the returned top moves; its count is unknown.' : 'No games matched this position and these filters.' };
  const mistakeGames = games(row);
  if (mistakeGames > gamesAtPosition) throw new Error('Explorer move count exceeds the position total.');
  if (!gamesAtPosition) return { ...base, status: 'unavailable', mistakeGames, mistakeFrequency: null,
    reason: 'No games matched this position and these filters.' };
  return { ...base, status: 'available', mistakeGames, mistakeFrequency: mistakeGames / gamesAtPosition };
}
