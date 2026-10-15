import { Chess, type Color, type Move, type Square } from 'chess.js';
import type { AnalysisResult } from '../src/engine/uci';

export type PolicyMove = { move: string; probability: number };
export interface OpponentPolicyProvider {
  predict(fen: string, opponentRating: number, engineRating: number): Promise<PolicyMove[]>;
  terminate?(): void;
}
export interface AnalysisEngine {
  analyzeFen(fen: string, depth: number, multipv?: number, searchMoves?: string[]): Promise<AnalysisResult>;
  cancel?(): void;
  terminate?(): void;
}
export type TrappySettings = {
  rootDepth: number; trapDepth: number; candidateCount: number; replyCount: number;
  aggression: number; maxRiskCp: number; opponentRating: number; engineRating: number; replyCoverage: number;
};
export type ReplyInfo = {
  move: string; san: string; probability: number; scoreCp: number; expectedScore: number;
  lossCp: number; punishment: string[];
};
export type TrapInfo = {
  reply: string; replySan: string; probability: number; profitCp: number; scoreCp: number; punishment: string[];
};
export type CandidateInfo = {
  move: string; san: string; rootScoreCp: number; adjustedScoreCp: number; riskCp: number; bonusCp: number;
  expectedScoreCp: number; expectedScore: number; objectiveScore: number; policyCoverage: number;
  replies: ReplyInfo[]; trap?: TrapInfo;
};
export type MoveDecision = {
  move: string; san: string; mode: 'standard' | 'trappy'; rootBestMove: string; rootBestSan: string;
  rootBestScoreCp: number; candidates: CandidateInfo[]; selected: CandidateInfo;
  policySource: 'maia' | 'stockfish'; warning?: string;
};
export const DEFAULT_TRAPPY_SETTINGS: TrappySettings = {
  rootDepth: 10, trapDepth: 10, candidateCount: 10, replyCount: 10, aggression: 1,
  maxRiskCp: 100, opponentRating: 1500, engineRating: 2000, replyCoverage: 0.95,
};

// Bounded game-score utility prevents a low-probability mate from overwhelming normal outcomes.
// This is an evaluation transform, not a calibrated prediction of a player's win rate.
export function cpToExpectedScore(cp: number): number {
  if (cp >= 90_000) return 1;
  if (cp <= -90_000) return 0;
  return 1 / (1 + Math.exp(-cp / 200));
}
export function expectedScoreToCp(score: number): number {
  const bounded = Math.max(1e-6, Math.min(1 - 1e-6, score));
  return 200 * Math.log(bounded / (1 - bounded));
}

/** One opponent chance ply, then engine-optimal continuations evaluated by Stockfish. */
export class PracticalEngine {
  private generation = 0;
  constructor(private readonly uci: AnalysisEngine, private readonly policy: OpponentPolicyProvider) {}
  cancel(): void { this.generation++; this.uci.cancel?.(); }
  terminate(): void { this.cancel(); this.uci.terminate?.(); this.policy.terminate?.(); }

