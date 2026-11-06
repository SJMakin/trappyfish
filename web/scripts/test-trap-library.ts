import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
import { allTrapStudies, curatedTrapOpenings, quarantinedTrapStudies, selectableTrapStudies, trapLibraryProvenance } from '../src/openings/trapLibrary';
import { trapRepertoire } from '../src/openings/trapRepertoire';
import { auditTrapSource, deriveImportedStudies } from './build-trap-library.mjs';

const sourceBytes = await readFile('src/openings/source/chess-coach-traps.json');
const source = JSON.parse(sourceBytes.toString('utf8'));
assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), trapLibraryProvenance.sourceSha256);
assert.equal(createHash('sha256').update(await readFile('src/openings/source/chess-coach-LICENSE.txt')).digest('hex'), trapLibraryProvenance.licenseSha256);
const audit = auditTrapSource(source);
assert.equal(audit.length, 19);
assert.equal(audit.filter((row: any) => !row.included).length, 5);
assert.equal(audit.flatMap((row: any) => row.variations).length, 20);
assert.ok(audit.flatMap((row: any) => row.variations).every((row: any) => row.legalReplay));
assert.equal(allTrapStudies.length, 20); assert.equal(curatedTrapOpenings.length, 19);
assert.equal(selectableTrapStudies.length, 19); assert.equal(quarantinedTrapStudies.length, 1);
assert.equal(quarantinedTrapStudies[0].id, 'trap-import-london-qxb2-trap');
assert.ok(!curatedTrapOpenings.some(opening => opening.id === quarantinedTrapStudies[0].id), 'A refuted imported punishment remains audited but cannot nominate book moves');
assert.equal(new Set(allTrapStudies.map(study => study.id)).size, allTrapStudies.length);
assert.equal(allTrapStudies.filter(study => study.provenance.license === 'MIT').length, 15);
for (const original of trapRepertoire) {
  const extended = allTrapStudies.find(study => study.id === original.id)!;
  assert.deepEqual(Object.fromEntries(Object.keys(original).map(key => [key, extended[key as keyof typeof extended]])), original,
    'The existing five calibrated records must not change');
}
for (const study of allTrapStudies) {
  const board = new Chess(); study.setup.forEach(san => board.move(san));
  assert.equal(board.fen(), study.rootFen); assert.equal(board.turn(), study.side);
  const bait = board.move(study.bait); assert.equal(`${bait.from}${bait.to}${bait.promotion ?? ''}`, study.baitUci);
  assert.equal(board.fen(), study.afterBaitFen); assert.equal(board.fen(), study.opening.fen);
  const mistake = board.move(study.temptingReply); assert.equal(`${mistake.from}${mistake.to}${mistake.promotion ?? ''}`, study.temptingReplyUci);
  assert.notEqual(mistake.color, study.side);
  study.punishment.forEach((san, index) => { const move = board.move(san); assert.equal(`${move.from}${move.to}${move.promotion ?? ''}`, study.punishmentUci[index]); });
  if (study.defensiveAlternative) {
    const alternative = study.defensiveAlternative; assert.equal(alternative.fen, study.afterBaitFen);
    const defense = new Chess(alternative.fen); assert.equal(defense.move(alternative.move).san, alternative.san);
    alternative.continuation.forEach((move, index) => assert.equal(defense.move(move).san, alternative.continuationSan[index]));
  }
  const opening = new Chess(); opening.loadPgn(study.opening.pgn); assert.equal(opening.fen(), study.opening.fen);
  assert.equal(study.verification, 'legal-replay-only');
}
const stafford = allTrapStudies.filter(study => study.family === 'stafford-gambit');
assert.equal(stafford.length, 2);
assert.deepEqual(stafford.map(study => study.bait), ['Nxe4', 'Nxe4']);
assert.deepEqual(stafford.map(study => study.temptingReply), ['Bxd8', 'dxe4']);
assert.ok(stafford.every(study => study.defensiveAlternative === undefined), 'An upstream decline from an earlier FEN must not be attached to the later lure');
assert.deepEqual(JSON.parse(JSON.stringify(deriveImportedStudies(source))), JSON.parse(await readFile('src/openings/importedTrapStudies.json', 'utf8')), 'Generated studies must reproduce exactly');
const broken = structuredClone(source); broken.traps[0].variations[0].mainLine[0].uci = 'a1a8';
assert.throws(() => auditTrapSource(broken), 'Illegal or mismatching source moves must fail validation');
console.log('Expanded trap library passed: pinned MIT source/license, all 20 source branches, 20 audited/19 selectable studies, exact roots, quarantine, original preservation and defensive alternatives.');
