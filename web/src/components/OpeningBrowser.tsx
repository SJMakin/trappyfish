import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Chess, type Color } from 'chess.js';
import { BookOpen, ChevronLeft, ChevronRight, Search, Star, Swords } from 'lucide-react';
import {
  allOpenings, getOpening, loadFavouriteIds, openingAtPly, openingBranches, openingPrefix, openingProvenance,
  searchOpenings, setFavouriteIds, type Opening, type OpeningStartMode,
} from '../openings/library';
import {
  defaultStatisticsFilters, fetchOpeningStatistics, statisticsRatingGroups, statisticsSpeeds,
  type OpeningStatistics, type OpeningStatisticsFilters,
} from '../openings/statistics';
import { selectableTrapStudies as trapStudies } from '../openings/trapLibrary';
import trapVerification from '../openings/trapVerification.json';
import libraryVerification from '../openings/trapLibraryVerification.json';
import humanSamples from '../openings/trapHumanSamples.json';
import modelSamples from '../openings/trapModelSamples.json';
import trapSourceLicense from '../openings/source/chess-coach-LICENSE.txt?raw';
import './openingBrowser.css';

export interface OpeningBrowserProps {
  onSelect: (opening: Opening, startMode: OpeningStartMode, options?: { playerColor?: Color }) => void;
  selectedId?: string;
  onFreePlay?: () => void;
  onFavourites?: (ids: string[]) => void;
  initialOpen?: boolean;
  initialLibraryMode?: 'openings' | 'traps';
  libraryMode?: 'openings' | 'traps';
  onLibraryModeChange?: (mode: 'openings' | 'traps') => void;
}
type VerificationRow = {
  id: string; riskCp: number; bestDefenseSan: string; temptingReplyLossCp?: number; punishmentRiskCp?: number;
  punishmentSan?: string;
  temptingReplyAllowsMate?: boolean; punishmentKeepsMate?: boolean; warnings?: string[];
  illustrativeLine?: { legal: boolean; endsInMate: boolean };
};
type HumanSample = { id: string; gamesAtPosition?: number | null; mistakeGames?: number | null; mistakeFrequency?: number | null; fetchedAt?: string;
  status: 'available' | 'unavailable' | 'rate-limited'; reason?: string };
const verificationDocument = libraryVerification as { depth: number; caveat?: string; positions: VerificationRow[] };
const humanDocument = humanSamples as { ratings: number[]; speeds: string[]; positions: HumanSample[] };
const modelDocument = modelSamples as { engineRating: number; positions: { id: string; opponentRating: number;
  modelProbability: number | null; status: 'available' | 'unavailable' }[] };
