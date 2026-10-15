import { Chess, type Color, type Move, type Square } from 'chess.js';
import type { AnalysisLine, UciClient } from '../src/engine/uci';

export type TrapMethod = 'median' | 'best' | 'last';

export type TrappySettings = {
  rootDepth: number;
  trapDepth: number;
  candidateCount: number;
  replyCount: number;
  aggression: number;
  maxRiskCp: number;
  bonusCapCp: number;
  minProfitCp: number;
  minDropCp: number;
  method: TrapMethod;
};

export type TrapVectorPoint = {
  depth: number;
  scoreCp: number;
};

export type TrapInfo = {
  reply: string;
  replySan: string;
  vector: TrapVectorPoint[];
  shallowScoreCp: number;
  finalScoreCp: number;
  opponentBestScoreCp: number;
  trappiness: number;
  profitCp: number;
  qualityCp: number;
};

export type CandidateInfo = {
  move: string;
  san: string;
  rootScoreCp: number;
  adjustedScoreCp: number;
  riskCp: number;
  bonusCp: number;
  trap?: TrapInfo;
};

export type MoveDecision = {
  move: string;
  san: string;
  mode: 'standard' | 'trappy';
  rootBestMove: string;
  rootBestSan: string;
  rootBestScoreCp: number;
  candidates: CandidateInfo[];
  selected: CandidateInfo;
};

export const DEFAULT_TRAPPY_SETTINGS: TrappySettings = {
  rootDepth: 7,
  trapDepth: 7,
  candidateCount: 6,
  replyCount: 6,
  aggression: 1.45,
  maxRiskCp: 170,
  bonusCapCp: 240,
  minProfitCp: 25,
  minDropCp: 35,
  method: 'median',
};

export class TrappyEngine {
  constructor(private readonly uci: UciClient) {}

  async chooseMove(fen: string, settings: TrappySettings, trappyEnabled: boolean): Promise<MoveDecision> {
    const rootBoard = new Chess(fen);
    const legalRootMoves = rootBoard.moves({ verbose: true });
    if (!legalRootMoves.length) {
      throw new Error('No legal moves available.');
    }

    const rootPv = boundedPv(rootSearchWidth(settings), legalRootMoves.length);
    const root = await this.uci.analyzeFen(fen, settings.rootDepth, rootPv);
    const rootCandidates = await collectRootCandidates(this.uci, fen, root, rootBoard, legalRootMoves, settings);
    const rootBest = rootCandidates[0] ?? moveToCandidate(legalRootMoves[0], 0);
    const rootBestScore = rootBest.rootScoreCp;

    if (!trappyEnabled) {
      return buildDecision('standard', rootCandidates, rootBest, rootBest);
    }

    const evaluated: CandidateInfo[] = [];

    for (const candidate of rootCandidates) {
      const candidateBoard = new Chess(fen);
      const played = playUci(candidateBoard, candidate.move);
      if (!played) continue;

      const legalReplies = candidateBoard.moves({ verbose: true });
      if (!legalReplies.length || candidateBoard.isGameOver()) {
        evaluated.push({ ...candidate, adjustedScoreCp: candidate.rootScoreCp, riskCp: Math.max(0, rootBestScore - candidate.rootScoreCp), bonusCp: 0 });
        continue;
      }

      const replyPv = boundedPv(settings.replyCount, legalReplies.length);
      const replyAnalysis = await this.uci.analyzeFen(candidateBoard.fen(), settings.trapDepth, replyPv);
      const trap = await findBestTrap(this.uci, candidateBoard, replyAnalysis.linesByDepth, settings);
      const riskCp = Math.max(0, rootBestScore - candidate.rootScoreCp);
      const canTakeRisk = candidate.move === rootBest.move || riskCp <= effectiveMaxRisk(settings);
      const bonusCp = trap && canTakeRisk ? Math.min(effectiveBonusCap(settings), trap.qualityCp * settings.aggression) : 0;

      evaluated.push({
        ...candidate,
        riskCp,
        bonusCp,
        adjustedScoreCp: candidate.rootScoreCp + bonusCp,
        trap,
      });
    }

    const candidates = evaluated.length ? evaluated : rootCandidates;
    const selected = [...candidates].sort((a, b) => b.adjustedScoreCp - a.adjustedScoreCp)[0];
    return buildDecision(selected.trap ? 'trappy' : 'standard', candidates, rootBest, selected);
  }
}

