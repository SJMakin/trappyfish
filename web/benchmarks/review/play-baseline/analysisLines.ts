import { Chess, type Color, type PieceSymbol } from 'chess.js';
import { playUci, type CandidateInfo, type ReplyInfo } from './trappy';

export type ResearchLine = {
  id: string; label: string; kind: 'trap' | 'defense' | 'objective' | 'reply'; moves: string[];
  probability?: number; conditionalProbability?: number; scoreCp: number; reply?: ReplyInfo;
};
export type LegalLine = { moves: string[]; sans: string[]; fens: string[]; labels: string[]; complete: boolean };
export function legalLine(fen: string, moves: string[]): LegalLine {
  const board = new Chess(fen);
  const result: LegalLine = { moves: [], sans: [], fens: [board.fen()], labels: [], complete: true };
  for (const uci of moves) {
    const number = board.fen().split(' ')[5];
    const turn = board.turn();
    const move = playUci(board, uci);
    if (!move) { result.complete = false; break; }
    result.moves.push(uci); result.sans.push(move.san); result.fens.push(board.fen());
    result.labels.push(`${number}${turn === 'w' ? '.' : '…'} ${move.san}`);
  }
  return result;
}
export function candidateLines(candidate: CandidateInfo): ResearchLine[] {
  const info = candidate as CandidateInfo & { pv?: string[]; bestDefenseMove?: string };
  const replies = candidate.replies;
  const defense = replies.find((row) => (row as ReplyInfo & { bestDefense?: boolean }).bestDefense)
    ?? replies.find((row) => row.move === info.bestDefenseMove)
    ?? [...replies].sort((a, b) => a.scoreCp - b.scoreCp)[0];
  const result: ResearchLine[] = [];
  for (const reply of replies) {
    if (reply !== defense && reply.probability >= 0.005 && (reply.lossCp >= 80 || reply.scoreCp >= 90_000)) result.push({
      id: `${candidate.move}/${reply.move}`, label: `If ${reply.san}`, kind: 'trap',
      moves: [candidate.move, reply.move, ...reply.punishment], probability: reply.probability,
      scoreCp: reply.scoreCp, reply,
    });
    if (reply.continuation) for (const next of reply.continuation.replies) {
      if ((next.lossCp < 80 && next.scoreCp < 90_000) || reply.probability * next.probability < 0.005) continue;
      result.push({ id: `${candidate.move}/${reply.move}/${next.move}`,
        label: `If ${reply.san}, then ${next.san}`, kind: 'trap',
        moves: [candidate.move, reply.move, reply.continuation.move, next.move, ...next.punishment],
        probability: reply.probability * next.probability, conditionalProbability: next.probability,
        scoreCp: next.scoreCp, reply,
      });
    }
  }
  result.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0) || b.scoreCp - a.scoreCp);
  if (defense) {
    const nextDefense = defense.continuation?.replies.find((reply) => reply.bestDefense);
    const defenseMoves = nextDefense && nextDefense.scoreCp <= defense.scoreCp
      ? [candidate.move, defense.move, defense.continuation!.move, nextDefense.move, ...nextDefense.punishment]
      : [candidate.move, defense.move, ...defense.punishment];
    result.push({ id: `${candidate.move}/defense`, label: `Best defense: ${defense.san}`, kind: 'defense',
      moves: defenseMoves, probability: defense.probability, scoreCp: defense.scoreCp, reply: defense });
  }
  else result.push({ id: `${candidate.move}/objective`, label: 'Stockfish continuation', kind: 'objective',
    moves: info.pv?.length ? info.pv : [candidate.move], scoreCp: candidate.rootScoreCp });
  return result;
}

