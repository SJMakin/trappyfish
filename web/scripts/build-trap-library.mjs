import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Chess } from 'chess.js';

export const upstream = {
  repository: 'https://github.com/jcabiles/chess-coach',
  revision: 'de21fd8bf93641840bda9df7875759f7c1124e00',
  sourceFile: 'data/traps.json',
  sourceSha256: '6c1d0ecaf6b75795064ddff657272969247957ab881d45923a5ce409f068dcfa',
  license: 'MIT',
  licenseSha256: '53aa072a9a9f29ee4aefa7877ab031391bdfc774def04ee1fb773179e1a5050b',
};
const duplicateFamilies = new Set(['legal-mate', 'blackburne-shilling-gambit', 'fishing-pole-trap', 'elephant-trap', 'englund-gambit-trap']);
const uci = move => `${move.from}${move.to}${move.promotion ?? ''}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceUrl = `${upstream.repository}/blob/${upstream.revision}/${upstream.sourceFile}`;

// Original summaries describe only what the legal sample line demonstrates.
// Upstream "forced", "commonness", result and engineNote claims are deliberately not imported.
const notes = {
  'fried-liver-attack': {
    motif: 'King exposure and piece activity',
    explanation: 'After the knight recapture on d5, White can sacrifice on f7 and develop with check. The illustrative continuation exposes Black’s king.',
    caution: 'This is an attacking study, not a proven forced win. Later king moves are choices. Black can choose a different defense before the recapture.',
  },
  'petrov-queen-trap': {
    motif: 'Discovered check and queen fork',
    explanation: 'Retreating the e4-knight clears the queen’s file. White can move the e5-knight with discovered check and attack the queen on d8.',
    caution: 'The alternative queen move avoids this displayed knight retreat. The captured queen belongs to the shown continuation, not every defense.',
  },
  'damiano-defense-trap': {
    motif: 'Exposed king and queen attack',
    explanation: 'Taking the offered knight opens a checking route for White’s queen. In the sample continuation the queen reaches h8.',
    caution: 'Other responses to the knight offer change the continuation. Material outcomes describe the displayed branch; compare the recorded best defense.',
  },
  'scholars-mate': {
    motif: 'Attack on f7 and mate',
    explanation: 'The queen on h5 and bishop on c4 both bear on f7. Developing the knight without meeting that threat permits the displayed mate.',
    caution: 'Black can meet the threat while attacking the queen. The early queen setup still receives the same risk verification as any other book move.',
  },
  'tennison-gambit-scandi': {
    motif: 'Piece offers and an open queen file',
    explanation: 'A knight capture on f7 followed by a bishop check can clear the d-file for White’s queen to reach d8.',
    caution: 'The king captures shown are choices, not universally forced replies. Different defenses can avoid the illustrated queen loss.',
  },
  'london-qxb2-trap': {
    motif: 'Queen chase and queen capture',
    explanation: 'The b2 capture invites a knight attack on the queen. Chasing the queen with Na4 and c3 produces the displayed queen-capture sequence.',
    caution: 'The line includes several later choices. Check the best defense before treating the initial pawn capture as losing.',
  },
  'stafford-gambit': {
    motif: 'Queen lure and mating net',
    explanation: 'In this later Stafford position, the knight move offers the queen. Taking that queen permits the displayed bishop attack.',
    caution: 'The earlier Nxc6 exchange is not classified as an error. This study starts at the later knight move; declining the queen offer changes the continuation.',
  },
  'lasker-trap': {
    motif: 'Underpromotion and queen recovery',
    explanation: 'The pawn on e3 can capture on f2 with check. The sample line includes a knight underpromotion on g1 followed by a bishop skewer.',
    caution: 'King and rook replies in this example are not all legally forced. Compare the recorded defensive alternatives rather than assuming the full sequence is compulsory.',
  },
  'noahs-ark-trap': {
    motif: 'Pawn advances and a bishop trap',
    explanation: 'After the queen recapture on d4, Black can gain space with c5 and restrict the bishop. The shown sequence eventually captures the a4-bishop.',
    caution: 'The queen and bishop moves shown form one continuation. The final bishop capture is conditional on those choices.',
  },
  'siberian-trap': {
    motif: 'Knight clearance and queen mate',
    explanation: 'A knight jump to d4 can divert the f3-knight and uncover the queen’s route to h2.',
    caution: 'Capturing the knight is an additional decision. The earlier h-pawn push and the later capture in the mating line are distinct choices.',
  },
  'kieninger-trap': {
    motif: 'Pin and knight mate',
    explanation: 'The knight recapture on e5 leaves a bishop available to take. Capturing that bishop opens the displayed knight jump to d3 with mate.',
    caution: 'The bishop capture is a choice. Use the alternative line or the best recorded defense to see how White can avoid the mate.',
  },
  'caro-kann-smothered-mate': {
    motif: 'Smothered mate and a pin',
    explanation: 'Black’s pieces restrict the king. The e7-pawn cannot capture the knight on d6 without exposing its king to the queen on e2.',
    caution: 'The same knight development is not a mistake in every Caro-Kann position. This motif depends on the exact queen placement and blocked king squares.',
  },
  'mortimer-trap': {
    motif: 'Pawn lure and knight recovery',
    explanation: 'Retreating the c6-knight to e7 makes e5 look available. Black can answer the capture with c6 and a queen check before recovering the knight.',
    caution: 'The bishop retreat and blocking move in this example are choices. A finite-depth defensive search is needed to assess the original knight retreat.',
  },
  'qga-b5-trap': {
    motif: 'Pawn capture and an open rook file',
    explanation: 'Development on c3 prepares a capture on b5. If Black advances the a-pawn and then captures the knight, the a-file opens for White’s rook.',
    caution: 'The rook capture depends on the later pawn recapture. That reply is illustrative rather than marked as forced.',
  },
};

/** Validate every upstream branch, including branches from duplicate families that we do not import. */
export function auditTrapSource(data) {
  assert.ok(Array.isArray(data.traps), 'Source must contain traps');
  const rows = [];
  const ids = new Set();
  for (const trap of data.traps) {
    assert.ok(!ids.has(trap.id), `Duplicate source ID ${trap.id}`); ids.add(trap.id);
    assert.ok(['white', 'black'].includes(trap.color));
    const lead = new Chess();
    for (const san of trap.leadInSan) assert.ok(lead.move(san), `${trap.id}: illegal lead-in ${san}`);
    assert.equal(new Chess(trap.startFen).fen(), lead.fen(), `${trap.id}: source FEN disagrees with replay`);
    const row = { sourceId: trap.id, leadInFenVerified: true, included: !duplicateFamilies.has(trap.id),
      excludedReason: duplicateFamilies.has(trap.id) ? 'Existing project study retained for this family.' : undefined,
      variations: [] };
    for (let variationIndex = 0; variationIndex < trap.variations.length; variationIndex++) {
      const variation = trap.variations[variationIndex]; const board = new Chess(lead.fen());
      const corrections = []; const unverifiedForcedClaims = []; let defensiveBranches = 0;
      for (let moveIndex = 0; moveIndex < variation.mainLine.length; moveIndex++) {
        const entry = variation.mainLine[moveIndex]; const before = board.fen();
        const sanBoard = new Chess(before); const bySan = sanBoard.move(entry.san);
        const byUci = board.move(entry.uci);
        assert.equal(uci(bySan), entry.uci, `${trap.id}: SAN/UCI disagree at ${entry.san}`);
        assert.equal(byUci.color, entry.side === 'trapper' ? trap.color[0] : trap.color[0] === 'w' ? 'b' : 'w', `${trap.id}: actor mismatch`);
        if (byUci.san !== entry.san) corrections.push({ moveIndex, suppliedSan: entry.san, canonicalSan: byUci.san });
        if (entry.forced) unverifiedForcedClaims.push({ moveIndex, canonicalSan: byUci.san, legalAlternatives: new Chess(before).moves().length - 1,
          resolution: 'The source flag is not imported. Forced tactical value requires independent engine evidence.' });
        if (entry.refutation) {
          const defense = new Chess(before); const alternateBySan = new Chess(before).move(entry.refutation.san);
          const alternate = defense.move(entry.refutation.uci);
          assert.equal(uci(alternateBySan), uci(alternate), `${trap.id}: defensive SAN/UCI mismatch`);
          if (alternate.san !== entry.refutation.san) corrections.push({ moveIndex, branch: 'decline', suppliedSan: entry.refutation.san, canonicalSan: alternate.san });
          for (const san of entry.refutation.declineSan ?? []) assert.ok(defense.move(san), `${trap.id}: illegal decline ${san}`);
          defensiveBranches++;
        }
      }
      row.variations.push({ variationIndex, moves: variation.mainLine.length, legalReplay: true, defensiveBranches, corrections, unverifiedForcedClaims });
    }
    rows.push(row);
  }
  return rows;
}

export function deriveImportedStudies(data) {
  const studies = [];
  for (const trap of data.traps.filter(trap => !duplicateFamilies.has(trap.id))) {
    assert.ok(notes[trap.id], `Missing original description for ${trap.id}`);
    for (let variationIndex = 0; variationIndex < trap.variations.length; variationIndex++) {
      const variation = trap.variations[variationIndex];
      // Nxc6 in the source Stafford line is sound. The meaningful lure is its later queen/knight offer.
      const mistakeIndex = trap.id === 'stafford-gambit' ? 6 : variation.mainLine.findIndex(entry => entry.bait === true && entry.side === 'victim');
      assert.ok(mistakeIndex >= 0, `${trap.id}: missing opponent opportunity`);
      const before = new Chess(); for (const san of trap.leadInSan) before.move(san);
      for (const entry of variation.mainLine.slice(0, mistakeIndex)) before.move(entry.uci);
      const fullPrefix = before.history({ verbose: true }); const bait = fullPrefix.at(-1);
      assert.equal(bait.color, trap.color[0], `${trap.id}: the last setup move must belong to the trapper`);
      const setup = fullPrefix.slice(0, -1).map(move => move.san);
      const root = new Chess(); setup.forEach(san => root.move(san));
      const rootFen = root.fen(); const baitPlayed = root.move(uci(bait)); const afterBaitFen = root.fen();
      const opening = { id: '', name: '', eco: trap.eco, pgn: root.pgn(),
        uci: root.history({ verbose: true }).map(uci), fen: afterBaitFen };
      const mistake = root.move(variation.mainLine[mistakeIndex].uci);
      assert.equal(mistake.color, trap.color[0] === 'w' ? 'b' : 'w');
      const punishment = []; const punishmentUci = [];
      for (const entry of variation.mainLine.slice(mistakeIndex + 1)) { const move = root.move(entry.uci); punishment.push(move.san); punishmentUci.push(uci(move)); }
      assert.ok(punishment.length, `${trap.id}: no response to the supplied mistake`);
      const sourceDefense = variation.mainLine[mistakeIndex].refutation;
      let defensiveAlternative;
      if (sourceDefense) {
        const defense = new Chess(afterBaitFen); const move = defense.move(sourceDefense.uci);
        const continuation = []; const continuationSan = [];
        for (const san of sourceDefense.declineSan ?? []) { const played = defense.move(san); continuation.push(uci(played)); continuationSan.push(played.san); }
        defensiveAlternative = { fen: afterBaitFen, move: uci(move), san: move.san, continuation, continuationSan, basis: 'source-decline' };
      }
      const staffordSuffix = trap.id === 'stafford-gambit' ? variationIndex === 0 ? ' · queen capture' : ' · knight capture' : '';
      const name = trap.name + staffordSuffix;
      const id = `trap-import-${trap.id}${trap.variations.length > 1 ? `-${variationIndex + 1}` : ''}`;
      opening.id = id; opening.name = `${name} · trap study`;
      const annotation = { ...notes[trap.id] };
      if (trap.id === 'stafford-gambit' && variationIndex === 1) {
        annotation.motif = 'Capture lure and queen loss';
        annotation.explanation = 'Capturing the offered knight allows a checking bishop move. The sample king capture then opens the route to White’s queen.';
        annotation.caution = 'The earlier Nxc6 exchange is not classified as an error. This study begins later; the following king capture is a separate choice in the illustrated line.';
      }
      studies.push({ id, name, eco: trap.eco, setup, bait: baitPlayed.san, temptingReply: mistake.san, punishment,
        ...annotation, source: sourceUrl, verification: 'legal-replay-only', opening, side: trap.color[0], family: trap.id,
        sourceId: trap.id, sourceVariation: variationIndex, rootFen, baitUci: uci(baitPlayed), afterBaitFen,
        temptingReplyUci: uci(mistake), punishmentUci, defensiveAlternative,
        provenance: { project: 'Chess Coach', revision: upstream.revision, url: sourceUrl, license: upstream.license, sourceSha256: upstream.sourceSha256 } });
    }
  }
  return studies;
}

export async function buildTrapLibrary() {
  const raw = await readFile('src/openings/source/chess-coach-traps.json');
  const license = await readFile('src/openings/source/chess-coach-LICENSE.txt');
  assert.equal(hash(raw), upstream.sourceSha256, 'Pinned source JSON changed');
  assert.equal(hash(license), upstream.licenseSha256, 'Pinned license changed');
  const data = JSON.parse(raw.toString('utf8')); const audit = auditTrapSource(data); const studies = deriveImportedStudies(data);
  const provenance = { version: 1, ...upstream, sourceUrl,
    licenseUrl: `${upstream.repository}/blob/${upstream.revision}/LICENSE`,
    licenseLocalPath: 'source/chess-coach-LICENSE.txt', sourceCount: data.traps.length, importedStudies: studies.length,
    originalStudies: 5, excludedSourceFamilies: [...duplicateFamilies],
    annotationPolicy: 'Original neutral project summaries; upstream forced/result/commonness/engineNote assertions are not copied as verified facts. Canonical SAN is derived from legal UCI replay.',
    studiesSha256: hash(JSON.stringify(studies)),
  };
  await writeFile('src/openings/importedTrapStudies.json', `${JSON.stringify(studies, null, 2)}\n`);
  await writeFile('src/openings/trapLibraryProvenance.json', `${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile('src/openings/trapImportAudit.json', `${JSON.stringify({ version: 1, sourceSha256: upstream.sourceSha256, sourceCount: data.traps.length,
    includedStudies: studies.length, rows: audit }, null, 2)}\n`);
  console.log(`Validated ${data.traps.length} source traps and every variation/decline; derived ${studies.length} new studies, retaining the original five.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildTrapLibrary();
