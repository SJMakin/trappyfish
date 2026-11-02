import { expectedScoreToCp, type CandidateInfo, type MoveDecision, type TrappySettings } from './trappy';
import { styleBonusCp } from './playingStyle';

/** Display-only derivations. These never alter a move score or invent unsearched branches. */
export function summarizeAnalysisTree(candidates: CandidateInfo[]) {
  let firstReplies = 0;
  let continuations = 0;
  let secondReplies = 0;
  for (const candidate of candidates) {
    firstReplies += candidate.replies.length;
    for (const reply of candidate.replies) {
      if (reply.continuation) continuations++;
      secondReplies += reply.continuation?.replies.length ?? 0;
    }
  }
  return {
    candidates: candidates.length,
    evaluated: candidates.filter((candidate) => candidate.analyzed === true).length,
    outsideRisk: candidates.filter((candidate) => candidate.status === 'outside-risk').length,
    firstReplies, continuations, secondReplies,
  };
}

export function deriveScoreLedger(decision: MoveDecision, candidate: CandidateInfo, settings?: TrappySettings) {
  const modeled = candidate.analyzed !== false && candidate.replies.length > 0 && candidate.policyCoverage > 0;
  const forcedOutcome = Math.abs(candidate.rootScoreCp) >= 90_000;
  const attackBonus = candidate.style?.aggressionBonusCp ?? 0;
  const tensionBonus = candidate.style?.tensionBonusCp ?? 0;
  const pawnStormBonus = candidate.style?.pawnStormBonusCp ?? 0;
  const kingCautionPenalty = candidate.style?.kingCautionPenaltyCp ?? 0;
  const sacrificeBonus = candidate.style?.sacrificeBonusCp ?? 0;
  const queenRetentionBonus = candidate.style?.queenRetentionBonusCp ?? 0;
  const sharpnessBonus = candidate.style?.sharpnessBonusCp ?? 0;
  const drawAversionPenalty = candidate.style?.drawAversionPenaltyCp ?? 0;
  const totalStyleBonus = forcedOutcome ? 0 : styleBonusCp(candidate.style);
  // A failed Maia pass may retry with trappiness = 0 while keeping style preferences.
  const weight = decision.policySource === 'stockfish' ? 0 : settings?.trappiness;
  const omittedMass = modeled ? Math.max(0, 1 - candidate.policyCoverage) : undefined;
  const omittedContribution = omittedMass === undefined ? undefined : omittedMass * candidate.objectiveScore;
  const searchedContribution = modeled
    ? candidate.replies.reduce((sum, reply) => sum + reply.probability * reply.expectedScore, 0) : undefined;
  const blendedUtility = modeled && weight !== undefined
    ? candidate.objectiveScore + weight * (candidate.expectedScore - candidate.objectiveScore) : undefined;
  const reconstructedRanking = forcedOutcome ? candidate.rootScoreCp
    : modeled && blendedUtility !== undefined ? expectedScoreToCp(blendedUtility) + totalStyleBonus
    : !modeled ? candidate.rootScoreCp + totalStyleBonus : undefined;
  const refinements = candidate.replies.filter((reply) => reply.continuation && reply.continuation.replies.length > 0)
    .map((reply) => ({
      reply: reply.san,
      continuation: reply.continuation!.san,
      replies: reply.continuation!.replies.length,
      parentMass: reply.probability,
      conditionalCoverage: reply.continuation!.policyCoverage,
      jointCoverage: reply.probability * reply.continuation!.policyCoverage,
      omittedJointMass: reply.probability * Math.max(0, 1 - reply.continuation!.policyCoverage),
    }));
  return {
    modeled, forcedOutcome, weight, attackBonus, tensionBonus,
    pawnStormBonus, kingCautionPenalty, sacrificeBonus, queenRetentionBonus, sharpnessBonus, drawAversionPenalty, totalStyleBonus,
    omittedMass, omittedContribution, searchedContribution, blendedUtility,
    baseRanking: candidate.adjustedScoreCp - totalStyleBonus,
    reconstructedRanking, refinements,
    // The engine treats two positive mate encodings as zero risk; sentinel distance
    // is not an objective centipawn loss. Keep its recorded risk authoritative.
    objectiveGapCp: candidate.riskCp,
  };
}
