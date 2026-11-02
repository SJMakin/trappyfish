import type { AnalysisProgress } from '../engine/trappy';

export type PlayActivity = {
  stage: AnalysisProgress['stage']; completed: number; total: number;
  nodes?: number; depth?: number; stockfishCalls: number; policyCalls: number;
  elapsedMs?: number;
};
/** Explicit allowlist: raw messages, candidate names, root traces, scores and PVs stay out of live Play. */
export function publicActivity(progress: AnalysisProgress): PlayActivity {
  return { stage: progress.stage, completed: progress.completed, total: progress.total,
    nodes: progress.diagnostics?.nodes, depth: progress.diagnostics?.maxDepth,
    stockfishCalls: progress.diagnostics?.stockfishCalls ?? 0, policyCalls: progress.diagnostics?.policyCalls ?? 0,
    elapsedMs: progress.diagnostics?.elapsedMs };
}
export const activityLabel = {
  root: 'Surveying the position', candidates: 'Comparing possibilities', replies: 'Modeling human replies', complete: 'Search complete',
};
