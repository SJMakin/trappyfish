import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveScoreLedger, summarizeAnalysisTree } from '../src/engine/analysisDiagnostics';
import { cpToExpectedScore, DEFAULT_ANALYSIS_SETTINGS, expectedScoreToCp,
  type CandidateInfo, type MoveDecision, type ReplyInfo } from '../src/engine/trappy';

const near = (actual: number | undefined, expected: number) => {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
};
function candidate(overrides: Partial<CandidateInfo> = {}): CandidateInfo {
  return { move: 'e2e4', san: 'e4', rootScoreCp: 0, adjustedScoreCp: 0, riskCp: 0,
    bonusCp: 0, expectedScoreCp: 0, expectedScore: 0.5, objectiveScore: 0.5,
    policyCoverage: 0, replies: [], analyzed: true, status: 'evaluated', ...overrides };
}
function decision(selected: CandidateInfo, overrides: Partial<MoveDecision> = {}): MoveDecision {
  return { move: selected.move, san: selected.san, mode: 'trappy', rootBestMove: selected.move,
    rootBestSan: selected.san, rootBestScoreCp: 0, candidates: [selected], selected, policySource: 'maia', ...overrides };
}
function reply(overrides: Partial<ReplyInfo> = {}): ReplyInfo {
  return { move: 'e7e5', san: 'e5', probability: 0.4, scoreCp: 100, expectedScore: cpToExpectedScore(100),
    lossCp: 100, punishment: [], ...overrides };
}

test('Ledger retains omitted policy mass at baseline and reconstructs the exact score pipeline', () => {
  const replyUtility = cpToExpectedScore(100);
  const expected = 0.4 * replyUtility + 0.6 * 0.5;
  const blend = 0.5 + 0.7 * (expected - 0.5);
  const ranked = expectedScoreToCp(blend) + 12 + 8;
  const row = candidate({ replies: [reply()], policyCoverage: 0.4, expectedScore: expected,
    expectedScoreCp: expectedScoreToCp(expected), adjustedScoreCp: ranked,
    style: { attackPressure: 0.2, tension: 0.2, aggressionBonusCp: 12, tensionBonusCp: 8 } });
  const ledger = deriveScoreLedger(decision(row), row, { ...DEFAULT_ANALYSIS_SETTINGS, trappiness: 0.7 });
  near(ledger.omittedMass, 0.6);
  near(ledger.omittedContribution, 0.3);
  near(ledger.searchedContribution, 0.4 * replyUtility);
  near(ledger.blendedUtility, blend);
  near(ledger.reconstructedRanking, ranked);
  near(ledger.baseRanking, expectedScoreToCp(blend));
});

test('Second-turn coverage distinguishes conditional from joint mass', () => {
  const first = reply({ probability: 0.3,
    continuation: { move: 'g1f3', san: 'Nf3', scoreCp: 100, expectedScore: 0.65,
      policyCoverage: 0.8, replies: [reply({ move: 'b8c6', san: 'Nc6', probability: 0.8 })] } });
  const row = candidate({ replies: [first], policyCoverage: 0.3 });
  const ledger = deriveScoreLedger(decision(row), row, DEFAULT_ANALYSIS_SETTINGS);
  near(ledger.refinements[0].conditionalCoverage, 0.8);
  near(ledger.refinements[0].jointCoverage, 0.24);
  near(ledger.refinements[0].omittedJointMass, 0.06);
  assert.deepEqual(summarizeAnalysisTree([row]), {
    candidates: 1, evaluated: 1, outsideRisk: 0, firstReplies: 1, continuations: 1, secondReplies: 1,
  });
});

test('Objective-only candidates have no fabricated reply mass and bypass bounded utility inversion', () => {
  const row = candidate({ rootScoreCp: 2000, objectiveScore: cpToExpectedScore(2000),
    expectedScore: cpToExpectedScore(2000), adjustedScoreCp: 2012,
    style: { attackPressure: 0.2, tension: 0, aggressionBonusCp: 12, tensionBonusCp: 0 } });
  const ledger = deriveScoreLedger(decision(row, { policySource: 'stockfish' }), row, DEFAULT_ANALYSIS_SETTINGS);
  assert.equal(ledger.modeled, false);
  assert.equal(ledger.weight, 0);
  assert.equal(ledger.omittedMass, undefined);
  assert.equal(ledger.omittedContribution, undefined);
  assert.equal(ledger.searchedContribution, undefined);
  near(ledger.reconstructedRanking, 2012);
});

test('Unknown settings stay unknown while actual ranking can still be shown', () => {
  const row = candidate({ replies: [reply()], policyCoverage: 0.4, adjustedScoreCp: 80 });
  const ledger = deriveScoreLedger(decision(row), row);
  assert.equal(ledger.weight, undefined);
  assert.equal(ledger.blendedUtility, undefined);
  assert.equal(ledger.reconstructedRanking, undefined);
  assert.equal(ledger.baseRanking, 80);
});

test('Forced mate sentinel is retained instead of displayed as a finite inverse sigmoid score', () => {
  const row = candidate({ rootScoreCp: 100_000, expectedScore: 1, objectiveScore: 1, adjustedScoreCp: 100_000 });
  const ledger = deriveScoreLedger(decision(row), row, DEFAULT_ANALYSIS_SETTINGS);
  assert.equal(ledger.forcedOutcome, true);
  assert.equal(ledger.reconstructedRanking, 100_000);
});

test('Different winning mate distances retain the engine’s zero-risk classification', () => {
  const row = candidate({ rootScoreCp: 99_700, adjustedScoreCp: 99_700, riskCp: 0, objectiveScore: 1 });
  const ledger = deriveScoreLedger(decision(row, { rootBestScoreCp: 100_000 }), row, DEFAULT_ANALYSIS_SETTINGS);
  assert.equal(ledger.objectiveGapCp, 0);
  assert.equal(ledger.forcedOutcome, true);
});
