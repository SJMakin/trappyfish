import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
import { allTrapStudies, quarantinedTrapStudies, selectableTrapStudies } from '../src/openings/trapLibrary';
import { evaluationLossCp, humanTrapSample } from '../src/openings/trapEvidence';

assert.equal(evaluationLossCp(100_000, 99_900), 0);
assert.equal(evaluationLossCp(-99_900, -100_000), 0);
assert.equal(evaluationLossCp(90, -40), 130);
assert.equal(evaluationLossCp(90, 100), 0);
const base = { white: 40, draws: 10, black: 50, moves: [{ uci: 'g8f6', white: 6, draws: 1, black: 3 }] };
const found = humanTrapSample('sample', 'fen', 'g8f6', base, '2026-11-02T00:00:00Z');
assert.equal(found.gamesAtPosition, 100); assert.equal(found.mistakeGames, 10); assert.equal(found.mistakeFrequency, .1);
assert.equal(found.status, 'available');
const omitted = humanTrapSample('sample', 'fen', 'd7d6', base, '2026-11-02T00:00:00Z');
assert.equal(omitted.gamesAtPosition, 100); assert.equal(omitted.mistakeGames, null); assert.equal(omitted.mistakeFrequency, null);
assert.equal(omitted.status, 'unavailable'); assert.match(omitted.reason!, /unknown/);
const empty = humanTrapSample('sample', 'fen', 'd7d6', { white: 0, draws: 0, black: 0, moves: [] }, '2026-11-02T00:00:00Z');
assert.equal(empty.mistakeFrequency, null); assert.equal(empty.status, 'unavailable');
assert.throws(() => humanTrapSample('sample', 'fen', 'g8f6', { ...base, white: -1 }, 'now'));
assert.throws(() => humanTrapSample('sample', 'fen', 'g8f6', { ...base, moves: [{ uci: 'g8f6', white: 101, draws: 0, black: 0 }] }, 'now'));

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const report = JSON.parse(await readFile('src/openings/trapLibraryVerification.json', 'utf8'));
const humans = JSON.parse(await readFile('src/openings/trapHumanSamples.json', 'utf8'));
const models = JSON.parse(await readFile('src/openings/trapModelSamples.json', 'utf8'));
const inputs = sha(JSON.stringify(allTrapStudies));
assert.equal(report.sourceSha256, inputs); assert.equal(humans.sourceSha256, inputs); assert.equal(models.sourceSha256, inputs);
assert.equal(report.selectionPolicySha256, sha(JSON.stringify({ quarantinedTrapStudies, selectableIds: selectableTrapStudies.map(study => study.id) })));
assert.deepEqual(report.quarantinedStudies, quarantinedTrapStudies);
assert.deepEqual(report.selectableStudyIds, selectableTrapStudies.map(study => study.id));
assert.equal(report.positions.length, allTrapStudies.length); assert.equal(new Set(report.positions.map((row: any) => row.id)).size, allTrapStudies.length);
assert.equal(report.depth, 16);
for (const study of allTrapStudies) {
  const row = report.positions.find((item: any) => item.id === study.id);
  assert.ok(row); assert.equal(row.fen, study.rootFen); assert.equal(row.bait, study.baitUci); assert.equal(row.temptingReply, study.temptingReplyUci);
  assert.equal(row.riskCp, evaluationLossCp(row.rootCp, row.baitCp));
  assert.equal(row.temptingReplyLossCp, evaluationLossCp(-row.defenseCpFromTrapper, -row.temptingReplyCpFromTrapper));
  assert.equal(row.punishmentRiskCp, evaluationLossCp(row.bestPunishmentCp, row.punishmentCp));
  assert.equal(row.temptingReplyAllowsMate, row.bestPunishmentCp >= 90000);
  assert.equal(row.punishmentKeepsMate, row.bestPunishmentCp >= 90000 && row.punishmentCp >= 90000);
  const defense = new Chess(study.afterBaitFen).move(row.bestDefense); assert.equal(defense.san, row.bestDefenseSan);
  const line = new Chess(study.rootFen);
  for (const move of [study.baitUci, study.temptingReplyUci, ...study.punishmentUci]) line.move(move);
  assert.equal(row.illustrativeLine.legal, true); assert.equal(row.illustrativeLine.endsInMate, line.isCheckmate());
  const observed = humans.positions.find((sample: any) => sample.id === study.id);
  assert.equal(observed.fen, study.afterBaitFen); assert.equal(observed.mistake, study.temptingReplyUci);
  if (observed.status === 'available') assert.equal(observed.mistakeFrequency, observed.mistakeGames / observed.gamesAtPosition);
  else assert.equal(observed.mistakeFrequency, null, 'Unavailable human samples never become zero percent');
  for (const rating of [1000, 1400]) {
    const model = models.positions.find((sample: any) => sample.id === study.id && sample.opponentRating === rating);
    assert.ok(model); assert.equal(model.fen, study.afterBaitFen); assert.equal(model.mistake, study.temptingReplyUci);
    assert.equal(model.engineRating, 2400); assert.equal(model.status, 'available');
    assert.ok(Number.isFinite(model.modelProbability) && model.modelProbability >= 0 && model.modelProbability <= 1);
  }
}
assert.equal(models.modelSha256, sha(await readFile('public/maia/maia3-5m.onnx')));
assert.equal(models.positions.length, allTrapStudies.length * 2);
assert.equal(report.selectionChecks.length, 2);
assert.deepEqual(report.selectionChecks.map((probe: any) => probe.expected), ['accept-book', 'reject-book']);
assert.ok(report.selectionChecks.every((probe: any) => probe.passed && probe.policyCalls === 0 && selectableTrapStudies.some(study => study.id === probe.id)));
const london = report.positions.find((row: any) => row.id === 'trap-import-london-qxb2-trap');
assert.ok(london.punishmentRiskCp > 300); assert.ok(quarantinedTrapStudies.some(study => study.id === london.id));
console.log('Trap evidence checks passed: 20 audited/19 selectable studies, matching input/policy hashes, replayable defenses, 40 real model references, conditional human denominators and quarantine.');
