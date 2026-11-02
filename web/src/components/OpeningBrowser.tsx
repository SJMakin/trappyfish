import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Search, Star } from 'lucide-react';
import {
  allOpenings, getOpening, loadFavouriteIds, openingAtPly, openingBranches, openingPrefix, openingProvenance,
  searchOpenings, setFavouriteIds, type Opening, type OpeningStartMode,
} from '../openings/library';
import {
  defaultStatisticsFilters, fetchOpeningStatistics, statisticsRatingGroups, statisticsSpeeds,
  type OpeningStatistics, type OpeningStatisticsFilters,
} from '../openings/statistics';
import { trapRepertoire } from '../openings/trapRepertoire';
import trapVerification from '../openings/trapVerification.json';
import './openingBrowser.css';

export interface OpeningBrowserProps {
  onSelect: (opening: Opening, startMode: OpeningStartMode) => void;
  selectedId?: string;
  onFreePlay?: () => void;
  onFavourites?: (ids: string[]) => void;
  initialOpen?: boolean;
}
const pieces: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
function PreviewBoard({ fen }: { fen: string }) {
  const squares = fen.split(' ')[0].split('/').flatMap((rank) => [...rank].flatMap((piece) => /[1-8]/.test(piece) ? Array<string>(Number(piece)).fill('') : [piece]));
  return <div className="opening-board" role="img" aria-label={`Opening preview, ${fen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move`}>
    {squares.map((piece, index) => <span key={index} aria-hidden="true" className={`${(Math.floor(index / 8) + index % 8) % 2 ? 'dark' : 'light'} ${piece && piece === piece.toUpperCase() ? 'white-piece' : 'black-piece'}`}>{pieces[piece]}</span>)}
  </div>;
}
function percentage(part: number, total: number): string { return total ? `${Math.round(part / total * 100)}%` : '—'; }
function StatisticsTable({ statistics }: { statistics: OpeningStatistics }) {
  const total = statistics.white + statistics.draws + statistics.black;
  return <div className="opening-human-results">
    <p>{total.toLocaleString()} rated games · {statistics.cached ? 'Cached' : 'Fetched'} {new Date(statistics.fetchedAt).toLocaleString()}</p>
    {total === 0 ? <p>No games match these filters.</p> : <>
      <p>White wins {percentage(statistics.white, total)} · Draws {percentage(statistics.draws, total)} · Black wins {percentage(statistics.black, total)}</p>
      <div className="opening-table-scroll"><table><caption>Human moves in the preview position</caption><thead><tr><th>Move</th><th>Games</th><th>White</th><th>Draw</th><th>Black</th></tr></thead>
        <tbody>{statistics.moves.map((move) => { const games = move.white + move.draws + move.black; return <tr key={move.uci}><th scope="row">{move.san}</th><td>{games.toLocaleString()}</td><td>{percentage(move.white, games)}</td><td>{percentage(move.draws, games)}</td><td>{percentage(move.black, games)}</td></tr>; })}</tbody></table></div>
    </>}
  </div>;
}

