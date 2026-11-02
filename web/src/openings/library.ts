import { Chess } from 'chess.js';
import catalogue from './catalogue.json';
import provenance from './provenance.json';
import { curatedTrapOpenings } from './trapRepertoire';

export interface Opening {
  id: string;
  name: string;
  eco: string;
  pgn: string;
  uci: string[];
  fen: string;
}

export type OpeningStartMode = 'position' | 'line';
export interface OpeningSession {
  mode: 'selected' | 'favourites';
  openingIds: string[];
  startMode: OpeningStartMode;
  name: string;
}
export const openingProvenance = provenance;
export const allOpenings: readonly Opening[] = [...catalogue, ...curatedTrapOpenings];
const byId = new Map(allOpenings.map((opening) => [opening.id, opening]));
const favouriteKey = 'trappy.opening-favourites.v1';
let memoryFavourites: string[] = [];
let favouritesDirty = false;

export function getOpening(id: string): Opening | undefined { return byId.get(id); }

export function loadFavouriteIds(): string[] {
  if (!favouritesDirty) {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(favouriteKey) ?? '[]');
      if (Array.isArray(raw)) memoryFavourites = [...new Set(raw.filter((id): id is string => typeof id === 'string' && byId.has(id)))];
    } catch { /* An unavailable store must not prevent playing. */ }
  }
  return [...memoryFavourites];
}

/** Returns false when favourites are only available for this tab. */
export function setFavouriteIds(ids: string[]): boolean {
  memoryFavourites = [...new Set(ids.filter((id) => byId.has(id)))];
  try { localStorage.setItem(favouriteKey, JSON.stringify(memoryFavourites)); favouritesDirty = false; return true; }
  catch { favouritesDirty = true; return false; }
}

export function compatibleOpeningIds(history: readonly string[], ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const opening = byId.get(id);
    return opening && history.length <= opening.uci.length && history.every((move, index) => opening.uci[index] === move);
  });
}

export function matchingBookMoves(history: readonly string[], ids: readonly string[]): string[] {
  return [...new Set(compatibleOpeningIds(history, ids).flatMap((id) => {
    const move = byId.get(id)?.uci[history.length];
    return move ? [move] : [];
  }))];
}

export function searchOpenings(query: string, favouriteIds?: readonly string[]): Opening[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const favourites = favouriteIds && new Set(favouriteIds);
  return allOpenings.filter((opening) => (!favourites || favourites.has(opening.id))
    && terms.every((term) => `${opening.name} ${opening.eco} ${opening.pgn}`.toLocaleLowerCase().includes(term)));
}

export function openingAtPly(opening: Opening, ply: number): { fen: string; history: string[]; san: string[] } {
  const chess = new Chess();
  for (const move of opening.uci.slice(0, Math.max(0, Math.min(opening.uci.length, Math.floor(ply))))) chess.move(move);
  return { fen: chess.fen(), history: opening.uci.slice(0, chess.history().length), san: chess.history() };
}

/** Preserves the opening identity while making the selected preview a complete PGN prefix. */
export function openingPrefix(opening: Opening, ply: number): Opening {
  const position = openingAtPly(opening, ply);
  const chess = new Chess();
  for (const move of position.history) chess.move(move);
  return { ...opening, uci: position.history, fen: position.fen, pgn: chess.pgn() };
}

export interface OpeningBranch { move: string; san: string; count: number; opening: Opening }
export function openingBranches(history: readonly string[]): OpeningBranch[] {
  const branches = new Map<string, OpeningBranch>();
  const chess = new Chess();
  try { for (const move of history) chess.move(move); } catch { return []; }
  for (const id of compatibleOpeningIds(history, allOpenings.map((opening) => opening.id))) {
    const opening = byId.get(id)!;
    const move = opening.uci[history.length];
    if (!move) continue;
    const current = branches.get(move);
    if (current) current.count += 1;
    else {
      const position = new Chess(chess.fen());
      const played = position.move(move);
      branches.set(move, { move, san: played.san, count: 1, opening });
    }
  }
  return [...branches.values()].sort((a, b) => b.count - a.count || a.san.localeCompare(b.san));
}

export function openingGuidance(history: readonly string[], ids: readonly string[]): { opening: Opening; move: string; san: string } | undefined {
  const id = compatibleOpeningIds(history, ids).find((id) => byId.get(id)!.uci.length > history.length);
  if (!id) return undefined;
  const opening = byId.get(id)!;
  const move = opening.uci[history.length];
  const chess = new Chess();
  try { for (const previous of history) chess.move(previous); return { opening, move, san: chess.move(move).san }; }
  catch { return undefined; }
}