export function lineTarget(fen: string, moves: string[]): { text: string; squares: string[] } {
  const board = new Chess(fen); const root = board.turn();
  const captures: string[] = []; const squares: string[] = [];
  for (const uci of moves) {
    const move = playUci(board, uci); if (!move) break;
    if (move.color === root && move.captured && captures.length < 3) {
      const capturedSquare = move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to;
      captures.push(`${pieceName(move.captured)} on ${capturedSquare}`); squares.push(capturedSquare);
    }
    if (board.isCheckmate()) {
      const king = board.board().flat().find((piece) => piece?.type === 'k' && piece.color === board.turn());
      return { text: move.color === root ? 'Finish with checkmate.' : 'This line ends in your checkmate.', squares: king ? [king.square] : [] };
    }
  }
  if (captures.length) return { text: `Targets the ${captures.join(', then the ')}.`, squares };
  return { text: 'Builds pressure; inspect the continuation and compare the best defense.', squares };
}
export function candidateIdea(fen: string, candidate: CandidateInfo): string {
  const traps = candidateLines(candidate).filter((line) => line.kind === 'trap');
  if (traps.length) {
    const description = lineTarget(fen, traps[0].moves).text;
    return `${traps[0].label}: ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
  }
  const board = new Chess(fen); const root = board.turn();
  const previousPins = new Set(absolutePins(board, root).map((pin) => `${pin.piece}|${pin.square}`));
  const move = playUci(board, candidate.move);
  if (!move) return 'Inspect the Stockfish continuation.';
  if (board.isCheckmate()) return 'Delivers checkmate immediately.';
  const pin = absolutePins(board, root).find((pin) => !previousPins.has(`${pin.piece}|${pin.square}`));
  if (pin) return `Pins the ${pieceName(pin.piece)} on ${pin.square} to its king.`;
  if (move.captured) return `Captures the ${pieceName(move.captured)} on ${move.to}.`;
  if (board.isCheck()) return 'Forces the opponent to answer a check.';
  return 'A sound continuation; compare human replies and the strongest defense.';
}
function absolutePins(board: Chess, attacker: Color): { piece: PieceSymbol; square: string }[] {
  const result: { piece: PieceSymbol; square: string }[] = [];
  for (const row of board.board()) for (const piece of row) {
    if (!piece || piece.color !== attacker || !['b', 'r', 'q'].includes(piece.type)) continue;
    const directions = piece.type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
      : piece.type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [df, dr] of directions) {
      let f = piece.square.charCodeAt(0) - 97 + df; let r = Number(piece.square[1]) - 1 + dr;
      let target: { piece: PieceSymbol; square: string } | null = null;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const square = `${String.fromCharCode(f + 97)}${r + 1}` as Parameters<Chess['get']>[0];
        const hit = board.get(square);
        if (hit) {
          if (hit.color === attacker) break;
          if (hit.type === 'k') { if (target) result.push(target); break; }
          if (target) break;
          target = { piece: hit.type, square };
        }
        f += df; r += dr;
      }
    }
  }
  return result;
}
export function pieceName(piece: string): string { return ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as Record<string, string>)[piece.toLowerCase()] ?? 'piece'; }
export function formatCp(cp: number): string {
  if (Math.abs(cp) >= 90_000) return cp > 0 ? 'Forced mate' : 'Losing to mate';
  return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
}
export function percent(value: number): string { return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`; }

export type LineTarget = { square: string; piece: string; color: Color; type: 'capture' | 'mate' | 'promotion' | 'bait' };
export type VariationStep = {
  uci: string; san: string; fen: string; moveNumber: number; color: Color;
  role: 'candidate' | 'reply' | 'setup' | 'follow-up' | 'punishment' | 'defense';
  from: string; to: string; captured?: string;
};
export type VariationLine = ResearchLine & {
  san: string[]; steps: VariationStep[]; targets: LineTarget[]; description: string; complete: boolean;
};

/** These snapshots are also used by the workspace's line player via legalLine. */
export function deriveCandidateLines(fen: string, candidate: CandidateInfo): VariationLine[] {
  const root = new Chess(fen).turn();
  return candidateLines(candidate).map((research) => {
    const replay = legalLine(fen, research.moves);
    const board = new Chess(fen);
    const steps: VariationStep[] = [];
    const targets: LineTarget[] = [];
    for (let index = 0; index < replay.moves.length; index++) {
      const moveNumber = Number(board.fen().split(' ')[5]);
      const move = playUci(board, replay.moves[index])!;
      const role = index === 0 ? 'candidate' : index === 1 ? research.kind === 'defense' ? 'defense' : 'reply'
        : index === 2 && research.conditionalProbability !== undefined ? 'setup'
        : index === 3 && research.conditionalProbability !== undefined ? 'follow-up' : 'punishment';
      steps.push({ uci: replay.moves[index], san: move.san, fen: board.fen(), moveNumber,
        color: move.color, role, from: move.from, to: move.to, captured: move.captured });
      if (move.captured) {
        const capturedSquare = move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to;
        targets.push({ square: capturedSquare, piece: move.captured, color: move.color === 'w' ? 'b' : 'w',
          type: move.color === root ? 'capture' : 'bait' });
      }
      if (move.promotion && move.color === root) targets.push({ square: move.to, piece: move.promotion, color: root, type: 'promotion' });
      if (board.isCheckmate()) {
        const king = board.board().flat().find((piece) => piece?.type === 'k' && piece.color === board.turn());
        if (king) targets.push({ square: king.square, piece: 'k', color: king.color, type: 'mate' });
      }
    }
    const unique = [...new Map(targets.map((target) => [`${target.type}|${target.color}|${target.piece}|${target.square}`, target])).values()];
    return { ...research, moves: replay.moves, san: replay.sans, steps, targets: unique,
      description: lineTarget(fen, replay.moves).text, complete: replay.complete };
  }).filter((line) => line.moves.length > 0);
}

export function formatVariationSan(line: VariationLine): string {
  return line.steps.map((step, index) => `${step.color === 'w' ? `${step.moveNumber}. `
    : index === 0 || line.steps[index - 1].color !== 'w' ? `${step.moveNumber}... ` : ''}${step.san}`).join(' ');
}

export function variationToPgn(fen: string, moves: string[]): string {
  const board = new Chess(fen);
  board.setHeader('Event', 'Trappyfish position analysis');
  board.setHeader('SetUp', '1');
  board.setHeader('FEN', board.fen());
  for (const uci of moves) {
    if (!playUci(board, uci)) throw new Error(`Cannot export an illegal continuation: ${uci}`);
  }
  board.setHeader('Result', board.isCheckmate() ? board.turn() === 'w' ? '0-1' : '1-0' : board.isDraw() ? '1/2-1/2' : '*');
  return board.pgn();
}
