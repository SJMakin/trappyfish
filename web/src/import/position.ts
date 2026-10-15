import { Chess, validateFen, type Color, type Square } from 'chess.js';

/** A screenshot cannot establish castling history, en passant, or move clocks. */
export function screenshotFen(placement: string, turn: Color = 'w'): string {
  return `${placement} ${turn} - - 0 1`;
}

/** Check determines the turn; otherwise the bottom player's turn is a useful, editable default. */
export function inferScreenshotTurn(placement: string, orientation: 'white' | 'black'): { turn: Color; source: 'check' | 'orientation' } {
  try {
    const whiteInCheck = new Chess(screenshotFen(placement, 'w')).isCheck();
    const blackInCheck = new Chess(screenshotFen(placement, 'b')).isCheck();
    if (whiteInCheck !== blackInCheck) {
      const turn = whiteInCheck ? 'w' : 'b';
      if (validatePosition(screenshotFen(placement, turn)).fen) return { turn, source: 'check' };
    }
  } catch { /* Keep incomplete reads editable; validation explains any piece errors. */ }
  return { turn: orientation === 'black' ? 'b' : 'w', source: 'orientation' };
}

export function rotatePlacement(placement: string): string {
  return placement.split('/').reverse().map((rank) => [...rank].reverse().join('')).join('/');
}

/** Parse placement independently of legality so a misread king can still be corrected visually. */
export function placementForPreview(placement: string): Record<string, { pieceType: string }> | null {
  const ranks = placement.split('/');
  if (ranks.length !== 8) return null;
  const result: Record<string, { pieceType: string }> = {};
  for (const [index, rank] of ranks.entries()) {
    let file = 0;
    for (const token of rank) {
      if (/^[1-8]$/.test(token)) file += Number(token);
      else if (/^[prnbqkPRNBQK]$/.test(token)) {
        if (file >= 8) return null;
        result[`${String.fromCharCode(97 + file)}${8 - index}`] = { pieceType: `${token === token.toUpperCase() ? 'w' : 'b'}${token.toUpperCase()}` };
        file += 1;
      } else return null;
    }
    if (file !== 8) return null;
  }
  return result;
}

export function setPlacementSquare(placement: string, square: string, piece: string | null): string | null {
  const board = placementForPreview(placement);
  if (!board || !/^[a-h][1-8]$/.test(square) || (piece && !/^[wb][PRNBQK]$/.test(piece))) return null;
  if (piece) board[square] = { pieceType: piece }; else delete board[square];
  return Array.from({ length: 8 }, (_, index) => {
    let output = ''; let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const entry = board[`${String.fromCharCode(97 + file)}${8 - index}`]?.pieceType;
      if (!entry) { empty += 1; continue; }
      if (empty) { output += empty; empty = 0; }
      output += entry[0] === 'w' ? entry[1] : entry[1].toLowerCase();
    }
    return output + (empty || '');
  }).join('/');
}

export function validatePosition(input: string): { fen?: string; error?: string; suggestedTurn?: Color } {
  const fen = input.trim().replace(/\s+/g, ' ');
  const basic = validateFen(fen);
  if (!basic.ok) return { error: basic.error ?? 'Invalid FEN.' };
  const fields = fen.split(' ');
  if (!/^(?:-|K?Q?k?q?)$/.test(fields[2]) || !fields[2]) {
    return { error: 'Castling rights must be - or an ordered combination of KQkq.' };
  }
  if (!/^\d+$/.test(fields[4]) || !/^[1-9]\d*$/.test(fields[5])) {
    return { error: 'Move counters must be whole numbers; the full move number starts at 1.' };
  }
  const game = new Chess(fen);
  const pieces = game.board().flat().filter((piece) => piece !== null);
  for (const color of ['w', 'b'] as const) {
    if (pieces.filter((piece) => piece.color === color).length > 16 ||
        pieces.filter((piece) => piece.color === color && piece.type === 'p').length > 8) {
      return { error: 'The position contains too many pieces or pawns of one color.' };
    }
  }
  const previousTurn = fields[1] === 'w' ? 'b' : 'w';
  const oppositeGame = new Chess(`${fields[0]} ${previousTurn} - - ${fields[4]} ${fields[5]}`);
  if (oppositeGame.isCheck()) {
    if (game.isCheck()) return { error: 'Both kings are in check. Correct the pieces or orientation before loading.' };
    const name = previousTurn === 'w' ? 'White' : 'Black';
    return { error: `${name} is in check, so it must be ${name} to move. Change Side to move to ${name}, or correct the pieces.`, suggestedTurn: previousTurn };
  }
  const castlingSquares: Record<string, [Square, Square, Color]> = {
    K: ['e1', 'h1', 'w'], Q: ['e1', 'a1', 'w'],
    k: ['e8', 'h8', 'b'], q: ['e8', 'a8', 'b'],
  };
  for (const right of fields[2].replace('-', '')) {
    const [kingSquare, rookSquare, color] = castlingSquares[right];
    const king = game.get(kingSquare);
    const rook = game.get(rookSquare);
    if (king?.type !== 'k' || king.color !== color || rook?.type !== 'r' || rook.color !== color) {
      return { error: `Castling right ${right} requires the king and rook on their original squares.` };
    }
  }
  return { fen: game.fen({ forceEnpassantSquare: true }) };
}
