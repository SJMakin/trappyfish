import { Chess, type PieceSymbol } from 'chess.js';
import { legalLine } from '../engine/analysisLines';
import { scorePlayingStyle, styleBonusCp } from '../engine/playingStyle';
import { expectedScoreToCp, playUci, type CandidateInfo, type MoveDecision, type ReplyInfo, type TrappySettings } from '../engine/trappy';
import type { DecisionTrace } from './decisionTraces';

export function traceBaitLine(trace: DecisionTrace): string[] | undefined {
  const selected = trace.decision.selected; const trap = selected.trap;
  if (!trap) return;
  // TrapInfo.punishment already includes the own continuation and second reply.
  // Adding them again would manufacture an illegal doubled branch.
  return [selected.move, trap.reply, ...trap.punishment];
}
/** A label is emitted only for a visible property of the legal stored continuation. */
export function verifiedMotif(fen: string, moves: string[]): string {
  const line = legalLine(fen, moves);
  if (!line.complete || !moves.length) return 'Analyzed tactic';
  const board = new Chess(fen); const mover = board.turn(); const values: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  let fork = false; let captured: PieceSymbol | undefined;
  for (let index = 0; index < moves.length; index++) {
    const move = playUci(board, moves[index]); if (!move) return 'Analyzed tactic';
    if (index === 1) captured = move.captured;
    if (move.color === mover) {
      const targets = board.board().flat().filter((piece) => piece && piece.color !== mover && values[piece.type] >= 3
        && board.attackers(piece.square, mover).includes(move.to));
      if (targets.length >= 2) fork = true;
    }
    if (board.isCheckmate()) return move.color !== mover ? 'Analyzed tactic' : captured === 'q'
      ? 'Queen lure leading to mate' : captured ? 'Poisoned capture in a mating line' : 'Mating continuation';
  }
  if (fork) return 'Fork in the searched line';
  // A capture alone does not establish a poisoned piece; leave other lines generic.
  return captured === 'q' ? 'Queen capture in the searched line' : 'Analyzed tactic';
}

export type StoredRanking = { candidate: CandidateInfo; score: number; eligible: boolean };
/** Forced reply searches can uncover a stronger defense than the initial unrestricted PV. */
export function strongestRecordedDefense(replies: ReplyInfo[]): ReplyInfo | undefined {
  return replies.reduce<ReplyInfo | undefined>((best, reply) => !best || reply.scoreCp < best.scoreCp
    || reply.scoreCp === best.scoreCp && reply.bestDefense && !best.bestDefense ? reply : best, undefined);
}
/** Display derivation only: retain every recorded value while marking the minimum scored defense. */
export function decisionForReview(decision: MoveDecision): MoveDecision {
  const repliesForReview = (replies: ReplyInfo[]): ReplyInfo[] => {
    const defense = strongestRecordedDefense(replies);
    return replies.map(reply => ({ ...reply, bestDefense: reply.move === defense?.move,
      continuation: reply.continuation ? { ...reply.continuation,
        bestDefenseMove: strongestRecordedDefense(reply.continuation.replies)?.move,
        replies: repliesForReview(reply.continuation.replies) } : undefined }));
  };
  const candidateForReview = (candidate: CandidateInfo): CandidateInfo => ({ ...candidate,
    bestDefenseMove: strongestRecordedDefense(candidate.replies)?.move ?? candidate.bestDefenseMove,
    replies: repliesForReview(candidate.replies) });
  const candidates = decision.candidates.map(candidateForReview);
  return { ...decision, candidates, selected: candidates.find(candidate => candidate.move === decision.move) ?? candidateForReview(decision.selected) };
}
/** Reweight only the retained candidates and recorded defense lines; no search or new replies are inferred. */
export function rerankStoredCandidates(trace: DecisionTrace, settings: TrappySettings): StoredRanking[] {
  const limit = trace.decision.rootBestScoreCp >= 500 ? Math.min(settings.maxRiskCp, settings.winningRiskCp ?? 40) : settings.maxRiskCp;
  const hasWinningMate = trace.decision.candidates.some((candidate) => candidate.rootScoreCp >= 90_000);
  return trace.decision.candidates.map((candidate) => {
    const defense = strongestRecordedDefense(candidate.replies);
    const pv = defense ? [defense.move, ...defense.punishment] : candidate.pv?.slice(1) ?? [];
    const style = scorePlayingStyle(trace.rootFen, candidate.move, pv, settings);
    style.sharpnessBonusCp = 60 * (settings.sharpness ?? 0) * (candidate.style?.sharpness ?? 0);
    style.drawAversionPenaltyCp = 60 * (settings.drawAversion ?? 0) * (candidate.style?.drawProbability ?? 0);
    const modeled = trace.decision.policySource === 'maia' && candidate.analyzed !== false && candidate.replies.length > 0;
    const base = modeled ? expectedScoreToCp(candidate.objectiveScore + settings.trappiness * (candidate.expectedScore - candidate.objectiveScore)) : candidate.rootScoreCp;
    const score = Math.abs(candidate.rootScoreCp) >= 90_000 ? candidate.rootScoreCp : base + styleBonusCp(style);
    return { candidate, score, eligible: candidate.riskCp <= limit && (!hasWinningMate || candidate.rootScoreCp >= 90_000) };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.candidate.move.localeCompare(b.candidate.move));
}
