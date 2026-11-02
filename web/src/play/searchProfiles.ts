import { DEFAULT_TRAPPY_SETTINGS, type TrappySettings } from '../engine/trappy';

export type SearchProfile = 'Quick' | 'Deep' | 'Custom';
const budgets = {
  Quick: { rootDepth: 12, trapDepth: 8, candidateCount: 8, replyCount: 8, opponentPlies: 1 as const,
    continuationBranches: 3, continuationReplies: 4, continuationCandidates: 1, replyCoverage: .95 },
  Deep: { rootDepth: 12, trapDepth: 10, candidateCount: 10, replyCount: 10, opponentPlies: 2 as const,
    continuationBranches: 3, continuationReplies: 4, continuationCandidates: 2, replyCoverage: .95 },
};
/** Budget choices never change style, ratings, or risk limits. */
export function applySearchProfile(settings: TrappySettings, profile: 'Quick' | 'Deep'): TrappySettings {
  return { ...settings, ...budgets[profile] };
}
export function identifySearchProfile(settings: TrappySettings): SearchProfile {
  for (const profile of ['Quick', 'Deep'] as const) {
    const expected = budgets[profile];
    if (Object.entries(expected).every(([key, value]) => {
      if (settings.opponentPlies === 1 && ['continuationBranches', 'continuationReplies', 'continuationCandidates'].includes(key)) return true;
      return (settings[key as keyof TrappySettings] ?? (key === 'continuationCandidates' ? 1 : undefined)) === value;
    })) return profile;
  }
  return 'Custom';
}
export const DEFAULT_PLAY_SETTINGS = applySearchProfile(DEFAULT_TRAPPY_SETTINGS, 'Deep');

/** Missing legacy fields keep the historical width even when a whole settings record is absent. */
export function initialPlaySettings(savedGame?: { settings?: TrappySettings }): TrappySettings {
  return savedGame ? { ...DEFAULT_TRAPPY_SETTINGS, ...savedGame.settings,
    continuationCandidates: savedGame.settings?.continuationCandidates ?? 1 } : { ...DEFAULT_PLAY_SETTINGS };
}