/** Previewing and searching is entirely local. Only the statistics button makes a network request. */
export function OpeningBrowser({ onSelect, selectedId, onFreePlay, onFavourites, initialOpen = false }: OpeningBrowserProps) {
  const initial = getOpening(selectedId ?? '') ?? allOpenings.find((opening) => opening.name === 'Italian Game') ?? allOpenings[0];
  const [previewId, setPreviewId] = useState(initial.id);
  const [ply, setPly] = useState(initial.uci.length);
  const [query, setQuery] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [favourites, setFavourites] = useState(loadFavouriteIds);
  const [storageWarning, setStorageWarning] = useState('');
  const [visibleCount, setVisibleCount] = useState(40);
  const [filters, setFilters] = useState<OpeningStatisticsFilters>(() => ({ ratings: [...defaultStatisticsFilters.ratings], speeds: [...defaultStatisticsFilters.speeds] }));
  const [statistics, setStatistics] = useState<OpeningStatistics>();
  const [statisticsError, setStatisticsError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const searchId = useId();
  const sliderId = useId();
  const opening = getOpening(previewId)!;
  const trap = trapRepertoire.find((item) => item.id === opening.id);
  const verified = trapVerification.positions.find((item) => item.id === opening.id);
  const position = useMemo(() => openingAtPly(opening, ply), [opening, ply]);
  const branches = useMemo(() => openingBranches(position.history), [position.history.join(' ')]);
  const results = useMemo(() => searchOpenings(query, favouritesOnly ? favourites : undefined), [query, favouritesOnly, favourites]);
  const filterKey = `${filters.ratings.join(',')}|${filters.speeds.join(',')}`;
  useEffect(() => {
    request.current += 1;
    setStatistics(undefined); setStatisticsError(''); setLoading(false);
  }, [position.fen, filterKey]);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => {
    const selected = selectedId && getOpening(selectedId);
    if (selected) { setPreviewId(selected.id); setPly(selected.uci.length); }
  }, [selectedId]);
  function preview(next: Opening, at = next.uci.length) { setPreviewId(next.id); setPly(at); }
  function toggleFavourite() {
    const next = favourites.includes(opening.id) ? favourites.filter((id) => id !== opening.id) : [...favourites, opening.id];
    setFavourites(next);
    setStorageWarning(setFavouriteIds(next) ? '' : 'Favourites are kept in this tab because browser storage is unavailable.');
  }
  async function requestStatistics() {
    const current = ++request.current;
    setLoading(true); setStatisticsError('');
    try {
      const result = await fetchOpeningStatistics(position.fen, filters);
      if (current === request.current) setStatistics(result);
    } catch (error) {
      if (current === request.current) setStatisticsError(error instanceof Error ? error.message : 'Human statistics are unavailable.');
    } finally { if (current === request.current) setLoading(false); }
  }
  function toggleFilter<T extends number | string>(group: 'ratings' | 'speeds', value: T) {
    setFilters((previous) => {
      const values = previous[group] as T[];
      const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
      return { ...previous, [group]: next };
    });
  }
  return <details className="opening-browser" open={initialOpen || undefined}>
    <summary><BookOpen size={17} aria-hidden="true" /><span>Opening library</span><small>{allOpenings.length.toLocaleString()} named lines</small></summary>
    <div className="opening-browser-body">
      <p className="muted">Explore a line, save favourites, or choose how your next game begins. Book moves stay within your explicit risk limits.</p>
      <div className="opening-mode-actions">
        {onFreePlay && <button type="button" onClick={onFreePlay}>Free play</button>}
        {onFavourites && <button type="button" onClick={() => onFavourites(favourites)} disabled={!favourites.length}>Use favourites for new games ({favourites.length})</button>}
      </div>
      <label className="opening-search" htmlFor={searchId}><Search size={16} aria-hidden="true" /><span className="sr-only">Search opening names, ECO codes or moves</span><input id={searchId} value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(40); }} placeholder="Name, ECO code or moves…" type="search" /></label>
      <label className="opening-favourites-filter"><input type="checkbox" checked={favouritesOnly} onChange={(event) => { setFavouritesOnly(event.target.checked); setVisibleCount(40); }} />Favourites only</label>
      <div className="opening-library-grid">
        <div className="opening-result-column">
          <p className="opening-result-count" aria-live="polite">{results.length.toLocaleString()} matching lines</p>
          <ul className="opening-results" aria-label="Opening search results">{results.slice(0, visibleCount).map((item) => <li key={item.id}><button type="button" className={item.id === opening.id ? 'selected' : ''} aria-pressed={item.id === opening.id} onClick={() => preview(item)}><span className="opening-eco">{item.eco}</span><span>{item.name}</span>{favourites.includes(item.id) && <Star size={13} fill="currentColor" aria-label="Favourite" />}</button></li>)}</ul>
          {!results.length && <p>No matching openings. Try a broader name or ECO code.</p>}
          {results.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 40)}>Show 40 more</button>}
        </div>
        <div className="opening-preview">
          <div className="opening-preview-title"><div><span className="opening-eco">{opening.eco}</span><h3>{opening.name}</h3></div><button type="button" className="opening-favourite" aria-label={`${favourites.includes(opening.id) ? 'Remove' : 'Add'} ${opening.name} ${favourites.includes(opening.id) ? 'from' : 'to'} favourites`} aria-pressed={favourites.includes(opening.id)} onClick={toggleFavourite}><Star size={18} fill={favourites.includes(opening.id) ? 'currentColor' : 'none'} /></button></div>
          <PreviewBoard fen={position.fen} />
          <div className="opening-preview-navigation"><button type="button" aria-label="Previous opening move" disabled={!ply} onClick={() => setPly((at) => Math.max(0, at - 1))}><ChevronLeft size={17} /></button><label htmlFor={sliderId}>Ply {ply} / {opening.uci.length}</label><button type="button" aria-label="Next opening move" disabled={ply >= opening.uci.length} onClick={() => setPly((at) => Math.min(opening.uci.length, at + 1))}><ChevronRight size={17} /></button></div>
          <input id={sliderId} type="range" min={0} max={opening.uci.length} value={ply} onChange={(event) => setPly(Number(event.target.value))} aria-label="Preview opening move" />
          <p className="opening-pgn">{opening.pgn.replace(/^\[[^\n]*\]\s*$/gm, '').trim()}</p>
          <div className="opening-start-actions"><button type="button" onClick={() => onSelect(openingPrefix(opening, ply), 'position')}>Start at preview position</button><button type="button" onClick={() => onSelect(opening, 'line')}>Play into this opening</button></div>
          <p className="muted">Start at ply {ply}, or play from the initial board toward this named line. Your moves remain your choice.</p>
          {trap && <details className="opening-trap-study"><summary>Trap study · {trap.motif}</summary><p>{trap.explanation}</p><p><strong>Bait:</strong> {trap.bait} · <strong>Illustrative reply:</strong> {trap.temptingReply}</p><p><strong>Continuation:</strong> {trap.punishment.join(' ')}</p><p>{trap.caution}</p>{verified && <p>Independent Stockfish depth {trapVerification.depth} sample: defense {verified.bestDefenseSan}; measured concession {verified.riskCp} cp relative to its best root move. Finite-depth evidence, not a proof.</p>}<a href={trap.source} target="_blank" rel="noreferrer">Background on this pattern</a></details>}
          <details className="opening-branches"><summary>Catalogue branches at this preview ({branches.length})</summary>{branches.length ? <ul>{branches.map((branch) => <li key={branch.move}><button type="button" onClick={() => preview(branch.opening, ply + 1)}><strong>{branch.san}</strong><span>{branch.count} named {branch.count === 1 ? 'line' : 'lines'}</span></button></li>)}</ul> : <p>This named line ends here. Preview an earlier move to explore branches.</p>}<p className="muted">Counts describe this catalogue, not popularity or move quality.</p></details>
        </div>
      </div>
      {storageWarning && <p role="status">{storageWarning}</p>}
      <details className="opening-statistics"><summary>Optional human move statistics · Lichess</summary>
        <p>Off until requested. Sends this preview position and your filters to Lichess Opening Explorer. Results are cached locally for 24 hours; gameplay never needs a connection.</p>
        <fieldset><legend>Rated player groups</legend><div className="opening-filter-options">{statisticsRatingGroups.map((rating) => <label key={rating}><input type="checkbox" checked={filters.ratings.includes(rating)} onChange={() => toggleFilter('ratings', rating)} />{rating}</label>)}</div><small>Groups are Lichess rating buckets, not a calibrated opponent strength.</small></fieldset>
        <fieldset><legend>Time controls</legend><div className="opening-filter-options">{statisticsSpeeds.map((speed) => <label key={speed}><input type="checkbox" checked={filters.speeds.includes(speed)} onChange={() => toggleFilter('speeds', speed)} />{speed === 'ultraBullet' ? 'Ultrabullet' : speed[0].toUpperCase() + speed.slice(1)}</label>)}</div></fieldset>
        <button type="button" onClick={() => void requestStatistics()} disabled={loading || !filters.ratings.length || !filters.speeds.length}>{loading ? 'Requesting human statistics…' : 'Request human statistics for preview'}</button>
        <div aria-live="polite">{statisticsError && <p role="status">{statisticsError}</p>}{statistics && <StatisticsTable statistics={statistics} />}</div>
      </details>
      <p className="opening-data-credit">Offline catalogue: <a href={openingProvenance.source} target="_blank" rel="noreferrer">Lichess chess-openings</a> · CC0 · revision {openingProvenance.revision.slice(0, 8)}. Named lines are descriptions, not a guarantee of sound play.</p>
    </div>
  </details>;
}