  async chooseMove(fen: string, settings: TrappySettings, trappyEnabled: boolean): Promise<MoveDecision> {
    validateSettings(settings);
    const generation = this.generation;
    const check = () => { if (generation !== this.generation) throw new Error('Engine search cancelled.'); };
    const board = new Chess(fen);
    if (board.isGameOver()) throw new Error('This position is already finished.');
    const legal = board.moves({ verbose: true });
    const legalByUci = new Map(legal.map((move) => [moveToUci(move), move]));
    const root = await this.uci.analyzeFen(fen, settings.rootDepth, Math.min(legal.length, settings.candidateCount));
    check();
    const rootCandidates = root.lines.filter((line) => legalByUci.has(line.firstMove))
      .map((line) => candidate(legalByUci.get(line.firstMove)!, line.score.cp));
    if (!rootCandidates.length) throw new Error('Stockfish returned no scored legal candidates.');
    rootCandidates.sort((a, b) => b.rootScoreCp - a.rootScoreCp);
    let best = rootCandidates[0];
    if (!trappyEnabled || settings.aggression === 0 || best.rootScoreCp >= 90_000) {
      return decision(rootCandidates, best, best, 'stockfish');
    }

    try {
      // Root discovery includes forcing moves even if humans rarely find them.
      // Maia weights the opponent's choices; our engine can execute tactical moves.
      const ownPolicy = await this.policy.predict(fen, settings.engineRating, settings.opponentRating);
      check();
      const additions = new Set(normalizePolicy(ownPolicy, legalByUci).slice(0, 4).map((reply) => reply.move));
      for (const move of legal) {
        const copy = new Chess(fen);
        copy.move(move);
        if (move.isCapture() || move.isPromotion() || copy.isCheck()) additions.add(moveToUci(move));
      }
      const missing = [...additions].filter((move) => !rootCandidates.some((entry) => entry.move === move));
      if (missing.length) {
        const forced = await this.uci.analyzeFen(fen, settings.rootDepth, missing.length, missing);
        check();
        for (const move of missing) {
          const line = forced.lines.find((entry) => entry.firstMove === move);
          if (!line) throw new Error(`Stockfish did not score candidate ${move}.`);
          rootCandidates.push(candidate(legalByUci.get(move)!, line.score.cp));
        }
      }
      rootCandidates.sort((a, b) => b.rootScoreCp - a.rootScoreCp);
      best = rootCandidates[0];
      if (best.rootScoreCp >= 90_000) return decision(rootCandidates, best, best, 'stockfish');
      let evaluated = rootCandidates.map((entry) => ({ ...entry }));
      const searched = new Set<string>();
      // All risk comparisons must use the same conservative objective baseline.
      // If defense verification lowers that baseline, evaluate newly eligible moves too.
      for (let pass = 0; pass < rootCandidates.length; pass++) {
        const bestCp = Math.max(...evaluated.map((entry) => entry.rootScoreCp));
        const pending = evaluated.filter((entry) => !searched.has(entry.move)
          && bestCp - entry.rootScoreCp <= settings.maxRiskCp);
        if (!pending.length) break;
        for (const entry of pending) {
          check();
          const replacement = await this.evaluateCandidate(board, entry,
            Math.max(0, bestCp - entry.rootScoreCp), settings, check);
          evaluated = evaluated.map((row) => row.move === entry.move ? replacement : row);
          searched.add(entry.move);
        }
      }
      best = [...evaluated].sort((a, b) => b.rootScoreCp - a.rootScoreCp)[0];
      evaluated = evaluated.map((entry) => ({ ...entry, riskCp: Math.max(0, best.rootScoreCp - entry.rootScoreCp) }));
      const eligible = evaluated.filter((entry) => entry.riskCp <= settings.maxRiskCp);
      eligible.sort((a, b) => utility(b, settings) - utility(a, settings)
        || b.rootScoreCp - a.rootScoreCp || a.move.localeCompare(b.move));
      return decision(evaluated, best, eligible[0] ?? best, 'maia');
    } catch (error) {
      check();
      // Genuine model failures are visible and return objective Stockfish, never invented probabilities.
      const warning = `Maia analysis unavailable; played Stockfish. ${error instanceof Error ? error.message : String(error)}`;
      return decision(rootCandidates, best, best, 'stockfish', warning);
    }
  }

  async evaluateCandidate(board: Chess, entry: CandidateInfo, riskCp: number, settings: TrappySettings,
    check: () => void = () => {}): Promise<CandidateInfo> {
    const after = new Chess(board.fen());
    if (!playUci(after, entry.move)) throw new Error('Illegal candidate.');
    if (after.isGameOver()) {
      const scoreCp = after.isCheckmate() ? 100_000 : 0;
      const expectedScore = after.isCheckmate() ? 1 : 0.5;
      return { ...entry, riskCp, rootScoreCp: scoreCp, objectiveScore: expectedScore, expectedScore,
        expectedScoreCp: scoreCp, adjustedScoreCp: scoreCp, policyCoverage: 1 };
    }
    const legal = new Map(after.moves({ verbose: true }).map((move) => [moveToUci(move), move]));
    const policy = normalizePolicy(await this.policy.predict(after.fen(), settings.opponentRating, settings.engineRating), legal);
    check();
    const selected: PolicyMove[] = [];
    let coverage = 0;
    for (const reply of policy) {
      if (selected.length >= settings.replyCount || coverage >= settings.replyCoverage) break;
      selected.push(reply);
      coverage += reply.probability;
    }
    // Include the engine's strongest defense even when its human probability is small.
    const defense = await this.uci.analyzeFen(after.fen(), Math.max(1, settings.trapDepth - 1), 1);
    check();
    if (!defense.lines.length) throw new Error('Stockfish returned no scored defense.');
    const bestDefense = defense.lines[0];
    const defenseProbability = policy.find((reply) => reply.move === bestDefense.firstMove)?.probability ?? 0;
    if (!selected.some((reply) => reply.move === bestDefense.firstMove) && legal.has(bestDefense.firstMove)) {
      selected.push({ move: bestDefense.firstMove, probability: defenseProbability });
      coverage += defenseProbability;
    }
    const referenceCp = entry.rootScoreCp + riskCp;
    let baselineCp = Math.min(entry.rootScoreCp, -bestDefense.score.cp);
    // A deeper defense can reveal a worse position than the root pass did.
    // Keep the original best-root reference and tighten risk, rather than weakening the limit.
    riskCp = Math.max(riskCp, referenceCp - baselineCp);
    let objectiveScore = cpToExpectedScore(baselineCp);
    const replies: ReplyInfo[] = [];
    for (const reply of selected) {
      const replied = new Chess(after.fen());
      const played = playUci(replied, reply.move)!;
      let scoreCp: number;
      let punishment: string[] = [];
      if (replied.isGameOver()) scoreCp = replied.isCheckmate() ? -100_000 : 0;
      else {
        const result = reply.move === bestDefense.firstMove ? defense
          : await this.uci.analyzeFen(after.fen(), Math.max(1, settings.trapDepth - 1), 1, [reply.move]);
        check();
        const line = result.lines.find((line) => line.firstMove === reply.move);
        if (!line) throw new Error(`Stockfish did not score reply ${reply.move}.`);
        scoreCp = -line.score.cp; // Opponent POV -> fixed root mover POV.
        punishment = line.pv.slice(1);
      }
      replies.push({ ...reply, san: played.san, scoreCp, expectedScore: cpToExpectedScore(scoreCp),
        lossCp: Math.max(0, scoreCp - baselineCp), punishment });
    }
    // A forced branch can uncover a stronger defense than the unrestricted finite search.
    // It belongs in the safety baseline regardless of how rarely Maia predicts it.
    baselineCp = Math.min(baselineCp, ...replies.map((reply) => reply.scoreCp));
    objectiveScore = cpToExpectedScore(baselineCp);
    riskCp = Math.max(riskCp, referenceCp - baselineCp);
    for (const reply of replies) reply.lossCp = Math.max(0, reply.scoreCp - baselineCp);
    coverage = Math.min(1, coverage);
    // Keep the true probability mass; unsearched replies receive best-defense utility.
    const expectedScore = replies.reduce((sum, reply) => sum + reply.probability * reply.expectedScore,
      (1 - coverage) * objectiveScore);
    const adjusted = objectiveScore + settings.aggression * (expectedScore - objectiveScore);
    const expectedScoreCp = expectedScoreToCp(expectedScore);
    const adjustedScoreCp = expectedScoreToCp(adjusted);
    const trapReply = replies.filter((reply) => reply.lossCp >= 80 && reply.probability >= 0.005)
      .sort((a, b) => b.probability * (b.expectedScore - objectiveScore)
        - a.probability * (a.expectedScore - objectiveScore))[0];
    return { ...entry, riskCp, rootScoreCp: baselineCp, objectiveScore, expectedScore, expectedScoreCp, adjustedScoreCp,
      bonusCp: adjustedScoreCp - entry.rootScoreCp, policyCoverage: coverage, replies,
      trap: trapReply ? { reply: trapReply.move, replySan: trapReply.san, probability: trapReply.probability,
        profitCp: trapReply.lossCp, scoreCp: trapReply.scoreCp, punishment: trapReply.punishment } : undefined };
  }
}

