import { Chess, type Color } from 'chess.js';
import { legalLine, type ResearchLine } from './analysisLines';
import type { CandidateInfo, ReplyInfo } from './trappy';

export type AnalysisNodeTag = 'candidate' | 'best-defense' | 'human-mistake' | 'engine-continuation' | 'stockfish-pv' | 'objective' | 'checkmate' | 'draw';
export type AnalysisMoveNode = {
  kind: 'move'; id: string; uci: string; san: string; label: string; ply: number; color: Color;
  fen: string; path: string[]; role: 'candidate' | 'human-reply' | 'engine-continuation' | 'pv';
  tags: AnalysisNodeTag[]; children: AnalysisTreeNode[]; line: ResearchLine;
  /** Present only on a reply explicitly returned by the human policy model. */
  conditionalProbability?: number; jointProbability?: number;
  /** Evaluated branch values are always from the original mover's perspective. */
  scoreCp?: number; lossCp?: number; expectedScore?: number;
};
export type AnalysisResidualNode = {
  kind: 'residual'; id: string; label: string; conditionalProbability: number; jointProbability: number;
  children: []; scoreCp: number; ply: number;
};
export type AnalysisTreeNode = AnalysisMoveNode | AnalysisResidualNode;
export type AnalysisTreeData = {
  root: AnalysisMoveNode | null; lines: ResearchLine[]; moveCount: number; replyCount: number;
  residualCount: number; truncatedLines: number;
};
type Annotation = Partial<Pick<AnalysisMoveNode, 'role' | 'scoreCp' | 'lossCp' | 'expectedScore' | 'conditionalProbability' | 'jointProbability'>> & {
  tags?: AnalysisNodeTag[];
};

/**
 * A trie of the engine's actual searched branches, rather than a filtered list of
 * interesting traps. The Stockfish tails are deterministic PVs: only the Maia
 * decision nodes have probabilities. Every inserted path is replayed first, so
 * stale or incomplete engine PVs cannot introduce an illegal board position.
 */
