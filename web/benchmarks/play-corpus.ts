import { Chess } from 'chess.js';
import { TRAP_POSITIONS } from './trap-positions';
import puzzles from '../src/openings/puzzleExamples.json';
import openingStarts from './review/play-data/opening-starts.json';

export type PlayCase = {
  id: string; name: string; role: 'preparation' | 'bait' | 'punishment' | 'best-defense' | 'opening-control';
  fen: string; family?: string; expectedMove?: string; bookMove?: string; setup?: string[]; remaining?: string[];
  baitFen?: string; baitMove?: string; temptingReply?: string; punishment?: string[];
  source?: string; notes: string;
};
const boardAfter = (moves: string[]) => { const board = new Chess(); moves.forEach((move) => board.move(move)); return board; };
const uci = (board: Chess, san: string) => { const move = new Chess(board.fen()).move(san); return `${move.from}${move.to}${move.promotion ?? ''}`; };
const families = TRAP_POSITIONS.filter((fixture) => ['legal-sound', 'blackburne', 'fishing-pole', 'englund', 'elephant'].includes(fixture.id));
const preparations: PlayCase[] = families.flatMap((fixture) => [2, 4].map((plies): PlayCase => {
  const setup = fixture.setup.slice(0, -plies);
  const remaining = fixture.setup.slice(-plies);
  const board = boardAfter(setup);
  return { id: `${fixture.id}-prepare-${plies}`, name: `${fixture.name}, ${plies} plies before bait`, role: 'preparation',
    fen: board.fen(), family: fixture.id, expectedMove: uci(board, remaining[0]), bookMove: uci(board, remaining[0]),
    setup, remaining, baitFen: fixture.fen, baitMove: uci(new Chess(fixture.fen), fixture.candidate!),
    temptingReply: fixture.temptingReply, punishment: fixture.continuation, source: fixture.source,
    notes: 'Success requires the actual selected setup path, independently non-blundering supplied human moves, a safe bait and a verified punishment. A different good move is not a preparation success.' };
}));
export const PLAY_CORPUS: PlayCase[] = [
  ...TRAP_POSITIONS.map((fixture): PlayCase => ({ id: fixture.id, name: fixture.name,
    role: fixture.id === 'mate-in-one' ? 'punishment' : fixture.id === 'start' ? 'opening-control'
      : fixture.id === 'legal-premature' ? 'best-defense' : 'bait', fen: fixture.fen, family: fixture.id,
    expectedMove: fixture.candidate ? uci(new Chess(fixture.fen), fixture.candidate) : undefined,
    bookMove: families.some((family) => family.id === fixture.id) ? uci(new Chess(fixture.fen), fixture.candidate!) : undefined,
    setup: fixture.setup,
    temptingReply: fixture.temptingReply, punishment: fixture.continuation, source: fixture.source,
    notes: fixture.caution ?? 'Named move is a reference, not an obligation. Sound alternatives remain acceptable.' })),
  ...preparations,
  ...puzzles.map((puzzle): PlayCase => ({ id: `held-out-${puzzle.id}`, name: `Held-out ${puzzle.selectedMotif}`,
    role: 'punishment', fen: puzzle.solverFen, expectedMove: puzzle.solution[0], source: puzzle.source,
    notes: 'Supplied opponent mistake from the CC0 Lichess puzzle export; never counted as trap preparation. Accept independent sound alternatives.' })),
  ...openingStarts.positions.map((opening): PlayCase => ({ id: `book-control-${opening.index}`, name: `Held-out book start ${opening.index}`,
    role: 'opening-control', fen: opening.fen, source: openingStarts.source,
    notes: 'Fixed indices selected before evaluation from pinned CC0 Stockfish 2moves_v2 book. Book membership does not certify balance.' })),
];
