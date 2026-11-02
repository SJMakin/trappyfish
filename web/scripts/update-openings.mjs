import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';

// Deliberately pinned: updating the catalogue is a reviewable data change.
const revision = '712a58be746c143f4ab935b68acc50f4bac813eb';
const root = new URL('../src/openings/', import.meta.url);
await mkdir(root, { recursive: true });
const openings = [];
const sources = [];
for (const letter of 'abcde') {
  const url = `https://raw.githubusercontent.com/lichess-org/chess-openings/${revision}/${letter}.tsv`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const source = await response.text();
  sources.push({ file: `${letter}.tsv`, sha256: createHash('sha256').update(source).digest('hex') });
  const [header, ...rows] = source.trim().split(/\r?\n/);
  const columns = header.split('\t');
  for (const [index, row] of rows.entries()) {
    const fields = Object.fromEntries(row.split('\t').map((value, at) => [columns[at], value]));
    const chess = new Chess();
    chess.loadPgn(fields.pgn);
    const uci = chess.history({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`);
    openings.push({ id: `${letter}-${index + 1}`, eco: fields.eco, name: fields.name, pgn: fields.pgn, uci, fen: chess.fen() });
  }
}
const provenance = { source: 'https://github.com/lichess-org/chess-openings', revision, license: 'CC0-1.0', files: sources, count: openings.length };
await writeFile(new URL('catalogue.json', root), `${JSON.stringify(openings)}\n`);
await writeFile(new URL('provenance.json', root), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Wrote ${openings.length} validated openings at ${revision}.`);
