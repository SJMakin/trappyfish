import { PolyglotBook, MAX_POLYGLOT_BYTES, validatePolyglotSize } from './polyglot';

export type LocalBookMetadata = { id: string; name: string; byteLength: number; entryCount: number; positionCount: number;
  activeEntryCount: number; addedAt: number; persistence: 'device' | 'session' };
export type LocalBookSnapshot = { books: LocalBookMetadata[]; warning?: string };
export type LocalBookBackend = {
  list: () => Promise<LocalBookMetadata[]>; read: (id: string) => Promise<ArrayBuffer | undefined>;
  put: (metadata: LocalBookMetadata, buffer: ArrayBuffer) => Promise<void>; remove: (id: string) => Promise<void>;
};
const storageWarning = 'This book is available for this tab only because browser storage is unavailable or full. Reimport it after returning.';
const cleanName = (name: string) => name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'Opening book.bin';
async function bookId(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function validMetadata(value: LocalBookMetadata): boolean {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value.id) && typeof value.name === 'string' && value.name.length <= 120
    && Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && value.byteLength <= MAX_POLYGLOT_BYTES
    && value.byteLength % 16 === 0 && value.entryCount === value.byteLength / 16
    && Number.isSafeInteger(value.positionCount) && value.positionCount > 0 && value.positionCount <= value.entryCount
    && Number.isSafeInteger(value.activeEntryCount) && value.activeEntryCount >= 0 && value.activeEntryCount <= value.entryCount
    && Number.isFinite(value.addedAt));
}
export function createLocalBookStore(backend?: LocalBookBackend, maxBytes = MAX_POLYGLOT_BYTES) {
  const metadata = new Map<string, LocalBookMetadata>();
  const sessionBuffers = new Map<string, ArrayBuffer>();
  let current: { id: string; book: PolyglotBook } | undefined;
  let initialized = false; let warning: string | undefined; let queue = Promise.resolve();
  let revision = 0; const listeners = new Set<() => void>();
  const notify = () => { revision++; listeners.forEach(listener => listener()); };
  const initialize = async () => {
    if (initialized) return;
    initialized = true;
    try { for (const item of await backend?.list() ?? []) if (validMetadata(item)) metadata.set(item.id, { ...item, persistence: 'device' }); }
    catch { warning = 'Saved opening books could not be read. You can reimport a book for this tab.'; }
  };
  const run = <T,>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(async () => { await initialize(); return action(); });
    queue = result.then(() => {}, () => {}); return result;
  };
  const snapshot = (): LocalBookSnapshot => ({ books: [...metadata.values()].map(item => ({ ...item })).sort((a, b) => b.addedAt - a.addedAt), warning });
  return {
    list: () => run(async () => snapshot()),
    import: (file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }, retain = true) => run(async () => {
      validatePolyglotSize(file.size);
      const buffer = await file.arrayBuffer(); validatePolyglotSize(buffer.byteLength);
      if (buffer.byteLength !== file.size) throw new Error('The file changed while it was being read. Please choose it again.');
      const book = PolyglotBook.fromBuffer(buffer);
      if (!book.activeEntryCount) throw new Error('This book contains no active moves. Choose a Polyglot book with positive move weights.');
      const id = await bookId(buffer);
      const bytes = [...metadata.values()].filter(item => item.id !== id).reduce((sum, item) => sum + item.byteLength, 0) + buffer.byteLength;
      if (bytes > maxBytes) throw new Error(`Local books are limited to ${Math.round(maxBytes / 1024 / 1024)} MiB in total. Remove a book before importing another.`);
      const record: LocalBookMetadata = { id, name: cleanName(file.name), byteLength: buffer.byteLength,
        entryCount: book.entryCount, positionCount: book.positionCount, activeEntryCount: book.activeEntryCount,
        addedAt: metadata.get(id)?.addedAt ?? Date.now(), persistence: retain ? 'device' : 'session' };
      // An existing durable copy stays durable when the same bytes are selected again.
      const existing = metadata.get(id);
      if (existing?.persistence === 'device' && !retain) record.persistence = 'device';
      if (record.persistence === 'device') {
        try { if (!backend) throw new Error('No IndexedDB'); await backend.put(record, buffer); sessionBuffers.delete(id); }
        catch {
          if (existing?.persistence === 'device') { Object.assign(record, existing); }
          else { record.persistence = 'session'; sessionBuffers.set(id, buffer); warning = storageWarning; }
        }
      } else sessionBuffers.set(id, buffer);
      metadata.set(id, record); current = { id, book }; notify(); return { ...record };
    }),
    read: (id: string) => run(async (): Promise<PolyglotBook | undefined> => {
      if (current?.id === id) return current.book;
      if (!metadata.has(id)) return;
      const buffer = sessionBuffers.get(id) ?? await backend?.read(id);
      if (!buffer) return;
      if (await bookId(buffer) !== id) throw new Error('The saved book does not match its original fingerprint. Remove it and reimport the original file.');
      // Persisted binary data is validated again before it can nominate any moves.
      const book = PolyglotBook.fromBuffer(buffer); current = { id, book }; return book;
    }),
    remove: (id: string) => run(async () => {
      if (metadata.get(id)?.persistence === 'device') {
        if (!backend) throw new Error('The saved book could not be removed.');
        await backend.remove(id);
      }
      metadata.delete(id); sessionBuffers.delete(id); if (current?.id === id) current = undefined;
      if (![...metadata.values()].some(item => item.persistence === 'session')) warning = undefined;
      notify();
    }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    revision: () => revision,
  };
}

function browserBackend(): LocalBookBackend | undefined {
  try { if (typeof indexedDB === 'undefined') return; } catch { return; }
  let database: Promise<IDBDatabase> | undefined;
  const open = () => database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('trappy.opening-books.v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('metadata', { keyPath: 'id' }); request.result.createObjectStore('books'); };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Opening book storage is blocked.'));
  });
  const read = async <T,>(storeName: string, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise((resolve, reject) => { const request = action(db.transaction(storeName, 'readonly').objectStore(storeName));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  };
  const mutate = async (action: (transaction: IDBTransaction) => void) => {
    const db = await open();
    return new Promise<void>((resolve, reject) => { const transaction = db.transaction(['metadata', 'books'], 'readwrite');
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
      action(transaction); });
  };
  return { list: () => read('metadata', store => store.getAll()), read: id => read('books', store => store.get(id)),
    put: (record, buffer) => mutate(transaction => { transaction.objectStore('metadata').put(record); transaction.objectStore('books').put(buffer, record.id); }),
    remove: id => mutate(transaction => { transaction.objectStore('metadata').delete(id); transaction.objectStore('books').delete(id); }) };
}
const store = createLocalBookStore(browserBackend());
export const readLocalBooks = store.list;
export const importLocalBook = store.import;
export const loadLocalBook = store.read;
export const removeLocalBook = store.remove;
export const subscribeLocalBooks = store.subscribe;
export const getLocalBookRevision = store.revision;
