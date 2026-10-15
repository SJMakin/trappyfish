import { Chess } from 'chess.js';

export type TrapFixture = {
  id: string;
  name: string;
  setup: string[];
  fen: string;
  candidate?: string;
  temptingReply?: string;
  continuation?: string[];
  caution?: string;
  source?: string;
};

function fixture(value: Omit<TrapFixture, 'fen'> & { fen?: string }): TrapFixture {
  const board = new Chess(value.fen);
  for (const san of value.setup) board.move(san);
  const fen = board.fen();
  if (value.candidate) board.move(value.candidate);
  if (value.temptingReply) board.move(value.temptingReply);
  for (const san of value.continuation ?? []) board.move(san);
  return { ...value, fen };
}

export const TRAP_POSITIONS: TrapFixture[] = [
  fixture({ id: 'legal-sound', name: 'Légal after h3 / Bh5', setup: ['e4','e5','Nf3','Nc6','Bc4','d6','Nc3','Bg4','h3','Bh5'], candidate: 'Nxe5', temptingReply: 'Bxd1', continuation: ['Bxf7+','Ke7','Nd5#'], source: 'https://www.thechesswebsite.com/legal/' }),
  fixture({ id: 'legal-premature', name: 'Premature Légal sacrifice', setup: ['e4','e5','Nf3','Nc6','Bc4','d6','Nc3','Bg4'], candidate: 'Nxe5', temptingReply: 'Bxd1', continuation: ['Bxf7+','Ke7','Nd5#'], caution: 'Bxd1 loses to mate, but Nxe5 can instead win a knight for Black; reject excessive objective risk.', source: 'https://www.chessworld.net/legals-mate.asp' }),
  fixture({ id: 'blackburne', name: 'Blackburne Shilling bait', setup: ['e4','e5','Nf3','Nc6','Bc4'], candidate: 'Nd4', temptingReply: 'Nxe5', continuation: ['Qg5','Nxf7','Qxg2','Rf1','Qxe4+','Be2','Nf3#'], caution: 'Famous bait is objectively dubious; selecting a normal developing move can be correct.', source: 'https://www.chess.com/openings/Italian-Game-Blackburne-Shilling-Gambit-4.Nxe5-Qg5' }),
  fixture({ id: 'fishing-pole', name: 'Fishing Pole hook', setup: ['e4','e5','Nf3','Nc6','Bb5','Nf6','O-O','Ng4','h3'], candidate: 'h5', temptingReply: 'hxg4', continuation: ['hxg4','Ne1','Qh4'], caution: 'One tempting capture is not a forced win; the model should weigh alternative human replies.', source: 'https://www.thechesswebsite.com/fishingpoletrap/' }),
  fixture({ id: 'englund', name: 'Englund queen fork', setup: ['d4','e5','dxe5','Nc6','Nf3','Qe7','Bf4'], candidate: 'Qb4+', temptingReply: 'Bd2', continuation: ['Qxb2','Bc3','Bb4','Qd2','Bxc3','Qxc3','Qc1#'], caution: 'Requires several later mistakes; the initial Bd2 reply is a correct defense, and a one-reply model should not count the full trap as certain.', source: 'https://www.chess.com/openings/Englund-Gambit' }),
  fixture({ id: 'elephant', name: 'Elephant Trap recapture', setup: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Nbd7','cxd5'], candidate: 'exd5', temptingReply: 'Nxd5', continuation: ['Nxd5','Bxd8','Bb4+','Qd2','Bxd2+','Kxd2','Kxd8'], source: 'https://www.thechesswebsite.com/elephant-trap/' }),
  fixture({ id: 'mate-in-one', name: 'Immediate mate control', setup: ['f3','e5','g4'], candidate: 'Qh4#', caution: 'Certain checkmate must remain preferred over speculative traps.' }),
  fixture({ id: 'start', name: 'Starting-position control', setup: [], caution: 'Legal move and hard risk budget control; no expected SAN.' }),
];