function utility(entry: CandidateInfo, settings: TrappySettings): number {
  return entry.objectiveScore + settings.aggression * (entry.expectedScore - entry.objectiveScore);
}
function candidate(move: Move, cp: number): CandidateInfo {
  const score = cpToExpectedScore(cp);
  return { move: moveToUci(move), san: move.san, rootScoreCp: cp, adjustedScoreCp: cp, riskCp: 0,
    bonusCp: 0, expectedScoreCp: cp, expectedScore: score, objectiveScore: score, policyCoverage: 0, replies: [] };
}
function decision(candidates: CandidateInfo[], best: CandidateInfo, selected: CandidateInfo,
  policySource: MoveDecision['policySource'], warning?: string): MoveDecision {
  return { move: selected.move, san: selected.san, mode: policySource === 'maia' && selected.trap ? 'trappy' : 'standard',
    rootBestMove: best.move, rootBestSan: best.san, rootBestScoreCp: best.rootScoreCp,
    candidates: [...candidates].sort((a, b) => b.adjustedScoreCp - a.adjustedScoreCp), selected, policySource, warning };
}
export function normalizePolicy(policy: PolicyMove[], legal: Map<string, unknown>): PolicyMove[] {
  const combined = new Map<string, number>();
  for (const { move, probability } of policy) {
    if (legal.has(move) && Number.isFinite(probability) && probability > 0) {
      combined.set(move, (combined.get(move) ?? 0) + probability);
    }
  }
  const total = [...combined.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error('Maia returned no legal move probabilities.');
  return [...combined].map(([move, probability]) => ({ move, probability: probability / total }))
    .sort((a, b) => b.probability - a.probability || a.move.localeCompare(b.move));
}
function validateSettings(settings: TrappySettings): void {
  for (const field of ['rootDepth', 'trapDepth', 'candidateCount', 'replyCount'] as const) {
    if (!Number.isInteger(settings[field]) || settings[field] < 1 || settings[field] > 30) throw new Error(`Invalid ${field}.`);
  }
  if (![settings.aggression, settings.maxRiskCp, settings.opponentRating, settings.engineRating, settings.replyCoverage]
    .every(Number.isFinite) || settings.aggression < 0 || settings.aggression > 1 || settings.maxRiskCp < 0
    || settings.replyCoverage <= 0 || settings.replyCoverage > 1) throw new Error('Invalid practical engine settings.');
}
export function playUci(board: Chess, uci: string): Move | null {
  try { return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return null; }
}
export function moveToUci(move: Move): string { return `${move.from}${move.to}${move.promotion ?? ''}`; }
export function opposite(color: Color): Color { return color === 'w' ? 'b' : 'w'; }
export function squarePairFromUci(uci: string): [Square, Square] | null {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) ? [uci.slice(0, 2) as Square, uci.slice(2, 4) as Square] : null;
}
