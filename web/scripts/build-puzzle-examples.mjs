import { readFile, writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
const root = new URL('../src/openings/', import.meta.url);
const rows = JSON.parse(await readFile(new URL('puzzleSourceRows.json', root), 'utf8'));
const examples = rows.map((row) => {
  const [initialMove, ...solution] = row.Moves.split(' ');
  const board = new Chess(row.FEN);
  board.move(initialMove);
  const solverFen = board.fen();
  const san = [];
  for (const move of solution) san.push(board.move(move).san);
  return { id: row.PuzzleId, source: `https://lichess.org/training/${row.PuzzleId}`, gameUrl: row.GameUrl,
    preMistakeFen: row.FEN, initialMove, solverFen, solution, san,
    motifs: row.Themes.split(' '), selectedMotif: row.selectedMotif, rating: Number(row.Rating),
    verification: 'All database moves replay legally; motif labels supplied by Lichess. Not an independent engine proof.' };
});
await writeFile(new URL('puzzleExamples.json', root), `${JSON.stringify(examples, null, 2)}\n`);
console.log(`Validated ${examples.length} legal puzzle solutions.`);
