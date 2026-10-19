import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ArrowUpRight, ChevronDown, Clock3, Pencil, Search, Trash2, X } from 'lucide-react';
import {
  clearPositionHistory, getHistorySnapshot, removePosition, renamePosition, subscribeHistory,
  type SavedPosition,
} from '../history/positionHistory';
import './positionHistory.css';

interface PositionHistoryProps {
  onResume: (entry: SavedPosition) => void;
}

const pieces: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

function boardSquares(fen: string): string[] | undefined {
  const placement = fen.split(' ')[0];
  if (!placement || placement.length > 80) return undefined;
  const ranks = placement.split('/');
  if (ranks.length !== 8) return undefined;
  const squares: string[] = [];
  for (const rank of ranks) {
    const row: string[] = [];
    for (const value of rank) {
      if (/^[1-8]$/.test(value)) row.push(...Array<string>(Number(value)).fill(''));
      else if (pieces[value]) row.push(value);
      else return undefined;
    }
    if (row.length !== 8) return undefined;
    squares.push(...row);
  }
  return squares;
}

function PositionThumbnail({ entry }: { entry: SavedPosition }) {
  const squares = boardSquares(entry.fen);
  const indexes = Array.from({ length: 64 }, (_, index) => entry.orientation === 'b' ? 63 - index : index);
  return <div className="history-board" role="img"
    aria-label={`Board preview for ${entry.name}, ${entry.orientation === 'b' ? 'Black' : 'White'} at bottom`}
    data-orientation={entry.orientation === 'b' ? 'black' : 'white'}>
    {squares ? indexes.map((square, index) => <span key={square} aria-hidden="true"
      className={`history-square ${(Math.floor(index / 8) + index % 8) % 2 === 0 ? 'light' : 'dark'} ${squares[square] === squares[square].toUpperCase() ? 'white-piece' : 'black-piece'}`}
      data-square={`${'abcdefgh'[square % 8]}${8 - Math.floor(square / 8)}`}>
      {pieces[squares[square]] ?? ''}
    </span>) : <span className="history-board-unavailable" aria-hidden="true">?</span>}
  </div>;
}

function positionDescription(entry: SavedPosition): string {
  const fields = entry.fen.split(' ');
  const turn = fields[1] === 'b' ? 'Black' : 'White';
  const move = Number(fields[5]);
  return `${turn} to move · Move ${Number.isSafeInteger(move) && move > 0 ? move : 1}`;
}

function dateLabel(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently saved' : new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}),
  }).format(date);
}

export function PositionHistory({ onResume }: PositionHistoryProps) {
  const { entries, warning } = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistorySnapshot);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | SavedPosition['kind']>('all');
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const history = useRef<HTMLDetailsElement>(null);
  const searchId = useId();
  const filterId = useId();
  const renameId = useId();
  const query = search.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) => (kind === 'all' || entry.kind === kind)
    && (!query || `${entry.name} ${entry.kind} ${entry.fen}`.toLocaleLowerCase().includes(query)));

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    if (!renaming || !name.trim()) return;
    renamePosition(renaming, name.trim());
    setRenaming(undefined);
  };

  return <details className="position-history" ref={history} onToggle={(event) => {
    if (!event.currentTarget.open) { setConfirmClear(false); setRenaming(undefined); }
  }}>
    <summary>
      <span className="history-summary-title"><Clock3 size={17} aria-hidden="true" /> Recent positions
        <span className="history-count" aria-label={`${entries.length} saved positions`}>{entries.length}</span>
      </span>
      <span className="history-summary-tail"><span>{warning ? 'Storage notice' : 'Saved in this browser'}</span><ChevronDown size={17} aria-hidden="true" /></span>
    </summary>
    <div className="history-content">
      {warning && <p className="history-warning" role="status">{warning}</p>}
      <p className="history-description">Pick up a saved game or revisit a position. History stays in this browser.</p>
      {entries.length > 0 ? <>
        <div className="history-toolbar">
          <label className="history-search" htmlFor={searchId}>
            <Search size={16} aria-hidden="true" />
            <span className="history-sr-only">Search saved positions</span>
            <input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a game or position…" />
          </label>
          <label className="history-filter" htmlFor={filterId}>
            <span className="history-sr-only">Filter saved positions</span>
            <select id={filterId} aria-label="Filter saved positions" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              <option value="all">All positions</option><option value="game">Games</option><option value="analysis">Analysis</option>
            </select>
          </label>
          <button type="button" className="history-clear" onClick={() => setConfirmClear(!confirmClear)} aria-expanded={confirmClear}>
            <Trash2 size={15} aria-hidden="true" /> Clear history
          </button>
        </div>
        {confirmClear && <div className="history-clear-confirm" role="group" aria-label="Confirm clearing saved positions">
          <p>Delete all {entries.length} saved {entries.length === 1 ? 'position' : 'positions'} from this browser? This cannot be undone.</p>
          <button type="button" className="history-delete-confirm" onClick={() => {
            clearPositionHistory(); setConfirmClear(false); setRenaming(undefined); setSearch('');
          }}>Delete all {entries.length} saved {entries.length === 1 ? 'position' : 'positions'}</button>
          <button type="button" onClick={() => setConfirmClear(false)}>Cancel</button>
        </div>}
        <div className="history-entries" aria-label="Saved positions">
          {visible.map((entry) => <article className="history-entry" key={entry.id} data-history-id={entry.id}>
            <PositionThumbnail entry={entry} />
            <div className="history-entry-info">
              <div className="history-entry-heading"><h3 title={entry.name}>{entry.name}</h3><span className="history-kind">{entry.kind === 'game' ? 'Game' : 'Analysis'}</span></div>
              <p>{positionDescription(entry)}</p>
              <time dateTime={new Date(entry.updatedAt).toISOString()}>Saved {dateLabel(entry.updatedAt)}</time>
            </div>
            {renaming === entry.id ? <form className="history-rename-form" onSubmit={saveName}>
              <label htmlFor={renameId}>Position name</label>
              <input id={renameId} autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
              <div><button type="submit" disabled={!name.trim()}>Save name</button>
                <button type="button" aria-label="Cancel rename" onClick={() => setRenaming(undefined)}><X size={16} aria-hidden="true" /> Cancel</button></div>
            </form> : <div className="history-entry-actions">
              <button type="button" className="history-resume" aria-label={`Resume ${entry.name}`} onClick={() => {
                onResume(entry); if (history.current) history.current.open = false;
              }}>
                <ArrowUpRight size={16} aria-hidden="true" /> Resume
              </button>
              <button type="button" className="history-icon-button" aria-label={`Rename ${entry.name}`} title="Rename" onClick={() => { setRenaming(entry.id); setName(entry.name); }}><Pencil size={15} aria-hidden="true" /></button>
              <button type="button" className="history-icon-button" aria-label={`Delete ${entry.name}`} title="Delete" onClick={() => removePosition(entry.id)}><Trash2 size={15} aria-hidden="true" /></button>
            </div>}
          </article>)}
        </div>
        {visible.length === 0 && <p className="history-empty">No saved positions match. Try a different search or filter.</p>}
      </> : <div className="history-empty"><Clock3 size={24} aria-hidden="true" /><p>No saved positions yet.</p><span>Positions you analyze and games you play appear here. Use “Save current position” to keep a named snapshot.</span></div>}
    </div>
  </details>;
}
