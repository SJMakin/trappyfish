import { Chess, type Color, type Move, type Square } from 'chess.js';
import type { AnalysisLine, AnalysisResult, Wdl } from './uci';
import { hasPlayingStyle, scorePlayingStyle, styleBonusCp, type StylePreferences, type StyleScore } from './playingStyle';

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
export type TrappySettings = StylePreferences & {
  rootDepth: number; trapDepth: number; candidateCount: number; replyCount: number;
  trappiness: number; maxRiskCp: number; winningRiskCp?: number;
  opponentRating: number; engineRating: number; replyCoverage: number;
  opponentPlies?: 1 | 2; continuationReplies?: number; continuationBranches?: number;
};
export type ReplyInfo = {
  move: string; san: string; probability: number; scoreCp: number; expectedScore: number;
  lossCp: number; punishment: string[];
  bestDefense?: boolean;
  wdl?: Wdl;
  continuation?: {
    move: string; san: string; scoreCp: number; expectedScore: number; policyCoverage: number; replies: ReplyInfo[];
    bestDefenseMove?: string;
  };
};
export type TrapInfo = {
  reply: string; replySan: string; probability: number; profitCp: number; scoreCp: number; punishment: string[];
  setupSan?: string; nextReply?: { reply: string; replySan: string; probability: number; scoreCp: number };
};
export type CandidateInfo = {
  move: string; san: string; rootScoreCp: number; adjustedScoreCp: number; riskCp: number; bonusCp: number;
  expectedScoreCp: number; expectedScore: number; objectiveScore: number; policyCoverage: number;
  replies: ReplyInfo[]; trap?: TrapInfo;
  mistakeProbability?: number;
  pv?: string[]; analyzed?: boolean; status?: 'evaluated' | 'outside-risk' | 'objective-only';
  bestDefenseMove?: string; rootMate?: number;
  style?: StyleScore;
  /** Unmodified root search evaluation, before stronger defenses tighten the safety baseline. */
  initialScoreCp?: number; rootDepth?: number;
  objectiveWdl?: Wdl;
  selectionProbability?: number;
};
export type SearchDiagnostics = {
  elapsedMs: number; stockfishCalls: number; policyCalls: number; policyTimeMs: number;
  /** Sum of the final reported cumulative counter for each completed Stockfish invocation. */
  nodes?: number; searchTimeMs?: number;
  maxDepth?: number; maxSelDepth?: number; latestNps?: number; hashfull?: number;
  /** Primary variation at each depth of the initial unrestricted root search, in root mover POV. */
  rootTrace?: { depth: number; move: string; scoreCp: number; nodes?: number; timeMs?: number }[];
};
export type MoveDecision = {
  move: string; san: string; mode: 'standard' | 'trappy'; rootBestMove: string; rootBestSan: string;
  rootBestScoreCp: number; candidates: CandidateInfo[]; selected: CandidateInfo;
  policySource: 'maia' | 'stockfish'; warning?: string;
  riskLimitCp?: number;
  styleApplied?: boolean;
  diagnostics?: SearchDiagnostics;
  selection?: {
    method: 'best' | 'sampled' | 'analysis'; temperatureCp: number; randomDraw?: number;
    probabilities: { move: string; probability: number }[];
  };
};
export type AnalysisProgress = {
  stage: 'root' | 'candidates' | 'replies' | 'complete'; message: string;
  completed: number; total: number; candidate?: string;
  diagnostics?: SearchDiagnostics;
};
export type PositionAnalysis = { fen: string; decision?: MoveDecision; terminal?: 'checkmate' | 'draw' };
type SearchOptions = { analysis?: boolean; onProgress?: (progress: AnalysisProgress) => void };
type SearchServices = {
  uci: AnalysisEngine; policy: OpponentPolicyProvider;
  recordRootTrace?: (root: AnalysisResult) => void;
};
export const DEFAULT_TRAPPY_SETTINGS: TrappySettings = {
  rootDepth: 12, trapDepth: 10, candidateCount: 10, replyCount: 10, trappiness: 1,
  aggression: 0, tension: 0, pawnStorm: 0, kingCaution: 0, sacrifice: 0, sharpness: 0,
  queenRetention: 0, drawAversion: 0, variety: 0, maxRiskCp: 100, winningRiskCp: 40,
  opponentRating: 1000, engineRating: 2400, replyCoverage: 0.95,
  opponentPlies: 2, continuationReplies: 4, continuationBranches: 3,
};
export const DEFAULT_ANALYSIS_SETTINGS: TrappySettings = {
  ...DEFAULT_TRAPPY_SETTINGS, rootDepth: 14, trapDepth: 12, candidateCount: 12, replyCount: 12,
  continuationBranches: 3, continuationReplies: 6,
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

/** Maia opponent chance turns around engine-optimal Stockfish continuations. */
export class TrappyEngine {
  private generation = 0;
  constructor(private readonly uci: AnalysisEngine, private readonly policy: OpponentPolicyProvider,
    private readonly random: () => number = Math.random) {}
  cancel(): void { this.generation++; this.uci.cancel?.(); }
  terminate(): void { this.cancel(); this.uci.terminate?.(); this.policy.terminate?.(); }

  async analyzePosition(fen: string, settings: TrappySettings = DEFAULT_ANALYSIS_SETTINGS,
    onProgress?: (progress: AnalysisProgress) => void): Promise<PositionAnalysis> {
    const started = performance.now();
    validateSettings(settings);
    const board = new Chess(fen);
    if (board.isGameOver()) {
      onProgress?.({ stage: 'complete', completed: 1, total: 1, message: 'This position is already finished.',
        diagnostics: { elapsedMs: performance.now() - started, stockfishCalls: 0, policyCalls: 0, policyTimeMs: 0 } });
      return { fen: board.fen(), terminal: board.isCheckmate() ? 'checkmate' : 'draw' };
    }
    const decision = await this.chooseMove(board.fen(), settings, true, { analysis: true, onProgress });
    return { fen: board.fen(), decision };
  }

  async chooseMove(fen: string, settings: TrappySettings, trappyEnabled: boolean,
    options: SearchOptions = {}): Promise<MoveDecision> {
    // Each request owns its counters and wrappers. Cancelled or concurrent searches cannot
    // overwrite the diagnostics of another request, and style fallback retains prior work.
    const started = performance.now();
    const generation = this.generation;
    const diagnostics: SearchDiagnostics = { elapsedMs: 0, stockfishCalls: 0, policyCalls: 0, policyTimeMs: 0 };
    const snapshot = (): SearchDiagnostics => ({ ...diagnostics, elapsedMs: performance.now() - started,
      rootTrace: diagnostics.rootTrace?.map((point) => ({ ...point })) });
    let currentProgress: AnalysisProgress | undefined;
    const publish = (progress?: AnalysisProgress) => {
      if (progress) currentProgress = progress;
      if (generation === this.generation && currentProgress) {
        options.onProgress?.({ ...currentProgress, diagnostics: snapshot() });
      }
    };
    const services: SearchServices = {
      uci: { analyzeFen: async (...args) => {
        diagnostics.stockfishCalls++;
        publish();
        const result = await this.uci.analyzeFen(...args);
        const lines = [...result.linesByDepth.values()].flat().concat(result.lines);
        // UCI counters are cumulative across depths and MultiPV entries, not separate work.
        const nodes = maxReported(lines.map((line) => line.nodes));
        const timeMs = maxReported(lines.map((line) => line.timeMs));
        if (nodes !== undefined) diagnostics.nodes = (diagnostics.nodes ?? 0) + nodes;
        if (timeMs !== undefined) diagnostics.searchTimeMs = (diagnostics.searchTimeMs ?? 0) + timeMs;
        diagnostics.maxDepth = maxReported([diagnostics.maxDepth, ...lines.map((line) => line.depth)]);
        diagnostics.maxSelDepth = maxReported([diagnostics.maxSelDepth, ...lines.map((line) => line.seldepth)]);
        const latest = [...lines].sort((a, b) => b.depth - a.depth || b.multipv - a.multipv);
        const nps = latest.find((line) => line.nps !== undefined)?.nps;
        const hashfull = latest.find((line) => line.hashfull !== undefined)?.hashfull;
        if (nps !== undefined) diagnostics.latestNps = nps;
        if (hashfull !== undefined) diagnostics.hashfull = hashfull;
        publish();
        return result;
      } },
      policy: { predict: async (...args) => {
        diagnostics.policyCalls++;
        publish();
        const policyStarted = performance.now();
        try { return await this.policy.predict(...args); }
        finally { diagnostics.policyTimeMs += performance.now() - policyStarted; publish(); }
      } },
      recordRootTrace: (root) => {
        if (diagnostics.rootTrace) return;
        diagnostics.rootTrace = [...root.linesByDepth].sort(([a], [b]) => a - b)
          .flatMap(([depth, lines]) => {
            const primary = lines.find((line) => line.multipv === 1);
            return primary ? [{ depth, move: primary.firstMove, scoreCp: primary.score.cp,
              nodes: primary.nodes, timeMs: primary.timeMs }] : [];
          });
      },
    };
    const result = await this.searchMove(fen, settings, trappyEnabled, {
      ...options, onProgress: options.onProgress ? publish : undefined,
    }, services);
    return { ...result, diagnostics: snapshot() };
  }

  private async searchMove(fen: string, settings: TrappySettings, trappyEnabled: boolean,
    options: SearchOptions, services: SearchServices): Promise<MoveDecision> {
    validateSettings(settings);
    const generation = this.generation;
    const check = () => { if (generation !== this.generation) throw new Error('Engine search cancelled.'); };
    const board = new Chess(fen);
    if (board.isGameOver()) throw new Error('This position is already finished.');
    const legal = board.moves({ verbose: true });
    const legalByUci = new Map(legal.map((move) => [moveToUci(move), move]));
    options.onProgress?.({ stage: 'root', completed: 0, total: 1, message: 'Finding strong candidate moves with Stockfish…' });
    const root = await services.uci.analyzeFen(fen, settings.rootDepth, Math.min(legal.length, settings.candidateCount));
    check();
    services.recordRootTrace?.(root);
    const rootCandidates = root.lines.filter((line) => legalByUci.has(line.firstMove))
      .map((line) => candidate(legalByUci.get(line.firstMove)!, line.score.cp, line.pv,
        line.score.type === 'mate' ? line.score.raw : undefined, line.depth, lineWdl(line)));
    if (!rootCandidates.length) throw new Error('Stockfish returned no scored legal candidates.');
    rootCandidates.sort((a, b) => b.rootScoreCp - a.rootScoreCp);
    let best = rootCandidates[0];
    const hasStyle = hasPlayingStyle(settings);
    if (!trappyEnabled || (!options.analysis && ((!settings.trappiness && !hasStyle && !settings.variety) || best.rootScoreCp >= 90_000))) {
      options.onProgress?.({ stage: 'complete', completed: 1, total: 1, message: 'Stockfish analysis complete.' });
      return applySelection(decision(rootCandidates, best, best, 'stockfish'), [best], 0, options.analysis, this.random);
    }

    try {
      // Root discovery includes forcing moves even if humans rarely find them.
      // Maia weights the opponent's choices; our engine can execute tactical moves.
      const ownPolicy = settings.trappiness > 0
        ? await services.policy.predict(fen, settings.engineRating, settings.opponentRating) : [];
      check();
      const additions = new Set(settings.trappiness > 0
        ? normalizePolicy(ownPolicy, legalByUci).slice(0, 4).map((reply) => reply.move) : []);
      if (hasStyle) {
        styleNominees(fen, legal, settings).forEach((move) => additions.add(move));
      }
      for (const move of legal) {
        const copy = new Chess(fen);
        copy.move(move);
        if (move.isCapture() || move.isEnPassant() || move.isPromotion() || copy.isCheck()) additions.add(moveToUci(move));
      }
      const missing = [...additions].filter((move) => !rootCandidates.some((entry) => entry.move === move));
      if (missing.length) {
        const forced = await services.uci.analyzeFen(fen, settings.rootDepth, missing.length, missing);
        check();
        for (const move of missing) {
          const line = forced.lines.find((entry) => entry.firstMove === move);
          if (!line) throw new Error(`Stockfish did not score candidate ${move}.`);
          rootCandidates.push(candidate(legalByUci.get(move)!, line.score.cp, line.pv,
            line.score.type === 'mate' ? line.score.raw : undefined, line.depth, lineWdl(line)));
        }
      }
      rootCandidates.sort((a, b) => b.rootScoreCp - a.rootScoreCp);
      best = rootCandidates[0];
      if (!options.analysis && best.rootScoreCp >= 90_000) {
        return applySelection(decision(rootCandidates, best, best, 'stockfish'), [best], 0, false, this.random);
      }
      let evaluated = rootCandidates.map((entry) => ({ ...entry }));
      const searched = new Set<string>();
      options.onProgress?.({ stage: 'candidates', completed: 0, total: evaluated.length,
        message: `Comparing ${evaluated.length} candidate moves against human replies…` });
      // All risk comparisons must use the same conservative objective baseline.
      // If defense verification lowers that baseline, evaluate newly eligible moves too.
      for (let pass = 0; pass < rootCandidates.length; pass++) {
        const bestCp = Math.max(...evaluated.map((entry) => entry.rootScoreCp));
        const pending = evaluated.filter((entry) => !searched.has(entry.move)
          && (options.analysis || bestCp - entry.rootScoreCp <= riskLimit(bestCp, settings)));
        if (!pending.length) break;
        for (const entry of pending) {
          check();
          options.onProgress?.({ stage: 'replies', completed: searched.size, total: evaluated.length,
            candidate: entry.san, message: `Checking ${entry.san}: likely replies, targets, and strongest defense…` });
          const replacement = await this.evaluateCandidate(board, entry,
            Math.max(0, bestCp - entry.rootScoreCp), settings, check, services);
          evaluated = evaluated.map((row) => row.move === entry.move ? replacement : row);
          searched.add(entry.move);
          options.onProgress?.({ stage: 'candidates', completed: searched.size, total: evaluated.length,
            candidate: entry.san, message: `${searched.size} of ${evaluated.length} moves analyzed.` });
        }
      }
      best = [...evaluated].sort((a, b) => b.rootScoreCp - a.rootScoreCp)[0];
      evaluated = evaluated.map((entry) => {
        if (options.analysis && entry.replies.length) {
          const knownDefense = entry.replies.reduce((best, reply) => reply.scoreCp < best.scoreCp ? reply : best);
          entry.bestDefenseMove = knownDefense.move;
          for (const reply of entry.replies) {
            reply.bestDefense = reply.move === knownDefense.move;
            if (reply.continuation?.replies.length) {
              const nextDefense = reply.continuation.replies.reduce((best, next) => next.scoreCp < best.scoreCp ? next : best);
              reply.continuation.bestDefenseMove = nextDefense.move;
              for (const next of reply.continuation.replies) next.bestDefense = next.move === nextDefense.move;
            }
          }
        }
        const riskCp = options.analysis && best.rootScoreCp >= 90_000 && entry.rootScoreCp >= 90_000
          ? 0 : Math.max(0, best.rootScoreCp - entry.rootScoreCp);
        return { ...entry, riskCp, status: riskCp > riskLimit(best.rootScoreCp, settings)
          ? 'outside-risk' as const : entry.analyzed ? 'evaluated' as const : 'objective-only' as const };
      });
      const eligible = evaluated.filter((entry) => entry.riskCp <= riskLimit(best.rootScoreCp, settings)
        && (best.rootScoreCp < 90_000 || entry.rootScoreCp >= 90_000));
      eligible.sort((a, b) => b.adjustedScoreCp - a.adjustedScoreCp
        || b.rootScoreCp - a.rootScoreCp || a.move.localeCompare(b.move));
      const result = applySelection(decision(evaluated, best, eligible[0] ?? best,
        settings.trappiness > 0 || (settings.sharpness ?? 0) > 0 ? 'maia' : 'stockfish'),
        eligible.filter((entry) => entry.analyzed), Math.abs(best.rootScoreCp) >= 90_000 ? 0 : 100 * (settings.variety ?? 0),
        options.analysis, this.random);
      result.riskLimitCp = riskLimit(best.rootScoreCp, settings);
      result.styleApplied = hasStyle || Boolean(settings.variety);
      if (options.analysis) result.candidates.sort((a, b) => Number(a.status === 'outside-risk') - Number(b.status === 'outside-risk')
        || b.adjustedScoreCp - a.adjustedScoreCp);
      options.onProgress?.({ stage: 'complete', completed: evaluated.length, total: evaluated.length,
        message: 'Analysis complete. Explore the traps and strongest defenses.' });
      return result;
    } catch (error) {
      check();
      // Disable only the unavailable model-derived contributions. Keep positional
      // preferences and bounded variety, and make unavailable sharpness explicit.
      if ((settings.trappiness > 0 || (settings.sharpness ?? 0) > 0)
        && (hasPlayingStyle({ ...settings, sharpness: 0 }) || settings.variety)) {
        const fallback = await this.searchMove(fen, { ...settings, trappiness: 0, sharpness: 0 }, true, options, services);
        if (settings.sharpness) {
          for (const entry of fallback.candidates) if (Math.abs(entry.rootScoreCp) < 90_000) {
            entry.style = { ...(entry.style ?? scorePlayingStyle(fen, entry.move, entry.pv?.slice(1) ?? [], {})),
              sharpnessAvailable: false, sharpness: undefined, sharpnessBonusCp: 0 };
          }
          fallback.selected = fallback.candidates.find((entry) => entry.move === fallback.move) ?? fallback.selected;
        }
        fallback.warning = `Human-reply analysis unavailable; using Stockfish and your playing style. ${error instanceof Error ? error.message : String(error)}`;
        return fallback;
      }
      // Genuine model failures are visible and return objective Stockfish, never invented probabilities.
      const warning = `${options.analysis ? 'Human-reply analysis unavailable; showing Stockfish results.'
        : 'Practical analysis unavailable; played Stockfish.'} ${error instanceof Error ? error.message : String(error)}`;
      options.onProgress?.({ stage: 'complete', completed: 1, total: 1, message: 'Stockfish results available; human-reply analysis could not finish.' });
      const fallbackCandidates = options.analysis ? rootCandidates.map((entry) => {
        const riskCp = Math.max(0, best.rootScoreCp - entry.rootScoreCp);
        return { ...entry, riskCp, analyzed: false, status: riskCp > riskLimit(best.rootScoreCp, settings)
          ? 'outside-risk' as const : 'objective-only' as const };
      }) : rootCandidates;
      if (settings.sharpness) {
        for (const entry of fallbackCandidates) if (Math.abs(entry.rootScoreCp) < 90_000) {
          entry.style = measuredStyle(scorePlayingStyle(fen, entry.move, entry.pv?.slice(1) ?? [], settings),
            settings, entry.objectiveWdl);
          // In this objective fallback no style contribution was applied.
          entry.style.sharpnessAvailable = false;
          entry.style.sharpnessBonusCp = 0;
        }
      }
      return applySelection(decision(fallbackCandidates, best, best, 'stockfish', warning), [best], 0, options.analysis, this.random);
    }
  }

  async evaluateCandidate(board: Chess, entry: CandidateInfo, riskCp: number, settings: TrappySettings,
    check: () => void = () => {}, services: SearchServices = { uci: this.uci, policy: this.policy }): Promise<CandidateInfo> {
    const after = new Chess(board.fen());
    if (!playUci(after, entry.move)) throw new Error('Illegal candidate.');
    if (after.isGameOver()) {
      const scoreCp = after.isCheckmate() ? 100_000 : 0;
      const expectedScore = after.isCheckmate() ? 1 : 0.5;
      const objectiveWdl = after.isCheckmate() ? { win: 1, draw: 0, loss: 0 } : { win: 0, draw: 1, loss: 0 };
      const style = after.isCheckmate() ? undefined : measuredStyle(
        scorePlayingStyle(board.fen(), entry.move, [], settings), settings, objectiveWdl, 0);
      return { ...entry, riskCp, rootScoreCp: scoreCp, objectiveScore: expectedScore, expectedScore,
        expectedScoreCp: scoreCp, adjustedScoreCp: scoreCp + styleBonusCp(style), objectiveWdl, style,
        bonusCp: styleBonusCp(style), policyCoverage: 1, analyzed: true, status: 'evaluated',
        rootMate: after.isCheckmate() ? 1 : undefined };
    }
    if (settings.trappiness === 0 && !settings.sharpness) {
      const defense = await services.uci.analyzeFen(after.fen(), Math.max(1, settings.trapDepth - 1), 1);
      check();
      const line = defense.lines[0];
      if (!line) throw new Error('Stockfish returned no scored defense.');
      const baselineCp = Math.min(entry.rootScoreCp, -line.score.cp);
      const objectiveWdl = conservativeWdl(entry.rootScoreCp, entry.objectiveWdl, -line.score.cp, reverseWdl(lineWdl(line)));
      const style = Math.abs(baselineCp) >= 90_000 ? undefined
        : measuredStyle(scorePlayingStyle(board.fen(), entry.move, line.pv, settings), settings, objectiveWdl);
      const adjustedScoreCp = baselineCp + styleBonusCp(style);
      return { ...entry, rootScoreCp: baselineCp, objectiveScore: cpToExpectedScore(baselineCp),
        expectedScore: cpToExpectedScore(baselineCp), expectedScoreCp: baselineCp, adjustedScoreCp,
        riskCp: Math.max(riskCp, entry.rootScoreCp + riskCp - baselineCp), bonusCp: adjustedScoreCp - entry.rootScoreCp,
        analyzed: true, status: 'evaluated', policyCoverage: 0, replies: [], style,
        pv: [entry.move, ...line.pv], bestDefenseMove: line.firstMove, objectiveWdl };
    }
    const legal = new Map(after.moves({ verbose: true }).map((move) => [moveToUci(move), move]));
    const policy = normalizePolicy(await services.policy.predict(after.fen(), settings.opponentRating, settings.engineRating), legal);
    check();
    const selected: PolicyMove[] = [];
    let coverage = 0;
    for (const reply of policy) {
      if (selected.length >= settings.replyCount || coverage >= settings.replyCoverage) break;
      selected.push(reply);
      coverage += reply.probability;
    }
    // Include the engine's strongest defense even when its human probability is small.
    const defense = await services.uci.analyzeFen(after.fen(), Math.max(1, settings.trapDepth - 1), 1);
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
    let objectiveWdl = conservativeWdl(entry.rootScoreCp, entry.objectiveWdl,
      -bestDefense.score.cp, reverseWdl(lineWdl(bestDefense)));
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
      let wdl: Wdl | undefined;
      if (replied.isGameOver()) {
        scoreCp = replied.isCheckmate() ? -100_000 : 0;
        wdl = replied.isCheckmate() ? { win: 0, draw: 0, loss: 1 } : { win: 0, draw: 1, loss: 0 };
      }
      else {
        const result = reply.move === bestDefense.firstMove ? defense
          : await services.uci.analyzeFen(after.fen(), Math.max(1, settings.trapDepth - 1), 1, [reply.move]);
        check();
        const line = result.lines.find((line) => line.firstMove === reply.move);
        if (!line) throw new Error(`Stockfish did not score reply ${reply.move}.`);
        scoreCp = -line.score.cp; // Opponent POV -> fixed root mover POV.
        wdl = reverseWdl(lineWdl(line));
        punishment = line.pv.slice(1);
      }
      replies.push({ ...reply, san: played.san, scoreCp, expectedScore: cpToExpectedScore(scoreCp),
        lossCp: Math.max(0, scoreCp - baselineCp), punishment, wdl, bestDefense: reply.move === bestDefense.firstMove });
    }
    if ((settings.opponentPlies ?? 1) === 2) {
      const branches = [...replies].sort((a, b) => b.probability - a.probability)
        .filter((reply) => Math.abs(reply.scoreCp) < 90_000)
        .slice(0, settings.continuationBranches ?? 3);
      for (const branch of branches) {
        const refined = await this.refineReply(after, branch, settings, check, services);
        Object.assign(branch, refined);
      }
    }
    // A forced branch can uncover a stronger defense than the unrestricted finite search.
    // It belongs in the safety baseline regardless of how rarely Maia predicts it.
    for (const reply of replies) {
      objectiveWdl = conservativeWdl(baselineCp, objectiveWdl, reply.scoreCp, reply.wdl);
      baselineCp = Math.min(baselineCp, reply.scoreCp);
    }
    objectiveScore = cpToExpectedScore(baselineCp);
    riskCp = Math.max(riskCp, referenceCp - baselineCp);
    for (const reply of replies) reply.lossCp = Math.max(0, reply.scoreCp - baselineCp);
    coverage = Math.min(1, coverage);
    // Keep the true probability mass; unsearched replies receive best-defense utility.
    const expectedScore = replies.reduce((sum, reply) => sum + reply.probability * reply.expectedScore,
      (1 - coverage) * objectiveScore);
    const adjusted = objectiveScore + settings.trappiness * (expectedScore - objectiveScore);
    const expectedScoreCp = expectedScoreToCp(expectedScore);
    const knownDefense = replies.reduce((best, reply) => reply.scoreCp < best.scoreCp ? reply : best);
    const style = Math.abs(baselineCp) >= 90_000 ? undefined
      : measuredStyle(scorePlayingStyle(board.fen(), entry.move, [knownDefense.move, ...knownDefense.punishment], settings),
        settings, objectiveWdl, utilitySharpness(replies, coverage, objectiveScore));
    const adjustedScoreCp = Math.abs(baselineCp) >= 90_000 ? baselineCp : expectedScoreToCp(adjusted) + styleBonusCp(style);
    const trapReply = replies.filter((reply) => (reply.lossCp >= 80 || reply.continuation?.replies.some((next) =>
      next.lossCp >= 80 && next.probability * reply.probability >= 0.005))
      && reply.probability >= 0.005)
      .sort((a, b) => b.probability * (b.expectedScore - objectiveScore)
        - a.probability * (a.expectedScore - objectiveScore))[0];
    const nextTrap = trapReply?.continuation?.replies.filter((next) => next.lossCp >= 80 && next.probability * trapReply.probability >= 0.005)
      .sort((a, b) => b.probability * (b.expectedScore - cpToExpectedScore(trapReply.continuation!.scoreCp))
        - a.probability * (a.expectedScore - cpToExpectedScore(trapReply.continuation!.scoreCp)))[0];
    const mistakeProbability = replies.reduce((sum, reply) => sum + reply.probability *
      (reply.scoreCp - baselineCp >= 100 ? 1 : reply.continuation?.replies.reduce((mass, next) =>
        mass + (next.scoreCp - baselineCp >= 100 ? next.probability : 0), 0) ?? 0), 0);
    return { ...entry, riskCp, rootScoreCp: baselineCp, objectiveScore, expectedScore, expectedScoreCp, adjustedScoreCp,
      analyzed: true, status: 'evaluated', bestDefenseMove: bestDefense.firstMove,
      mistakeProbability, style, objectiveWdl,
      bonusCp: adjustedScoreCp - entry.rootScoreCp, policyCoverage: coverage, replies,
      trap: trapReply ? { reply: trapReply.move, replySan: trapReply.san, probability: trapReply.probability,
        profitCp: trapReply.lossCp, scoreCp: trapReply.scoreCp,
        punishment: nextTrap ? [trapReply.continuation!.move, nextTrap.move, ...nextTrap.punishment] : trapReply.punishment,
        setupSan: nextTrap ? trapReply.continuation!.san : undefined,
        nextReply: nextTrap ? { reply: nextTrap.move, replySan: nextTrap.san, probability: nextTrap.probability, scoreCp: nextTrap.scoreCp } : undefined,
      } : undefined };
  }

  private async refineReply(afterCandidate: Chess, reply: ReplyInfo, settings: TrappySettings,
    check: () => void, services: SearchServices): Promise<ReplyInfo> {
    const after = new Chess(afterCandidate.fen());
    if (!playUci(after, reply.move) || after.isGameOver()) return reply;
    let continuation = reply.punishment;
    if (!continuation.length) {
      const result = await services.uci.analyzeFen(after.fen(), Math.max(1, settings.trapDepth - 2), 1);
      check();
      continuation = result.lines[0]?.pv ?? [];
    }
    const engineMove = continuation[0];
    const played = engineMove ? playUci(after, engineMove) : null;
    if (!played) throw new Error('Stockfish returned no legal trap continuation.');
    if (after.isGameOver()) {
      const scoreCp = after.isCheckmate() ? 100_000 : 0;
      const expectedScore = after.isCheckmate() ? 1 : 0.5;
      const wdl = scoreCp <= reply.scoreCp
        ? after.isCheckmate() ? { win: 1, draw: 0, loss: 0 } : { win: 0, draw: 1, loss: 0 } : reply.wdl;
      return { ...reply, scoreCp: Math.min(reply.scoreCp, scoreCp), expectedScore, wdl,
        continuation: { move: engineMove, san: played.san, scoreCp, expectedScore, policyCoverage: 1, replies: [] } };
    }
    const legal = new Map(after.moves({ verbose: true }).map((move) => [moveToUci(move), move]));
    const policy = normalizePolicy(await services.policy.predict(after.fen(), settings.opponentRating, settings.engineRating), legal);
    check();
    const selected: PolicyMove[] = [];
    let coverage = 0;
    for (const next of policy) {
      if (selected.length >= (settings.continuationReplies ?? 4) || coverage >= settings.replyCoverage) break;
      selected.push(next);
      coverage += next.probability;
    }
    const depth = Math.max(1, settings.trapDepth - 3);
    const defense = await services.uci.analyzeFen(after.fen(), depth, 1);
    check();
    const bestDefense = defense.lines[0];
    if (!bestDefense || !legal.has(bestDefense.firstMove)) throw new Error('Stockfish returned no legal second defense.');
    const defenseProbability = policy.find((row) => row.move === bestDefense.firstMove)?.probability ?? 0;
    if (!selected.some((row) => row.move === bestDefense.firstMove)) {
      selected.push({ move: bestDefense.firstMove, probability: defenseProbability });
      coverage += defenseProbability;
    }
    const replies: ReplyInfo[] = [];
    for (const next of selected) {
      const board = new Chess(after.fen());
      const move = playUci(board, next.move)!;
      let scoreCp: number;
      let punishment: string[] = [];
      let wdl: Wdl | undefined;
      if (board.isGameOver()) {
        scoreCp = board.isCheckmate() ? -100_000 : 0;
        wdl = board.isCheckmate() ? { win: 0, draw: 0, loss: 1 } : { win: 0, draw: 1, loss: 0 };
      }
      else {
        const result = next.move === bestDefense.firstMove ? defense
          : await services.uci.analyzeFen(after.fen(), depth, 1, [next.move]);
        check();
        const line = result.lines.find((row) => row.firstMove === next.move);
        if (!line) throw new Error(`Stockfish did not score second reply ${next.move}.`);
        scoreCp = -line.score.cp;
        wdl = reverseWdl(lineWdl(line));
        punishment = line.pv.slice(1);
      }
      replies.push({ ...next, san: move.san, scoreCp, expectedScore: cpToExpectedScore(scoreCp), lossCp: 0, punishment, wdl,
        bestDefense: next.move === bestDefense.firstMove });
    }
    const scoreCp = Math.min(reply.scoreCp, -bestDefense.score.cp, ...replies.map((row) => row.scoreCp));
    let wdl = conservativeWdl(reply.scoreCp, reply.wdl, -bestDefense.score.cp, reverseWdl(lineWdl(bestDefense)));
    let wdlBaseline = Math.min(reply.scoreCp, -bestDefense.score.cp);
    for (const next of replies) {
      wdl = conservativeWdl(wdlBaseline, wdl, next.scoreCp, next.wdl);
      wdlBaseline = Math.min(wdlBaseline, next.scoreCp);
    }
    for (const next of replies) next.lossCp = Math.max(0, next.scoreCp - scoreCp);
    coverage = Math.min(1, coverage);
    const expectedScore = replies.reduce((sum, next) => sum + next.probability * next.expectedScore,
      (1 - coverage) * cpToExpectedScore(scoreCp));
    return { ...reply, scoreCp, expectedScore, wdl,
      continuation: { move: engineMove, san: played.san, scoreCp, expectedScore, policyCoverage: coverage, replies,
        bestDefenseMove: bestDefense.firstMove } };
  }
}

