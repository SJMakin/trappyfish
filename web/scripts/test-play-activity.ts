import assert from 'node:assert/strict';
import { publicActivity } from '../src/play/activity';
import { applySearchProfile, DEFAULT_PLAY_SETTINGS, identifySearchProfile } from '../src/play/searchProfiles';

const activity = publicActivity({ stage: 'replies', message: 'SECRET Qh4#', candidate: 'e7e5', completed: 2, total: 8,
  diagnostics: { elapsedMs: 1240, stockfishCalls: 6, policyCalls: 2, policyTimeMs: 5, nodes: 12345, maxDepth: 12,
    rootTrace: [{ depth: 12, move: 'd8h4', scoreCp: 100000 }] } });
assert.deepEqual(activity, { stage: 'replies', completed: 2, total: 8, stockfishCalls: 6, policyCalls: 2, nodes: 12345, depth: 12, elapsedMs: 1240 });
assert.doesNotMatch(JSON.stringify(activity), /SECRET|e7e5|d8h4|scoreCp|rootTrace|candidate/);
const explicit = { ...DEFAULT_PLAY_SETTINGS, aggression: .8, tension: .65, trappiness: .6, maxRiskCp: 75, opponentRating: 1400, variety: .5 };
for (const name of ['Quick', 'Deep'] as const) {
  const changed = applySearchProfile(explicit, name);
  assert.equal(identifySearchProfile(changed), name);
  for (const key of ['aggression', 'tension', 'trappiness', 'maxRiskCp', 'opponentRating', 'variety'] as const) assert.equal(changed[key], explicit[key]);
  assert.equal(identifySearchProfile({ ...changed, rootDepth: 11 }), 'Custom');
}
assert.equal(DEFAULT_PLAY_SETTINGS.continuationCandidates, 2);
assert.equal(identifySearchProfile({ ...DEFAULT_PLAY_SETTINGS, continuationCandidates: undefined }), 'Custom', 'Old saves do not silently acquire wider continuations');
console.log('Play activity privacy and explicit search budgets passed.');
