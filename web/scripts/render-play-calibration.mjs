import { readFile, writeFile } from 'node:fs/promises';
const read = async (name) => JSON.parse(await readFile(`benchmarks/review/${name}.json`, 'utf8'));
const [positions, styles, games] = await Promise.all([read('play-calibration'), read('play-style-calibration'), read('play-paired-games')]);
const lines = [
  '# Play behavior evidence', '',
  `Generated ${new Date().toISOString()} from the three checked-in JSON reports.`, '',
  'This is a focused behavioral calibration. It does not establish an Elo or a population trap-success rate. A supplied opponent mistake is a punishment test; it is not evidence that the engine prepared or induced that mistake.', '',
  '## Release gate', '',
  `Overall gate: **${positions.gates.release ? 'PASS' : 'FAIL'}**. All 30 cases complete: ${positions.gates.complete}. Existing eight-case soundness: ${positions.gates.existingSoundness}. Supplied-mistake punishment: ${positions.gates.suppliedMistakePunishment}. Held-out tactical preservation: ${positions.gates.heldOutTacticalPreservation}. New independent risk violations: ${(positions.gates.independentRiskAudit ?? []).filter((row) => row.newViolation).length}. At least two new preparation cases: ${positions.gates.atLeastTwoNewPreparations}.`, '',
  `New search-only preparation successes versus frozen baseline: ${positions.gates.newSearchPreparation.join(', ') || 'none'}.`, '',
  `New book-assisted preparation successes versus frozen baseline: ${positions.gates.newBookPreparation.join(', ') || 'none'}. Book following uses the same selectable curated study entries as the app, with ordinary defensive risk verification.`, '',
  '## Method and provenance', '',
  positions.method, '', positions.preparationDefinition, '',
  'Every own setup move and the final bait must also stay within its applicable risk cap under the independent oracle. Matching a named setup alone is insufficient.', '',
  'The baseline is the exact pre-change engine and runtime source dependencies captured from release 83483e3c19632ed30490d22630dbd78dda389f33 in `benchmarks/review/play-baseline`, including the package lock and normalized source hashes. The current source, engine WASM, Maia model, opening catalogue, curated repertoire, source puzzle rows, settings and corpus hashes are recorded in the JSON. A changed engine cannot silently resume an old run.', '',
  'All candidate outcomes retain real human-policy mass. Omitted mass receives strongest-known-defense utility. The new own-continuation width is explicitly two in fresh Deep games, and remains one for old settings that omit it. Every compared own continuation gets its own defense search; the chosen continuation’s worst outcome contributes to root risk. No fixture IDs or trap-specific engine bonuses are used.', '',
  'The 30 cases comprise the original eight, ten preparation checkpoints at two/four plies before five trap families, six held-out CC0 Lichess supplied-mistake tactics, and six fixed-index CC0 Stockfish opening starts. Duplicate FENs with distinct roles are retained. Named dubious baits may correctly be rejected. Full source and legal replay annotations live in `benchmarks/play-corpus.ts`.', '',
  '| Case | Role | Baseline | New search | New + book |', '|---|---|---|---|---|',
];
for (const fixture of positions.corpus) {
  const cell = (configuration) => {
    const row = positions.rows.find((row) => row.id === fixture.id && row.configuration === configuration);
    return row ? `${row.decision.san} (${row.independent.riskCp}cp)` : '—';
  };
  lines.push(`| ${fixture.id} | ${fixture.role} | ${cell('baseline')} | ${cell('search')} | ${cell('book-assisted')} |`);
}
lines.push('', 'Cell numbers are defensive evaluation loss under the separate 16/15 oracle, not the selector’s forecast. All new search and book-assisted rows are audited against the 100cp normal / 40cp winning limits using the deeper oracle. Finite-search violations already present in the baseline are reported explicitly and cannot be worsened by the new selector. The six held-out tactical cases must preserve a baseline mate and remain within the greater of 50cp or the baseline’s independent loss; alternative moves can pass.', '',
  `Independent oracle risk outliers: ${(positions.gates.independentRiskOutliers ?? []).map((row) => `${row.id}/${row.configuration}: ${row.oracleRiskCp}cp versus ${row.limitCp}cp limit (baseline ${row.baselineOracleRiskCp}cp)`).join('; ') || 'none'}.`, '',
  '## Preparation checkpoints', '', '| Checkpoint | Baseline | Search only | Book assisted |', '|---|---|---|---|');