function riskLimit(bestCp: number, settings: TrappySettings): number {
  // Once ahead, convert the advantage rather than spending it on another bait.
  return bestCp >= 500 ? Math.min(settings.maxRiskCp, settings.winningRiskCp ?? 40) : settings.maxRiskCp;
}

function maxReported(values: (number | undefined)[]): number | undefined {
  const reported = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return reported.length ? Math.max(...reported) : undefined;
}

function candidate(move: Move, cp: number, pv: string[] = [moveToUci(move)], rootMate?: number, rootDepth?: number,
  objectiveWdl?: Wdl): CandidateInfo {
  const score = cpToExpectedScore(cp);
  return { move: moveToUci(move), san: move.san, rootScoreCp: cp, adjustedScoreCp: cp, riskCp: 0,
    bonusCp: 0, expectedScoreCp: cp, expectedScore: score, objectiveScore: score, policyCoverage: 0, replies: [],
    pv: [...pv], rootMate, initialScoreCp: cp, rootDepth, objectiveWdl, analyzed: false, status: 'objective-only' };
}

function lineWdl(line: AnalysisLine): Wdl | undefined {
  if (line.score.type === 'mate') return line.score.cp > 0
    ? { win: 1, draw: 0, loss: 0 } : { win: 0, draw: 0, loss: 1 };
  return line.wdl;
}

