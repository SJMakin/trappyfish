import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FileUp, BookOpen, Trash2 } from 'lucide-react';
import { getLocalBookRevision, importLocalBook, readLocalBooks, removeLocalBook, subscribeLocalBooks,
  type LocalBookMetadata, type LocalBookSnapshot } from '../openings/localBooks';
import { POLYGLOT_LICENSE_URL } from '../openings/polyglot';
import polyglotNotice from '../openings/source/python-chess-NOTICE.txt?raw';

export function LocalBookLibrary({ onChoose, onChange }: {
  onChoose: (book: LocalBookMetadata) => void; onChange?: (books: LocalBookMetadata[]) => void;
}) {
  const revision = useSyncExternalStore(subscribeLocalBooks, getLocalBookRevision, getLocalBookRevision);
  const [snapshot, setSnapshot] = useState<LocalBookSnapshot>({ books: [] });
  const [retain, setRetain] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => {
    let current = true;
    void readLocalBooks().then(result => { if (current) { setSnapshot(result); onChangeRef.current?.(result.books); } });
    return () => { current = false; };
  }, [revision]);
  const importFile = async (file?: File) => {
    if (!file) return;
    setError(''); setNotice('');
    if (!file.name.toLowerCase().endsWith('.bin')) { setError('Choose an unzipped Polyglot .bin file.'); return; }
    setBusy(true);
    try {
      const book = await importLocalBook(file, retain);
      setNotice(`${book.name} is ready. Choose “Use for new game” to apply it.`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async (book: LocalBookMetadata) => {
    setError('');
    try { await removeLocalBook(book.id); setNotice(`${book.name} removed. Saved game moves and reviews remain available.`); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  return <details className="local-book-library">
    <summary><BookOpen size={16} aria-hidden="true" /><span>Opening book files</span><small>{snapshot.books.length} local</small></summary>
    <div className="local-book-body">
      <p>Import a Polyglot <strong>.bin</strong> book such as Daring or a gambit repertoire. Files stay in this browser and are never uploaded.</p>
      <input ref={input} type="file" accept=".bin,application/octet-stream" aria-label="Import Polyglot opening book" hidden disabled={busy} onChange={event => void importFile(event.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()}><FileUp size={15} aria-hidden="true" />{busy ? 'Reading and checking book…' : 'Import .bin book'}</button>
      <label className="local-book-retain"><input type="checkbox" checked={retain} disabled={busy} onChange={event => setRetain(event.target.checked)} />Keep new imports on this device</label>
      <p className="local-book-note">Unzip downloaded books first. Up to 128 MiB total. Book weights identify active moves; your playing preferences and variety choose among moves that pass the risk checks. Importing never changes those controls.</p>
      {error ? <p className="import-warning" role="alert">{error}</p> : null}
      {snapshot.warning ? <p className="import-warning" role="status">{snapshot.warning}</p> : null}
      {notice ? <p className="import-notice" role="status">{notice}</p> : null}
      <ul className="local-book-list">{snapshot.books.map(book => <li key={book.id}>
        <div><strong>{book.name}</strong><small>{(book.byteLength / 1024 / 1024).toFixed(2)} MiB · {book.positionCount.toLocaleString()} positions · {book.persistence === 'device' ? 'Saved on device' : 'This tab only'}</small></div>
        <div className="local-book-actions"><button type="button" disabled={busy} onClick={() => onChoose(book)}>Use for new game</button><button type="button" disabled={busy} aria-label={`Remove book ${book.name}`} onClick={() => void remove(book)}><Trash2 size={14} aria-hidden="true" /></button></div>
      </li>)}</ul>
      <details className="local-book-sources"><summary>Find books & reader attribution</summary>
        <p><a href="https://github.com/ChrisWhittington/polyglot-books" target="_blank" rel="noreferrer">Daring, UHO-Pohl and other Polyglot books</a> · <a href="https://github.com/PhelRin/AggroChess" target="_blank" rel="noreferrer">AggroChess gambit book</a>. Books remain their authors’ work; they are imported locally rather than bundled here.</p>
        <pre>{polyglotNotice}</pre><a href={POLYGLOT_LICENSE_URL} target="_blank" rel="noreferrer">Polyglot reader GPL license</a>
      </details>
    </div>
  </details>;
}
