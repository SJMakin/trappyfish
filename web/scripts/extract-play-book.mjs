import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
const source = 'https://github.com/official-stockfish/books/blob/a804a97e709f40aa75a00f9d19e84915b7a3a45c/2moves_v2.pgn.zip';
const text = await readFile('benchmarks/review/play-data/2moves_v2.pgn', 'utf8');
const games = text.split(/(?=\[Event )/).filter((game) => game.startsWith('[Event '));
const positions = [23, 431, 1023, 2047, 4095, 8191].map((index) => {
  const pgn = games[index];
  if (!pgn) throw new Error(`Missing fixed book index ${index}`);
  const board = new Chess(); board.loadPgn(pgn);
  return { index, pgn: board.pgn(), fen: board.fen() };
});
await writeFile('benchmarks/review/play-data/opening-starts.json', JSON.stringify({ source,
  license: 'CC0-1.0', commit: 'a804a97e709f40aa75a00f9d19e84915b7a3a45c',
  archiveSha256: createHash('sha256').update(await readFile('benchmarks/review/play-data/2moves_v2.pgn.zip')).digest('hex'),
  gameCount: games.length, selection: 'Zero-based fixed indices declared before engine evaluation.', positions }, null, 2) + '\n');