function reverseWdl(wdl?: Wdl): Wdl | undefined {
  return wdl ? { win: wdl.loss, draw: wdl.draw, loss: wdl.win } : undefined;
}

function conservativeWdl(cp: number, wdl: Wdl | undefined, nextCp: number, nextWdl?: Wdl): Wdl | undefined {
  if (nextCp < cp) return nextWdl;
  // Equally scored verification cannot erase an available model. A known draw
  // continuation is stronger evidence than a finite-search draw estimate.
  if (nextCp === cp) return wdl?.draw === 1 && cp === 0 ? wdl : nextWdl ?? wdl;
  return wdl;
}

function measuredStyle(style: StyleScore, settings: TrappySettings, wdl?: Wdl, sharpness?: number): StyleScore {
  return { ...style, sharpness, sharpnessAvailable: sharpness !== undefined,
    sharpnessBonusCp: 60 * (settings.sharpness ?? 0) * (sharpness ?? 0),
    drawProbability: wdl?.draw, drawAversionAvailable: wdl !== undefined,
    drawAversionPenaltyCp: 60 * (settings.drawAversion ?? 0) * (wdl?.draw ?? 0) };
}

/** Actual policy-weighted utility dispersion; unsearched mass keeps defensive utility.
 * Nested replies retain their joint probabilities rather than treating the branch
 * expectation as a deterministic outcome, which would erase second-turn volatility. */