for (const fixture of positions.corpus.filter((row) => row.role === 'preparation')) {
  const cell = (configuration) => {
    const row = positions.preparations.find((row) => row.id === fixture.id && row.configuration === configuration);
    if (!row) return 'unavailable';
    if (row.success) return 'verified success';
    return [!row.selectedPath && 'different setup', !row.safePreparation && 'setup outside oracle risk', !row.nonBlundering && 'human continuation inaccurate',
      !row.safeBait && 'bait outside risk', !row.selectedBait && 'different bait decision',
      !row.verifiedPunishment && 'no verified immediate punishment'].filter(Boolean).join('; ');
  };
  lines.push(`| ${fixture.id} | ${cell('baseline')} | ${cell('search')} | ${cell('book-assisted')} |`);
}
lines.push('', '## Controls: zero, middle and maximum', '', styles.method, '',
  'Fixed-pool results are explicitly “among the searched candidates”: they re-rank the union from that example’s three runs without new discovery. End-to-end results run the selector again at each setting. These are different measurements. Unchanged moves are reported directly; a preference can alter a score without changing the winner. Variety uses one fixed draw, not an implied deterministic style.', '',
  '| Control | Zero | Middle | Maximum | Observation |', '|---|---|---|---|---|');
for (const example of styles.examples) lines.push(`| ${example.label} | ${example.levels[0].san} | ${example.levels[1].san} | ${example.levels[2].san} | ${example.noDifference ? 'chosen move unchanged' : 'chosen move changed'} |`);
lines.push('', 'The example budget is explicitly 8/7 with one human turn, not the full 12/10 release-corpus budget. Per-level settings, candidate pools, contributions, independent depth 14 checks and no-difference cases remain in `play-style-calibration.json`. Risk sliders use 0/150/300cp; percentage controls use 0/50/100%.', '',
  styles.interactionMethod ?? '', '',
  `The interaction report contains ${(styles.fixedPoolInteractions ?? []).length} fixed-pool setting combinations, each with three seeded draws, and ${(styles.endToEndInteractions ?? []).length} separate fresh searches.`, '',
  '## Paired games', '', games.method, '', games.caveat, '',
  '| Selector | Games | Own turns | Verified first-reply opportunities | Lure uptake | Punishment retained | Mean concession | Median turn latency |', '|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [name, value] of Object.entries(games.summary)) lines.push(`| ${name} | ${value.games} | ${value.engineTurns} | ${value.verifiedFirstReplyOpportunities} | ${value.lureUptake} | ${value.punishmentMaintained} | ${value.averageConcessionCp.toFixed(1)}cp | ${((value.medianDecisionLatencyMs ?? value.medianLatencyMs) / 1000).toFixed(1)}s |`);
lines.push('', 'The latency column uses the engine’s own decision diagnostics and excludes subsequent oracle validation. Separate validation-inclusive timings remain in the JSON. Wall time was observed on the development machine under other app/test activity, so this is not a controlled performance comparison. Full legal PGNs, draws, Maia probabilities, per-ply oracle scores and decision counters are retained. Opportunities requiring a second human error are not falsely counted as immediate lure uptake.', '',
  '## Reproduce', '', '```powershell', 'node node_modules/tsx/dist/cli.mjs scripts/calibrate-play.ts',
  'node node_modules/tsx/dist/cli.mjs scripts/calibrate-play-styles.ts',
  'node node_modules/tsx/dist/cli.mjs scripts/calibrate-play-games.ts', 'node scripts/render-play-calibration.mjs', '```', '',
  'Each collector persists completed work. Start a new position calibration with `--fresh` only when intentionally replacing the prior run. The deterministic fast safety suite is `scripts/test-play-engine.ts`; real calibration remains a release step because it is substantially slower.', '',
  'Data: [CC0 Lichess openings](https://github.com/lichess-org/chess-openings), [CC0 Lichess puzzles](https://database.lichess.org/#puzzles), [pinned Stockfish books](https://github.com/official-stockfish/books/tree/a804a97e709f40aa75a00f9d19e84915b7a3a45c). Original trap-study annotations remain separate from third-party prose.', '');
await writeFile('docs/play-calibration.md', lines.join('\n'));
