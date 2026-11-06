import { readFile, writeFile } from 'node:fs/promises';
const read = async name => JSON.parse(await readFile(`src/openings/${name}.json`, 'utf8'));
const [verification, humans, models, source] = await Promise.all([
  read('trapLibraryVerification'), read('trapHumanSamples'), read('trapModelSamples'), read('trapLibraryProvenance'),
]);
const percent = sample => sample?.status === 'available' ? `${(sample.modelProbability * 100).toFixed(1)}%` : 'unavailable';
const cp = value => Math.abs(value) >= 90000 ? 'mate outcome' : `${Math.round(value)}cp`;
const quarantine = new Set((verification.quarantinedStudies ?? []).map(study => study.id));
const lines = ['# Trap library evidence', '',
  `Generated ${new Date().toISOString()}. ${verification.positions.length} audited studies; ${verification.selectableStudyIds?.length ?? verification.positions.length} selectable studies.`, '',
  `The expansion adapts a pinned [Chess Coach dataset](${source.sourceUrl}) at revision \`${source.revision}\`, with its [MIT license](${source.licenseUrl}) preserved. Original source bytes, annotation audit, derived study data and hashes are checked in. The five original Trappyfish studies are retained without modifying their calibrated source file.`, '',
  'Imported source descriptions were treated as hypotheses. Legal replay establishes that a sequence can occur; it does not prove that a move is forced, that the bait is sound or that a human would choose the reply. Source engine assessments and informal popularity ratings are not adopted as verified facts.', '',
  '## Independent engine checks', '', verification.method, '', verification.caveat, '',
  'Every row has its own before-bait, after-bait and after-illustrative-reply position. Evaluation loss compares the unrestricted and forced searches for the same mover and position. Positive bait concession means the bait gives up objective evaluation; the actual game engine still uses its explicit chosen risk cap. A move allowed at 100cp may be rejected at zero risk.', '',
  '| Study | Availability | Bait concession | Best searched defense | Illustrative reply loss | First punishment concession | Caveats |',
  '|---|---|---:|---|---|---|---:|',
];
for (const row of verification.positions) lines.push(`| ${row.id} | ${quarantine.has(row.id) ? 'quarantined' : 'selectable'} | ${cp(row.riskCp)} | ${row.bestDefenseSan} | ${row.temptingReplyAllowsMate ? 'allows searched mate' : cp(row.temptingReplyLossCp)} | ${row.punishmentKeepsMate ? 'retains searched mate' : cp(row.punishmentRiskCp)} | ${row.warnings.length} |`);
lines.push('', 'The first-punishment column checks the first own response after the illustrative reply. Remaining source moves are a legal illustrative continuation, not a proof of optimal play on every ply. A displayed checkmate is the final result of that supplied legal line; it is labelled separately from a mate found against strongest searched defense.', '',
  '## Quarantine and source limitations', '');
for (const study of verification.quarantinedStudies ?? []) lines.push(`- **${study.id}**: ${study.reason}`);
lines.push('', 'The raw and derived London study remain available for audit, but it is omitted from the selectable opening book and trap browser. This keeps the source record intact without recommending its poor illustrative continuation.', '',
  'Englund’s first supplied reply is a correct defense under the sampled search, and the second Stafford study’s named reply loses little evaluation. Their model probabilities therefore describe the chance of a reply, not the chance of a mistake. Additional inaccuracies may be required later. Minor finite-search disagreement is also retained rather than rounded away.', '',
  '## Human choices and model references', '',
  `Observed source: [Lichess Opening Explorer](${humans.source}), endpoint \`${humans.endpoint}\`, rated rapid with rating buckets ${humans.ratings.join(', ')} (1000–1799), collected ${humans.createdAt}.`, '',
  `${humans.positions.filter(row => row.status === 'available').length}/${humans.positions.length} observed-frequency samples are available. The unauthenticated endpoint returned HTTP 401 during collection; subsequent requests were skipped. No credentials were read, requested or stored. Unavailable counts and probabilities remain null. Missing replies in a limited top-move list also have unknown counts; child-position counts are never substituted because transpositions would change the denominator.`, '',
  `Separate [Maia-3](https://www.maiachess.com/) references use actual local model inference with SHA256 \`${models.modelSha256}\`, fixed human-model ratings ${models.humanRatings.join(' and ')} and engine rating ${models.engineRating}. The same legal mask and encoding are used as in the app. These are conditional model estimates at the position after the bait, not observed frequencies, whole-game trap success rates or calibrated predictions about a particular player. They do not change the active game controls.`, '',
  '| Study | Maia 1000 reply estimate | Maia 1400 reply estimate |', '|---|---:|---:|');
for (const row of verification.positions) lines.push(`| ${row.id} | ${percent(models.positions.find(sample => sample.id === row.id && sample.opponentRating === 1000))} | ${percent(models.positions.find(sample => sample.id === row.id && sample.opponentRating === 1400))} |`);
lines.push('', '## Real book-selector checks', '',
  'The original 30-case engine calibration and source hashes remain unchanged. These focused checks add actual Stockfish selection tests for newly imported, selectable content. They use the ordinary engine entry point with human-model preferences disabled, retain the game risk cap, and verify that no policy call is made.', '',
  '| New study | Required behavior | Actual choice | Selected risk | Result |', '|---|---|---|---:|---|');
for (const probe of verification.selectionChecks) lines.push(`| ${probe.id} | ${probe.expected} | ${probe.chosenSan} | ${cp(probe.selectedRiskCp)} | ${probe.passed ? 'pass' : 'fail'} |`);
lines.push('', '## Reproduce', '', '```powershell',
  'node node_modules/tsx/dist/cli.mjs scripts/verify-trap-library.ts',
  'node node_modules/tsx/dist/cli.mjs scripts/sample-trap-model.ts',
  'node node_modules/tsx/dist/cli.mjs scripts/sample-trap-humans.ts',
  'node scripts/render-trap-library-evidence.mjs', '```', '',
  'Stockfish queries are cached by full FEN, forced move, depth and engine WASM checksum. Model samples retain their actual inference timestamps. Cached observations remain dated snapshots; `--fresh` explicitly reacquires human statistics or model samples. Authentication failures stop further calls, and HTTP 429 produces a cooldown of at least one minute respecting longer Retry-After values. No game or opening browse performs these offline collection calls.', '',
  `Study-input SHA256: \`${verification.sourceSha256}\`. Engine WASM SHA256: \`${verification.engineSha256}\`. Selection-policy SHA256: \`${verification.selectionPolicySha256}\`. Original trap source, snapshot source data and model references retain their separate hashes.`, '');
await writeFile('docs/trap-library-evidence.md', lines.join('\n'));