export function utilitySharpness(replies: ReplyInfo[], coverage: number, baselineUtility: number): number {
  const outcomes = [{ probability: Math.max(0, 1 - coverage), utility: baselineUtility }];
  for (const reply of replies) {
    const continuation = reply.continuation;
    if (continuation?.replies.length) {
      outcomes.push({ probability: reply.probability * Math.max(0, 1 - continuation.policyCoverage),
        utility: cpToExpectedScore(continuation.scoreCp) });
      for (const next of continuation.replies) outcomes.push({ probability: reply.probability * next.probability,
        utility: next.expectedScore });
    } else outcomes.push({ probability: reply.probability, utility: reply.expectedScore });
  }
  const mean = outcomes.reduce((sum, row) => sum + row.probability * row.utility, 0);
  const variance = outcomes.reduce((sum, row) => sum + row.probability * (row.utility - mean) ** 2, 0);
  return Math.min(1, 2 * Math.sqrt(Math.max(0, variance)));
}

/** Nominate independently for each active preference, so one strong feature cannot
 * crowd every other feature out. At most 12 quiet additions share one root search. */
function styleNominees(fen: string, legal: Move[], settings: TrappySettings): string[] {
  if (![settings.aggression, settings.tension, settings.pawnStorm, settings.kingCaution,
    settings.queenRetention, settings.sacrifice].some(Boolean)) return [];
  const scores = legal.map((move) => ({ move: moveToUci(move),
    style: scorePlayingStyle(fen, moveToUci(move), [], settings) }));
  const contributions: (keyof StyleScore)[] = [];
  if (settings.aggression) contributions.push('aggressionBonusCp');
  if (settings.tension) contributions.push('tensionBonusCp');
  if (settings.pawnStorm) contributions.push('pawnStormBonusCp');
  if (settings.kingCaution) contributions.push('kingCautionPenaltyCp');
  if (settings.queenRetention) contributions.push('queenRetentionBonusCp');
  const nominees = new Set<string>();
  for (const field of contributions) {
    const featureValues = scores.map((row) => Number(row.style[field]));
    if (Math.max(...featureValues) - Math.min(...featureValues) < 1e-9) continue;
    const sign = field === 'kingCautionPenaltyCp' ? -1 : 1;
    [...scores].sort((a, b) => sign * (Number(b.style[field]) - Number(a.style[field])) || a.move.localeCompare(b.move))
      .slice(0, 2).forEach((row) => nominees.add(row.move));
  }
  if (settings.sacrifice) {
    const before = new Chess(fen);
    const own = before.turn();
    const pieceValue: Record<string, number> = { p: 1, n: 3, b: 3.25, r: 5, q: 9, k: 0 };
    const offers = legal.map((move) => {
      const after = new Chess(fen); after.move(move);
      // This is only candidate discovery: verified PV investment and compensation
      // decide the eventual sacrifice bonus, never this speculative exposure.
      const exposed = after.board().flat().reduce((sum, piece) => sum + (piece && piece.color === own
        && piece.type !== 'k' && after.isAttacked(piece.square, opposite(own))
        && (piece.square === move.to || !before.isAttacked(piece.square, opposite(own)))
        ? pieceValue[piece.type] * (piece.square === move.to ? 2 : 1) : 0), 0);
      return { move: moveToUci(move), exposed };
    }).sort((a, b) => b.exposed - a.exposed || a.move.localeCompare(b.move));
    offers.filter((row) => row.exposed > 0).slice(0, 2).forEach((row) => nominees.add(row.move));
  }
  return [...nominees].slice(0, 12);
}