const trapsById = new Map(trapStudies.map(trap => [trap.id, trap]));
const trapMotifs = [...new Set(trapStudies.map(trap => trap.motif))].sort();
function trapPath(trap: (typeof trapStudies)[number]) {
  const board = new Chess(); const fens = [board.fen()]; const san: string[] = []; const uci: string[] = [];
  for (const move of [...trap.setup, trap.bait, trap.temptingReply, ...trap.punishment]) {
    const played = board.move(move); san.push(played.san); uci.push(`${played.from}${played.to}${played.promotion ?? ''}`); fens.push(board.fen());
  }
  return { fens, san, uci };
}
function finiteCp(value: number): string {
  return Math.abs(value) >= 90_000 ? 'Mate score' : `${Math.round(value)} cp`;
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
export function OpeningBrowser({ onSelect, selectedId, onFreePlay, onFavourites, initialOpen = false, initialLibraryMode = 'openings', libraryMode: controlledLibraryMode, onLibraryModeChange }: OpeningBrowserProps) {
  const initialMode = controlledLibraryMode ?? initialLibraryMode;
  const initial = initialMode === 'traps' ? trapStudies.find(trap => trap.id === selectedId)?.opening ?? trapStudies[0].opening
    : getOpening(selectedId ?? '') ?? allOpenings.find((opening) => opening.name === 'Italian Game') ?? allOpenings[0];
  const [localLibraryMode, setLocalLibraryMode] = useState(initialMode);
  const libraryMode = controlledLibraryMode ?? localLibraryMode;
  const [previewId, setPreviewId] = useState(initial.id);
  const [ply, setPly] = useState(initialMode === 'traps' ? trapsById.get(initial.id)?.setup.length ?? initial.uci.length : initial.uci.length);
  const [query, setQuery] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [trapSide, setTrapSide] = useState<'either' | Color>('either');
  const [trapMotif, setTrapMotif] = useState('all');
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
  const trap = trapsById.get(opening.id);
  const path = useMemo(() => trap ? trapPath(trap) : undefined, [trap]);
  const maximumPly = path?.uci.length ?? opening.uci.length;
  const verified = verificationDocument.positions.find(item => item.id === opening.id);
  const legacyVerified = trapVerification.positions.find(item => item.id === opening.id);
  const humanSample = humanDocument.positions.find(item => item.id === opening.id);
  const modelReferences = modelDocument.positions.filter(item => item.id === opening.id);
  const position = useMemo(() => path ? { fen: path.fens[Math.min(ply, maximumPly)], history: path.uci.slice(0, ply), san: path.san.slice(0, ply) }
    : openingAtPly(opening, ply), [opening, ply, path, maximumPly]);
  const branches = useMemo(() => openingBranches(position.history), [position.history.join(' ')]);
  const results = useMemo(() => searchOpenings(query, favouritesOnly ? favourites : undefined).filter(item => {
    if (libraryMode !== 'traps') return true;
    const study = trapsById.get(item.id);
    return study && (trapSide === 'either' || study.side === trapSide) && (trapMotif === 'all' || study.motif === trapMotif);
  }), [query, favouritesOnly, favourites, libraryMode, trapSide, trapMotif]);
  const filterKey = `${filters.ratings.join(',')}|${filters.speeds.join(',')}`;
  useEffect(() => {
    request.current += 1;
    setStatistics(undefined); setStatisticsError(''); setLoading(false);
  }, [position.fen, filterKey]);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => {
    if (controlledLibraryMode === undefined) setLocalLibraryMode(initialLibraryMode);
  }, [initialLibraryMode]);
  useEffect(() => {
    if (libraryMode === 'traps' && !trapsById.has(previewId)) preview(trapStudies[0].opening, trapStudies[0].setup.length);
  }, [libraryMode]);
  useEffect(() => {
    if (libraryMode === 'traps' && results.length && !results.some(item => item.id === previewId)) preview(results[0], trapsById.get(results[0].id)?.setup.length ?? results[0].uci.length);
  }, [libraryMode, results, previewId]);
  useEffect(() => {
    const selected = selectedId && getOpening(selectedId);
    if (selected) { setPreviewId(selected.id); setPly(libraryMode === 'traps' ? trapsById.get(selected.id)?.setup.length ?? selected.uci.length : selected.uci.length); }
  }, [selectedId]);
  function preview(next: Opening, at = next.uci.length) { setPreviewId(next.id); setPly(at); }
  function chooseMode(mode: 'openings' | 'traps') {
    setLocalLibraryMode(mode); onLibraryModeChange?.(mode); setVisibleCount(40);
    if (mode === 'traps' && !trap) preview(trapStudies[0].opening, trapStudies[0].setup.length);
  }
  function previewPrefix(): Opening {
    if (!path || ply <= opening.uci.length) return openingPrefix(opening, ply);
    const board = new Chess(); path.uci.slice(0, ply).forEach(move => board.move(move));
    return { ...opening, uci: path.uci.slice(0, ply), pgn: board.pgn(), fen: board.fen() };
  }
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
    <summary><BookOpen size={17} aria-hidden="true" /><span>Opening &amp; trap library</span><small>{trapStudies.length} trap studies</small></summary>
    <div className="opening-browser-body">
      <p className="muted">Explore a line, save favourites, or choose how your next game begins. Book moves stay within your explicit risk limits.</p>
      <div className="library-collections" role="group" aria-label="Library collection">
        <button type="button" aria-pressed={libraryMode === 'openings'} onClick={() => chooseMode('openings')}><BookOpen size={15} aria-hidden="true" />All openings <span>{allOpenings.length.toLocaleString()}</span></button>
        <button type="button" aria-pressed={libraryMode === 'traps'} onClick={() => chooseMode('traps')}><Swords size={15} aria-hidden="true" />Trap studies <span>{trapStudies.length}</span></button>
      </div>
      {libraryMode === 'traps' ? <div className="trap-library-intro"><h3>Explore the bait and the defense</h3><p>Each study shows a setup, an offered opportunity and an illustrative continuation. Replay the line, inspect the searched defense, then choose which side to play.</p></div> : null}
      <div className="opening-mode-actions">
        {onFreePlay && <button type="button" onClick={onFreePlay}>Free play</button>}
        {onFavourites && <button type="button" onClick={() => onFavourites(favourites)} disabled={!favourites.length}>Use favourites for new games ({favourites.length})</button>}
      </div>
      <label className="opening-search" htmlFor={searchId}><Search size={16} aria-hidden="true" /><span className="sr-only">Search opening names, ECO codes or moves</span><input id={searchId} value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(40); }} placeholder={libraryMode === 'traps' ? 'Trap name, opening or moves…' : 'Name, ECO code or moves…'} type="search" /></label>
      {libraryMode === 'traps' ? <div className="trap-library-filters">
        <label>Trapper’s color<select aria-label="Filter trapper color" value={trapSide} onChange={event => setTrapSide(event.target.value as typeof trapSide)}><option value="either">Either color</option><option value="w">White</option><option value="b">Black</option></select></label>
        <label>Pattern<select aria-label="Filter trap pattern" value={trapMotif} onChange={event => setTrapMotif(event.target.value)}><option value="all">All patterns</option>{trapMotifs.map(motif => <option key={motif} value={motif}>{motif}</option>)}</select></label>
      </div> : null}
      <label className="opening-favourites-filter"><input type="checkbox" checked={favouritesOnly} onChange={(event) => { setFavouritesOnly(event.target.checked); setVisibleCount(40); }} />Favourites only</label>
      <div className="opening-library-grid">
        <div className="opening-result-column">
          <p className="opening-result-count" aria-live="polite">{results.length.toLocaleString()} matching {libraryMode === 'traps' ? 'studies' : 'lines'}</p>
          <ul className="opening-results" aria-label="Opening search results">{results.slice(0, visibleCount).map((item) => { const study = trapsById.get(item.id); return <li key={item.id}><button type="button" className={item.id === opening.id ? 'selected' : ''} aria-pressed={item.id === opening.id} onClick={() => preview(item, libraryMode === 'traps' && study ? study.setup.length : item.uci.length)}><span className="opening-eco">{item.eco}</span><span>{libraryMode === 'traps' && study ? study.name : item.name}{libraryMode === 'traps' && study ? <small>{study.side === 'w' ? 'White' : 'Black'} · {study.motif}</small> : null}</span>{favourites.includes(item.id) && <Star size={13} fill="currentColor" aria-label="Favourite" />}</button></li>; })}</ul>
          {!results.length && <p>No matching {libraryMode === 'traps' ? 'trap studies' : 'openings'}. Try a broader search or reset the filters.</p>}
          {results.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 40)}>Show 40 more</button>}
        </div>
        <div className="opening-preview">
          <div className="opening-preview-title"><div><span className="opening-eco">{opening.eco}{trap ? ` · ${trap.side === 'w' ? 'White' : 'Black'} sets the trap` : ''}</span><h3>{trap?.name ?? opening.name}</h3></div><button type="button" className="opening-favourite" aria-label={`${favourites.includes(opening.id) ? 'Remove' : 'Add'} ${opening.name} ${favourites.includes(opening.id) ? 'from' : 'to'} favourites`} aria-pressed={favourites.includes(opening.id)} onClick={toggleFavourite}><Star size={18} fill={favourites.includes(opening.id) ? 'currentColor' : 'none'} /></button></div>
          <PreviewBoard fen={position.fen} />
          {trap ? <p className="trap-preview-phase">{ply < trap.setup.length ? 'Opening setup' : ply === trap.setup.length ? `Before the bait: ${trap.bait}` : ply === trap.setup.length + 1 ? `Bait played: ${trap.bait}` : ply === trap.setup.length + 2 ? `Illustrative reply: ${trap.temptingReply}` : 'Illustrative continuation'}</p> : null}
          <div className="opening-preview-navigation"><button type="button" aria-label="Previous opening move" disabled={!ply} onClick={() => setPly((at) => Math.max(0, at - 1))}><ChevronLeft size={17} /></button><label htmlFor={sliderId}>Ply {ply} / {maximumPly}</label><button type="button" aria-label="Next opening move" disabled={ply >= maximumPly} onClick={() => setPly((at) => Math.min(maximumPly, at + 1))}><ChevronRight size={17} /></button></div>
          <input id={sliderId} type="range" min={0} max={maximumPly} value={ply} onChange={(event) => setPly(Number(event.target.value))} aria-label="Preview opening move" />
          {trap && path ? <div className="trap-line-replay" aria-label="Replay trap sequence"><p>Replay the complete study</p><div>{path.san.map((san, index) => {
            const phase = index === trap.setup.length ? 'bait' : index === trap.setup.length + 1 ? 'reply' : index > trap.setup.length + 1 ? 'continuation' : 'setup';
            return <button type="button" key={index} data-phase={phase} className={ply === index + 1 ? 'is-current' : ''} aria-pressed={ply === index + 1} aria-label={`Preview ${phase === 'reply' ? 'illustrative reply' : phase}: ${san}`} onClick={() => setPly(index + 1)}>{san}</button>;
          })}</div><small>Blue: bait · Amber: illustrative reply. Later moves show one legal possibility.</small></div> : null}
          <p className="opening-pgn">{opening.pgn.replace(/^\[[^\n]*\]\s*$/gm, '').trim()}</p>
          {trap ? <div className="trap-practice-actions"><button type="button" className="primary-button" onClick={() => onSelect(openingPrefix(opening, trap.setup.length), 'position', { playerColor: trap.side === 'w' ? 'b' : 'w' })}>Face this trap</button><button type="button" onClick={() => onSelect(openingPrefix(opening, trap.setup.length), 'position', { playerColor: trap.side })}>Play this trap</button><p>Starts before {trap.bait}. Choose the remaining game settings in the next panel. The engine follows the book only while it meets your risk limit.</p></div> : null}
          <div className="opening-start-actions"><button type="button" onClick={() => onSelect(previewPrefix(), 'position')}>Start at preview position</button><button type="button" onClick={() => onSelect(opening, 'line')}>Play into this opening</button></div>
          <p className="muted">Start at ply {ply}, or play from the initial board toward this named line. Your moves remain your choice.</p>
          {trap ? <section className="opening-trap-study" aria-label="Trap study details"><h4>{trap.motif}</h4><p>{trap.explanation}</p><p className="trap-caution">{trap.caution}</p>
            <dl className="trap-study-facts"><div><dt>Bait</dt><dd>{trap.bait}</dd></div><div><dt>Illustrative reply</dt><dd>{trap.temptingReply}</dd></div><div><dt>Best searched defense</dt><dd>{verified?.bestDefenseSan ?? legacyVerified?.bestDefenseSan ?? 'Not sampled'}</dd></div><div><dt>Bait concession</dt><dd>{verified ? finiteCp(verified.riskCp) : legacyVerified ? finiteCp(legacyVerified.riskCp) : 'Not sampled'}</dd></div>
              <div><dt>Loss after the reply</dt><dd>{verified?.temptingReplyAllowsMate ? 'Allows searched mate' : verified?.temptingReplyLossCp === undefined ? 'Not sampled' : finiteCp(verified.temptingReplyLossCp)}</dd></div><div><dt>First punishment</dt><dd>{verified?.punishmentSan ?? trap.punishment[0] ?? 'None recorded'}</dd></div>
              <div><dt>Punishment concession</dt><dd>{verified?.punishmentKeepsMate ? 'Retains searched mate' : verified?.punishmentRiskCp === undefined ? 'Not sampled' : finiteCp(verified.punishmentRiskCp)}</dd></div><div><dt>Study line ending</dt><dd>{verified?.illustrativeLine?.endsInMate ? 'Illustrative checkmate' : 'Illustrative continuation'}</dd></div></dl>
            {verified || legacyVerified ? <p className="trap-verification-note">Independent Stockfish depth {verified ? verificationDocument.depth : trapVerification.depth} samples. 100 cp = one pawn. Finite searches can disagree; a legal illustrative line does not mean the defender must follow it.</p> : <p className="trap-verification-note">The moves replay legally. No independent engine sample is available for this study.</p>}
            {verified?.warnings?.length ? <ul className="trap-study-warnings">{verified.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
            {trap.defensiveAlternative ? <p><strong>{trap.defensiveAlternative.basis === 'source-decline' ? 'Another way to decline:' : 'Earlier defensive sample:'}</strong> {trap.defensiveAlternative.san}{trap.defensiveAlternative.continuationSan.length ? ` ${trap.defensiveAlternative.continuationSan.join(' ')}` : ''}. {trap.defensiveAlternative.basis === 'source-decline' ? 'This source-supplied branch is separate from the best searched defense above.' : 'This earlier finite-depth sample may differ from the current sample above.'}</p> : null}
            <div className="trap-model-sample"><h5>Maia reply model</h5><p>Estimated chance of {trap.temptingReply} after the bait.</p>{modelReferences.length ? <dl>{modelReferences.map(reference => <div key={reference.opponentRating}><dt>{reference.opponentRating} model</dt><dd>{reference.status === 'available' && typeof reference.modelProbability === 'number' ? `${(reference.modelProbability * 100).toFixed(1)}%` : 'Unavailable'}</dd></div>)}</dl> : <p>No model reference is recorded.</p>}<small>Recorded reference estimates with engine rating {modelDocument.engineRating}. These are model outputs, separate from observed human frequencies and your current game controls.</small></div>
            <div className="trap-human-sample"><h5>Human reply sample</h5>{humanSample?.status === 'available' && typeof humanSample.gamesAtPosition === 'number' && typeof humanSample.mistakeGames === 'number' ? <p>{humanSample.mistakeGames.toLocaleString()} of {humanSample.gamesAtPosition.toLocaleString()} sampled games chose {trap.temptingReply}{typeof humanSample.mistakeFrequency !== 'number' ? '' : ` (${(humanSample.mistakeFrequency * 100).toFixed(1)}%)`}. Rated {humanDocument.speeds.join(', ')} · groups {humanDocument.ratings.join(', ')}{humanSample.fetchedAt ? ` · ${new Date(humanSample.fetchedAt).toLocaleDateString()}` : ''}. This is conditional on reaching the position.</p> : <p>No human-frequency sample is recorded{humanSample?.status === 'rate-limited' ? ' because the source limited requests' : ''}. Request current statistics below for the preview position.</p>}</div>
            <p className="trap-source-credit">{trap.provenance.license === 'MIT' ? <>Adapted from <a href={trap.provenance.url} target="_blank" rel="noreferrer">Chess Coach</a> · MIT-licensed source.</> : 'Project-authored study.'} <a href={trap.source} target="_blank" rel="noreferrer">Study source</a></p>
            {trap.provenance.license === 'MIT' ? <details className="trap-source-license"><summary>Source copyright &amp; license</summary>{trap.provenance.revision ? <p>Source revision <a href={trap.provenance.url} target="_blank" rel="noreferrer">{trap.provenance.revision.slice(0, 8)}</a>.</p> : null}<pre>{trapSourceLicense}</pre></details> : null}
          </section> : null}
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
