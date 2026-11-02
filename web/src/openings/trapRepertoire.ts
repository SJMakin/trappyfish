import { Chess } from 'chess.js';

export interface TrapStudy {
  id: string;
  name: string;
  eco: string;
  setup: string[];
  bait: string;
  temptingReply: string;
  punishment: string[];
  motif: string;
  explanation: string;
  caution: string;
  source: string;
  verification: 'legal-replay-only';
  opening: { id: string; name: string; eco: string; pgn: string; uci: string[]; fen: string };
}
function study(value: Omit<TrapStudy, 'opening' | 'verification'>): TrapStudy {
  const board = new Chess();
  for (const move of [...value.setup, value.bait]) board.move(move);
  const opening = { id: value.id, name: `${value.name} · trap study`, eco: value.eco,
    pgn: board.pgn(), uci: board.history({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`), fen: board.fen() };
  board.move(value.temptingReply);
  for (const move of value.punishment) board.move(move);
  return { ...value, verification: 'legal-replay-only', opening };
}

/** Original teaching notes. Famous traps may be unsound; the playing engine must verify every book move. */
export const trapRepertoire: readonly TrapStudy[] = [
  study({ id: 'trap-legal', name: 'Légal queen lure', eco: 'C50',
    setup: ['e4','e5','Nf3','Nc6','Bc4','d6','Nc3','Bg4','h3','Bh5'], bait: 'Nxe5', temptingReply: 'Bxd1', punishment: ['Bxf7+','Ke7','Nd5#'],
    motif: 'Queen lure and mating net', explanation: 'The knight leaves the pin. Taking the queen lets the minor pieces force mate against the uncastled king.',
    caution: 'The h3 / Bh5 preparation matters. In the earlier position, Black can answer Nxe5 with Nxe5 instead of taking the queen.',
    source: 'https://www.thechesswebsite.com/legal/' }),
  study({ id: 'trap-blackburne', name: 'Blackburne Shilling', eco: 'C50',
    setup: ['e4','e5','Nf3','Nc6','Bc4'], bait: 'Nd4', temptingReply: 'Nxe5', punishment: ['Qg5','Nxf7','Qxg2','Rf1','Qxe4+','Be2','Nf3#'],
    motif: 'Poisoned pawn and mating net', explanation: 'The pawn on e5 is a distraction: the queen attacks g2 and the king, then the advanced knight can deliver mate.',
    caution: 'Nd4 is objectively dubious. White can develop or exchange calmly. A strict risk limit should often reject this book move.',
    source: 'https://www.chess.com/openings/Italian-Game-Blackburne-Shilling-Gambit-4.Nxe5-Qg5' }),
  study({ id: 'trap-fishing-pole', name: 'Fishing Pole', eco: 'C65',
    setup: ['e4','e5','Nf3','Nc6','Bb5','Nf6','O-O','Ng4','h3'], bait: 'h5', temptingReply: 'hxg4', punishment: ['hxg4','Ne1','Qh4'],
    motif: 'Knight lure and open h-file', explanation: 'Capturing the offered knight opens the h-file. After the illustrative retreat Ne1, the queen joins the attack with Qh4.',
    caution: 'This is an attacking idea, not a forced win. The knight capture and later retreat are choices; alternative defenses must be evaluated.',
    source: 'https://www.thechesswebsite.com/fishingpoletrap/' }),
  study({ id: 'trap-englund', name: 'Englund queen raid', eco: 'A40',
    setup: ['d4','e5','dxe5','Nc6','Nf3','Qe7','Bf4'], bait: 'Qb4+', temptingReply: 'Bd2', punishment: ['Qxb2','Bc3','Bb4','Qd2','Bxc3','Qxc3','Qc1#'],
    motif: 'Queen raid and back-rank mate', explanation: 'The queen check starts a forcing-looking raid. Several later inaccuracies can allow the queen to mate on c1.',
    caution: 'Bd2 is a correct defense, not a blunder. The mate requires later mistakes; the opening gambit also carries objective risk.',
    source: 'https://www.chess.com/openings/Englund-Gambit' }),
  study({ id: 'trap-elephant', name: 'Elephant Trap', eco: 'D50',
    setup: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Nbd7','cxd5'], bait: 'exd5', temptingReply: 'Nxd5', punishment: ['Nxd5','Bxd8','Bb4+','Qd2','Bxd2+','Kxd2','Kxd8'],
    motif: 'Pin illusion and queen recovery', explanation: 'The apparently pinned knight can recapture. Taking the queen permits a checking bishop move that wins White’s queen back.',
    caution: 'The line wins material only after the supplied capture sequence. White can choose a quieter continuation instead.',
    source: 'https://www.thechesswebsite.com/elephant-trap/' }),
];
export const curatedTrapOpenings = trapRepertoire.map((trap) => trap.opening);