export function buildAnalysisTree(fen: string, candidate: CandidateInfo): AnalysisTreeData {
  const result: AnalysisTreeData = { root: null, lines: [], moveCount: 0, replyCount: 0, residualCount: 0, truncatedLines: 0 };
  const nodes = new Map<string, AnalysisMoveNode>();
  const annotations = new Map<string, Annotation>();
  const key = (moves: string[]) => moves.join('/');
  const note = (path: string[], value: Annotation) => {
    const id = key(path); const prior = annotations.get(id);
    annotations.set(id, { ...prior, ...value, tags: [...new Set([...(prior?.tags ?? []), ...(value.tags ?? [])])] });
  };
  const insert = (research: ResearchLine) => {
    const legal = legalLine(fen, research.moves);
    if (!legal.complete) result.truncatedLines++;
    if (!legal.moves.length || legal.moves[0] !== candidate.move) return;
    const line = { ...research, moves: legal.moves };
    result.lines.push(line);
    for (let index = 0; index < legal.moves.length; index++) {
      const path = legal.moves.slice(0, index + 1); const id = key(path);
      let node = nodes.get(id);
      if (!node) {
        const before = new Chess(legal.fens[index]);
        node = {
          kind: 'move', id, uci: legal.moves[index], san: legal.sans[index], label: legal.labels[index],
          ply: index + 1, color: before.turn(), fen: legal.fens[index + 1], path,
          role: index === 0 ? 'candidate' : 'pv', tags: index === 0 ? ['candidate'] : ['stockfish-pv'],
          children: [], line,
        };
        const after = new Chess(node.fen);
        if (after.isCheckmate()) node.tags.push('checkmate');
        else if (after.isDraw()) node.tags.push('draw');
        nodes.set(id, node); result.moveCount++;
        if (index === 0) result.root = node;
        else nodes.get(key(path.slice(0, -1)))!.children.push(node);
      }
      // Clicking any prefix replays a real complete branch containing that node.
      // Prefer the longer continuation when several searched lines share it.
      if (line.moves.length > node.line.moves.length) node.line = line;
    }
  };
  const firstDefense = strongestDefense(candidate.replies, candidate.bestDefenseMove);
  note([candidate.move], { role: 'candidate', scoreCp: candidate.rootScoreCp, tags: ['candidate'] });

  for (const reply of candidate.replies) {
    const firstPath = [candidate.move, reply.move];
    const isDefense = reply === firstDefense;
    const kind = isDefense ? 'defense' : reply.lossCp >= 80 ? 'trap' : 'reply';
    const label = `${isDefense ? 'Best defense' : 'After'} ${reply.san}`;
    const id = isDefense ? `${candidate.move}/defense` : key(firstPath);
    note(firstPath, replyAnnotation(reply, reply.probability, isDefense));
    insert({ id, label, kind, moves: [...firstPath, ...reply.punishment],
      probability: reply.probability, scoreCp: reply.scoreCp, reply });
    const continuation = reply.continuation;
    if (!continuation) continue;
    const enginePath = [...firstPath, continuation.move];
    note(enginePath, { role: 'engine-continuation', scoreCp: continuation.scoreCp,
      expectedScore: continuation.expectedScore, tags: ['engine-continuation'] });
    // This also retains a terminal continuation when there are no next replies.
    insert({ id: `${id}/continuation`, label: `${label}, then ${continuation.san}`, kind,
      moves: enginePath, probability: reply.probability, scoreCp: continuation.scoreCp, reply });
    const nextDefense = strongestDefense(continuation.replies, continuation.bestDefenseMove);
    for (const next of continuation.replies) {
      const path = [...enginePath, next.move];
      const joint = reply.probability * next.probability;
      note(path, replyAnnotation(next, joint, next === nextDefense));
      insert({ id: `${key(firstPath)}/${next.move}`, label: `After ${reply.san}, then ${next.san}`,
        kind: next === nextDefense ? 'defense' : next.lossCp >= 80 ? 'trap' : 'reply',
        moves: [...path, ...next.punishment], probability: joint, conditionalProbability: next.probability,
        scoreCp: next.scoreCp, reply });
    }
  }
  if (!candidate.replies.length) {
    const pv = candidate.pv?.length && candidate.pv[0] === candidate.move ? candidate.pv : [candidate.move];
    note([candidate.move], { tags: ['objective'] });
    insert({ id: `${candidate.move}/objective`, label: 'Stockfish continuation', kind: 'objective', moves: pv, scoreCp: candidate.rootScoreCp });
  }
  // A defense outside the sampled human replies may still be available in the
  // objective PV. Show the legal searched path without inventing a probability.
  else if (candidate.bestDefenseMove && !candidate.replies.some((reply) => reply.move === candidate.bestDefenseMove)
    && candidate.pv?.[0] === candidate.move && candidate.pv[1] === candidate.bestDefenseMove) {
    const path = [candidate.move, candidate.bestDefenseMove];
    note(path, { tags: ['best-defense', 'objective'] });
    insert({ id: `${candidate.move}/objective`, label: 'Objective best defense', kind: 'objective', moves: candidate.pv, scoreCp: candidate.rootScoreCp });
  }

  for (const [id, node] of nodes) {
    const value = annotations.get(id);
    if (!value) continue;
    const terminalTags = node.tags.filter((tag) => tag === 'checkmate' || tag === 'draw');
    Object.assign(node, value);
    // Explicit model / engine annotations take precedence over a PV's generic role.
    node.tags = [...new Set([...(value.tags ?? []), ...terminalTags])];
    if (node.conditionalProbability !== undefined) result.replyCount++;
    if (node.role === 'human-reply' || node.role === 'engine-continuation') {
      // A shared prefix has not chosen its next human reply yet. Follow a known
      // defense by default instead of silently selecting a longer mistake branch.
      const defenses = result.lines.filter((line) => line.kind === 'defense' && line.moves.length > node.ply
        && node.path.every((move, index) => line.moves[index] === move));
      defenses.sort((a, b) => Number(b.conditionalProbability !== undefined) - Number(a.conditionalProbability !== undefined)
        || b.moves.length - a.moves.length);
      if (defenses[0]) node.line = defenses[0];
    }
  }
  const residual = (path: string[], coverage: number, prior: number, scoreCp: number) => {
    const parent = nodes.get(key(path));
    const mass = 1 - probability(coverage);
    if (!parent || mass < 1e-8 || new Chess(parent.fen).isGameOver()) return;
    parent.children.push({ kind: 'residual', id: `${parent.id}/unsearched`, label: 'Unsearched replies',
      conditionalProbability: mass, jointProbability: probability(prior) * mass, children: [], scoreCp, ply: parent.ply + 1 });
    result.residualCount++;
  };
  // Residual probability is attached to the chance layer, never represented as
  // an invented chess move or normalized away from the returned policy mass.
  if (candidate.replies.length) residual([candidate.move], candidate.policyCoverage, 1, candidate.rootScoreCp);
  for (const reply of candidate.replies) if (reply.continuation?.replies.length) {
    residual([candidate.move, reply.move, reply.continuation.move], reply.continuation.policyCoverage,
      reply.probability, reply.continuation.scoreCp);
  }
  for (const node of nodes.values()) node.children.sort((a, b) => {
    if (a.kind === 'residual') return 1;
    if (b.kind === 'residual') return -1;
    return (b.conditionalProbability ?? -1) - (a.conditionalProbability ?? -1);
  });
  return result;
}

function replyAnnotation(reply: ReplyInfo, joint: number, defense: boolean): Annotation {
  return { role: 'human-reply', conditionalProbability: probability(reply.probability), jointProbability: probability(joint),
    scoreCp: reply.scoreCp, lossCp: reply.lossCp, expectedScore: reply.expectedScore,
    tags: [...(defense ? ['best-defense' as const] : []), ...(reply.lossCp >= 100 ? ['human-mistake' as const] : [])] };
}
function strongestDefense(replies: ReplyInfo[], move?: string): ReplyInfo | undefined {
  const explicit = replies.find((reply) => reply.bestDefense) ?? replies.find((reply) => reply.move === move);
  if (explicit || move) return explicit;
  return replies.reduce<ReplyInfo | undefined>((best, reply) => !best || reply.scoreCp < best.scoreCp ? reply : best, undefined);
}
function probability(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