async function collectRootCandidates(
  uci: UciClient,
  fen: string,
  root: { bestMove: string; lines: AnalysisLine[]; linesByDepth: Map<number, AnalysisLine[]> },
  board: Chess,
  legalMoves: Move[],
  settings: TrappySettings,
): Promise<CandidateInfo[]> {
  const legalByUci = new Map(legalMoves.map((move) => [moveToUci(move), move]));
  const finalScores = new Map(root.lines.map((line) => [line.firstMove, line.score.cp]));
  const candidateMoves = rankRootCandidateMoves(root, board, legalMoves, settings);
  const candidates: CandidateInfo[] = [];

  for (const move of candidateMoves) {
    const legal = legalByUci.get(move);
    if (!legal) continue;

    const rootScoreCp = finalScores.get(move) ?? (await forcedRootScore(uci, fen, move, settings.rootDepth));
    candidates.push({
      move,
      san: legal.san,
      rootScoreCp,
      adjustedScoreCp: rootScoreCp,
      riskCp: 0,
      bonusCp: 0,
    });
  }

  return candidates.sort((a, b) => b.rootScoreCp - a.rootScoreCp);
}

function rankRootCandidateMoves(
  root: { bestMove: string; lines: AnalysisLine[]; linesByDepth: Map<number, AnalysisLine[]> },
  board: Chess,
  legalMoves: Move[],
  settings: TrappySettings,
): string[] {
  const legal = new Set(legalMoves.map(moveToUci));
  const scores = new Map<string, number>();
  const add = (move: string, score: number) => {
    if (!legal.has(move)) return;
    scores.set(move, Math.max(scores.get(move) ?? -Infinity, score));
  };

  if (root.bestMove) add(root.bestMove, Infinity);
  for (const line of root.lines) add(line.firstMove, line.score.cp + 8_000);

  for (const [depth, lines] of root.linesByDepth.entries()) {
    const shallowWeight = Math.max(0, settings.rootDepth - depth);
    for (const line of lines) add(line.firstMove, line.score.cp + shallowWeight * 12);
  }

  for (const move of legalMoves) {
    const uci = moveToUci(move);
    if (move.isCapture()) add(uci, 2_000 + pieceValue(move.captured));
    if (move.isPromotion()) add(uci, 2_500 + pieceValue(move.promotion));
    if ((move.piece === 'n' || move.piece === 'b') && isHomeRank(move)) add(uci, 1_800);

    const copy = new Chess(board.fen());
    playUci(copy, uci);
    if (copy.isCheck()) add(uci, 2_200);
  }

  const budget = rootCandidateBudget(settings, legalMoves.length);
  if (settings.aggression >= 2) {
    for (const move of legalMoves) {
      const uci = moveToUci(move);
      add(uci, -quietMovePenalty(move));
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, budget)
    .map(([move]) => move);
}

async function forcedRootScore(uci: UciClient, fen: string, move: string, depth: number): Promise<number> {
  const forced = await uci.analyzeFen(fen, depth, 1, [move]);
  const maxDepth = Math.max(...forced.linesByDepth.keys());
  const line = forced.linesByDepth.get(maxDepth)?.[0] ?? forced.lines[0];
  return line?.score.cp ?? -Infinity;
}

async function findBestTrap(
  uci: UciClient,
  boardAfterCandidate: Chess,
  linesByDepth: Map<number, AnalysisLine[]>,
  settings: TrappySettings,
): Promise<TrapInfo | undefined> {
  const maxDepth = Math.max(...linesByDepth.keys());
  if (!Number.isFinite(maxDepth) || maxDepth < 3) return undefined;

  const finalLines = linesByDepth.get(maxDepth) ?? [];
  if (!finalLines.length) return undefined;

  const opponentBestScoreCp = Math.max(...finalLines.map((line) => line.score.cp));
  const replies = plausibleTrapReplies(boardAfterCandidate, linesByDepth, maxDepth, settings);
  const traps: TrapInfo[] = [];

  for (const reply of replies) {
    const vector = await forcedReplyVector(uci, boardAfterCandidate.fen(), reply, maxDepth);
    if (vector.length < 2) continue;

    const finalScoreCp = vector[vector.length - 1].scoreCp;
    const shallowScoreCp = aggregateShallow(vector.slice(0, -1), settings.method);
    const dropCp = shallowScoreCp - finalScoreCp;
    const profitCp = opponentBestScoreCp - finalScoreCp;

    if (shallowScoreCp < opponentBestScoreCp - effectiveAppealSlack(settings)) continue;
    if (dropCp < effectiveMinDrop(settings) || profitCp < effectiveMinProfit(settings)) continue;

    const trappiness = calculateTrappiness(shallowScoreCp, finalScoreCp);
    const qualityCp = profitCp * trappiness * replyTemptationFactor(boardAfterCandidate, reply, settings);
    if (qualityCp <= 0) continue;

    const replySan = sanForUci(boardAfterCandidate, reply);
    traps.push({
      reply,
      replySan,
      vector,
      shallowScoreCp,
      finalScoreCp,
      opponentBestScoreCp,
      trappiness,
      profitCp,
      qualityCp,
    });
  }

  return traps.sort((a, b) => b.qualityCp - a.qualityCp)[0];
}

function plausibleTrapReplies(board: Chess, linesByDepth: Map<number, AnalysisLine[]>, maxDepth: number, settings: TrappySettings): string[] {
  const scores = new Map<string, number>();

  for (const [depth, lines] of linesByDepth.entries()) {
    if (depth < 2 || depth >= maxDepth) continue;
    for (const line of lines) {
      scores.set(line.firstMove, Math.max(scores.get(line.firstMove) ?? -Infinity, line.score.cp));
    }
  }

  if (!scores.size) {
    for (const line of linesByDepth.get(maxDepth) ?? []) {
      scores.set(line.firstMove, line.score.cp);
    }
  }

  for (const move of board.moves({ verbose: true })) {
    const uci = moveToUci(move);
    if (move.isCapture()) scores.set(uci, Math.max(scores.get(uci) ?? -Infinity, 5_000 + pieceValue(move.captured)));
    if (move.isPromotion()) scores.set(uci, Math.max(scores.get(uci) ?? -Infinity, 5_500));

    const copy = new Chess(board.fen());
    playUci(copy, uci);
    if (copy.isCheck()) scores.set(uci, Math.max(scores.get(uci) ?? -Infinity, 5_200));
    if (settings.aggression >= 2.4) scores.set(uci, Math.max(scores.get(uci) ?? -Infinity, -quietMovePenalty(move)));
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, settings.replyCount)
    .map(([move]) => move);
}

async function forcedReplyVector(uci: UciClient, fen: string, reply: string, maxDepth: number): Promise<TrapVectorPoint[]> {
  const forced = await uci.analyzeFen(fen, maxDepth, 1, [reply]);
  const scores = new Map<number, number>();

  for (const [depth, lines] of forced.linesByDepth.entries()) {
    const line = lines.find((candidate) => candidate.firstMove === reply) ?? lines[0];
    if (line) scores.set(depth, line.score.cp);
  }

  return fillVector(scores, maxDepth);
}

function effectiveMaxRisk(settings: TrappySettings): number {
  return settings.maxRiskCp * Math.max(0.5, settings.aggression);
}

function effectiveBonusCap(settings: TrappySettings): number {
  return settings.bonusCapCp * Math.max(1, settings.aggression);
}

function effectiveMinDrop(settings: TrappySettings): number {
  return settings.minDropCp / Math.max(0.5, settings.aggression);
}

function effectiveMinProfit(settings: TrappySettings): number {
  return settings.minProfitCp / Math.max(0.5, settings.aggression);
}

function effectiveAppealSlack(settings: TrappySettings): number {
  return 70 * Math.max(0.75, settings.aggression);
}

function rootSearchWidth(settings: TrappySettings): number {
  return Math.ceil(settings.candidateCount * 1.5);
}

function rootCandidateBudget(settings: TrappySettings, legalMoveCount: number): number {
  const aggressiveBudget = Math.ceil(settings.candidateCount * (1 + settings.aggression * 0.35));
  return Math.min(legalMoveCount, Math.max(settings.candidateCount, Math.min(14, aggressiveBudget)));
}

function pieceValue(piece?: string): number {
  switch (piece) {
    case 'p':
      return 100;
    case 'n':
    case 'b':
      return 320;
    case 'r':
      return 500;
    case 'q':
      return 900;
    default:
      return 0;
  }
}

function isHomeRank(move: Move): boolean {
  return (move.color === 'w' && move.from[1] === '1') || (move.color === 'b' && move.from[1] === '8');
}

function replyTemptationFactor(board: Chess, reply: string, settings: TrappySettings): number {
  const copy = new Chess(board.fen());
  const move = playUci(copy, reply);
  if (!move) return 0;

  let factor = 0.25;
  if (move.isCapture()) factor += 0.45 + pieceValue(move.captured) / 2_000;
  if (move.isPromotion()) factor += 0.45;
  if (copy.isCheck()) factor += 0.25;
  if ((move.piece === 'n' || move.piece === 'b') && isHomeRank(move)) factor += 0.12;
  if (move.piece === 'p' && move.to[0] >= 'c' && move.to[0] <= 'f') factor += 0.1;

  factor += Math.max(0, settings.aggression - 2) * 0.12;
  return Math.min(1, factor);
}

function quietMovePenalty(move: Move): number {
  const fromFile = move.from.charCodeAt(0) - 97;
  const toFile = move.to.charCodeAt(0) - 97;
  const toRank = Number(move.to[1]);
  const centerDistance = Math.abs(toFile - 3.5) + Math.abs(toRank - 4.5);
  const edgePenalty = fromFile === 0 || fromFile === 7 ? 120 : 0;
  return centerDistance * 20 + edgePenalty;
}

function calculateTrappiness(shallowScoreCp: number, finalScoreCp: number): number {
  if (shallowScoreCp <= finalScoreCp) return 0;

  const span = Math.max(75, Math.abs(finalScoreCp));
  const delta = shallowScoreCp - finalScoreCp;

  if (delta < span) return 0.75 * (delta / span);
  if (delta < 4 * span) return 0.75 + 0.25 * ((delta - span) / (3 * span));
  return 1;
}

function aggregateShallow(points: TrapVectorPoint[], method: TrapMethod): number {
  const scores = points.map((point) => point.scoreCp);
  if (!scores.length) return 0;

  if (method === 'best') return Math.max(...scores);
  if (method === 'last') return scores[scores.length - 1];

  const sorted = [...scores].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function fillVector(scores: Map<number, number>, maxDepth: number): TrapVectorPoint[] {
  const vector: TrapVectorPoint[] = [];

  for (let depth = 2; depth <= maxDepth; depth++) {
    const exact = scores.get(depth);
    const scoreCp = exact ?? nextDeeperScore(scores, depth, maxDepth);
    if (scoreCp === undefined) return [];
    vector.push({ depth, scoreCp });
  }

  return vector;
}

function nextDeeperScore(scores: Map<number, number>, depth: number, maxDepth: number): number | undefined {
  for (let deeper = depth + 1; deeper <= maxDepth; deeper++) {
    const score = scores.get(deeper);
    if (score !== undefined) return score;
  }
  return undefined;
}

function uniqueRootCandidates(lines: AnalysisLine[], bestMove: string, board: Chess, limit: number): CandidateInfo[] {
  const candidates: CandidateInfo[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (seen.has(line.firstMove)) continue;
    const san = sanForUci(board, line.firstMove);
    candidates.push({
      move: line.firstMove,
      san,
      rootScoreCp: line.score.cp,
      adjustedScoreCp: line.score.cp,
      riskCp: 0,
      bonusCp: 0,
    });
    seen.add(line.firstMove);
  }

  if (bestMove && !seen.has(bestMove)) {
    candidates.unshift({
      move: bestMove,
      san: sanForUci(board, bestMove),
      rootScoreCp: candidates[0]?.rootScoreCp ?? 0,
      adjustedScoreCp: candidates[0]?.rootScoreCp ?? 0,
      riskCp: 0,
      bonusCp: 0,
    });
  }

  return candidates.slice(0, limit);
}

function moveToCandidate(move: Move, scoreCp: number): CandidateInfo {
  return {
    move: moveToUci(move),
    san: move.san,
    rootScoreCp: scoreCp,
    adjustedScoreCp: scoreCp,
    riskCp: 0,
    bonusCp: 0,
  };
}

function buildDecision(mode: MoveDecision['mode'], candidates: CandidateInfo[], rootBest: CandidateInfo, selected: CandidateInfo): MoveDecision {
  return {
    move: selected.move,
    san: selected.san,
    mode,
    rootBestMove: rootBest.move,
    rootBestSan: rootBest.san,
    rootBestScoreCp: rootBest.rootScoreCp,
    candidates: [...candidates].sort((a, b) => b.adjustedScoreCp - a.adjustedScoreCp),
    selected,
  };
}

function sanForUci(board: Chess, uci: string): string {
  const copy = new Chess(board.fen());
  const move = playUci(copy, uci);
  return move?.san ?? uci;
}

export function playUci(board: Chess, uci: string): Move | null {
  try {
    return board.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
  } catch {
    return null;
  }
}

export function moveToUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

export function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

function boundedPv(requested: number, legalMoveCount: number): number {
  return Math.max(1, Math.min(requested, legalMoveCount));
}

export function squarePairFromUci(uci: string): [Square, Square] | null {
  if (uci.length < 4) return null;
  return [uci.slice(0, 2) as Square, uci.slice(2, 4) as Square];
}