function applySelection(result: MoveDecision, eligible: CandidateInfo[], temperatureCp: number,
  analysis = false, random: () => number): MoveDecision {
  const choices = eligible.length ? eligible : [result.selected];
  const best = choices[0];
  const weights = choices.map((entry) => temperatureCp > 0
    ? Math.exp((entry.adjustedScoreCp - best.adjustedScoreCp) / temperatureCp) : Number(entry.move === best.move));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const probabilities = new Map(choices.map((entry, index) => [entry.move, weights[index] / total]));
  let selected = best;
  let randomDraw: number | undefined;
  if (!analysis && temperatureCp > 0 && choices.length > 1) {
    randomDraw = Math.min(1 - Number.EPSILON, Math.max(0, random()));
    if (!Number.isFinite(randomDraw)) throw new Error('Invalid random sample.');
    let cumulative = 0;
    selected = choices.at(-1)!;
    for (const entry of choices) {
      cumulative += probabilities.get(entry.move)!;
      if (randomDraw < cumulative) { selected = entry; break; }
    }
  }
  const candidates = result.candidates.map((entry) => ({ ...entry, selectionProbability: probabilities.get(entry.move) ?? 0 }));
  selected = candidates.find((entry) => entry.move === selected.move) ?? selected;
  return { ...result, candidates, selected, move: selected.move, san: selected.san,
    mode: result.policySource === 'maia' && selected.trap ? 'trappy' : 'standard',
    selection: { method: analysis ? 'analysis' : randomDraw === undefined ? 'best' : 'sampled', temperatureCp, randomDraw,
      probabilities: candidates.map((entry) => ({ move: entry.move, probability: entry.selectionProbability ?? 0 })) } };
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
  if (![settings.trappiness, settings.maxRiskCp, settings.opponentRating, settings.engineRating, settings.replyCoverage]
    .every(Number.isFinite) || settings.trappiness < 0 || settings.trappiness > 1 || settings.maxRiskCp < 0
    || settings.replyCoverage <= 0 || settings.replyCoverage > 1) throw new Error('Invalid practical engine settings.');
  for (const field of ['aggression', 'tension', 'pawnStorm', 'kingCaution', 'sacrifice', 'sharpness',
    'queenRetention', 'drawAversion', 'variety'] as const) {
    const value = settings[field] ?? 0;
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid ${field}.`);
  }
  if (settings.winningRiskCp !== undefined && (!Number.isFinite(settings.winningRiskCp) || settings.winningRiskCp < 0)) {
    throw new Error('Invalid winning risk limit.');
  }
  if (settings.opponentPlies !== undefined && settings.opponentPlies !== 1 && settings.opponentPlies !== 2) {
    throw new Error('Invalid opponent lookahead.');
  }
  for (const field of ['continuationReplies', 'continuationBranches'] as const) {
    if (settings[field] !== undefined && (!Number.isInteger(settings[field]) || settings[field]! < 1 || settings[field]! > 10)) {
      throw new Error(`Invalid ${field}.`);
    }
  }
}
export function playUci(board: Chess, uci: string): Move | null {
  try { return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return null; }
}
export function moveToUci(move: Move): string { return `${move.from}${move.to}${move.promotion ?? ''}`; }
export function opposite(color: Color): Color { return color === 'w' ? 'b' : 'w'; }
export function squarePairFromUci(uci: string): [Square, Square] | null {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) ? [uci.slice(0, 2) as Square, uci.slice(2, 4) as Square] : null;
}
