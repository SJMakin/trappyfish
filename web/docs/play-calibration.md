# Play behavior evidence

Generated 2026-11-02T00:09:08.476Z from the three checked-in JSON reports.

This is a focused behavioral calibration. It does not establish an Elo or a population trap-success rate. A supplied opponent mistake is a punishment test; it is not evidence that the engine prepared or induced that mistake.

## Release gate

Overall gate: **PASS**. All 30 cases complete: true. Existing eight-case soundness: true. Supplied-mistake punishment: true. Held-out tactical preservation: true. New independent risk violations: 0. At least two new preparation cases: true.

New search-only preparation successes versus frozen baseline: none.

New book-assisted preparation successes versus frozen baseline: blackburne-prepare-2, blackburne-prepare-4, fishing-pole-prepare-2, fishing-pole-prepare-4, elephant-prepare-2, elephant-prepare-4. Book following uses the same selectable curated study entries as the app, with ordinary defensive risk verification.

## Method and provenance

Actual cold-hash Stockfish 18 lite and Maia3. Selector 12/10, independent oracle 16/15. Fixed corpus, no fixture-specific engine logic.

Selected own setup moves reach the fixture bait within the applicable independent-oracle risk caps. Supplied human setup moves lose at most 100cp per move at depth 16; the tempting reply permits at least 80cp gain and the named first punishment is within 50cp of best. Baits outside the explicit risk budget are rejected, and permitted concessions are reported.

Every own setup move and the final bait must also stay within its applicable risk cap under the independent oracle. Matching a named setup alone is insufficient.

The baseline is the exact pre-change engine and runtime source dependencies captured from release 83483e3c19632ed30490d22630dbd78dda389f33 in `benchmarks/review/play-baseline`, including the package lock and normalized source hashes. The current source, engine WASM, Maia model, opening catalogue, curated repertoire, source puzzle rows, settings and corpus hashes are recorded in the JSON. A changed engine cannot silently resume an old run.

All candidate outcomes retain real human-policy mass. Omitted mass receives strongest-known-defense utility. The new own-continuation width is explicitly two in fresh Deep games, and remains one for old settings that omit it. Every compared own continuation gets its own defense search; the chosen continuation’s worst outcome contributes to root risk. No fixture IDs or trap-specific engine bonuses are used.

The 30 cases comprise the original eight, ten preparation checkpoints at two/four plies before five trap families, six held-out CC0 Lichess supplied-mistake tactics, and six fixed-index CC0 Stockfish opening starts. Duplicate FENs with distinct roles are retained. Named dubious baits may correctly be rejected. Full source and legal replay annotations live in `benchmarks/play-corpus.ts`.

| Case | Role | Baseline | New search | New + book |
|---|---|---|---|---|
| legal-sound | bait | Nxe5 (0cp) | Nxe5 (0cp) | Nxe5 (0cp) |
| legal-premature | best-defense | h3 (2cp) | h3 (2cp) | — |
| blackburne | bait | Nf6 (0cp) | Nf6 (0cp) | Nd4 (76cp) |
| fishing-pole | bait | h5 (0cp) | h5 (0cp) | h5 (0cp) |
| englund | bait | Qb4+ (10cp) | Qb4+ (10cp) | Qb4+ (10cp) |
| elephant | bait | exd5 (5cp) | exd5 (5cp) | exd5 (5cp) |
| mate-in-one | punishment | Qh4# (0cp) | Qh4# (0cp) | — |
| start | opening-control | e4 (1cp) | e4 (1cp) | — |
| legal-sound-prepare-2 | preparation | h3 (2cp) | h3 (2cp) | h3 (2cp) |
| legal-sound-prepare-4 | preparation | O-O (11cp) | O-O (11cp) | Nc3 (2cp) |
| blackburne-prepare-2 | preparation | Nf6 (5cp) | d5 (45cp) | Nc6 (2cp) |
| blackburne-prepare-4 | preparation | d5 (38cp) | d5 (38cp) | e5 (10cp) |
| fishing-pole-prepare-2 | preparation | Nd4 (39cp) | Nd4 (39cp) | Ng4 (83cp) |
| fishing-pole-prepare-4 | preparation | f5 (26cp) | f5 (26cp) | Nf6 (4cp) |
| englund-prepare-2 | preparation | Qe7 (13cp) | d6 (11cp) | Qe7 (13cp) |
| englund-prepare-4 | preparation | Nc6 (6cp) | Nc6 (6cp) | Nc6 (6cp) |
| elephant-prepare-2 | preparation | c5 (12cp) | c5 (12cp) | Nbd7 (9cp) |
| elephant-prepare-4 | preparation | c5 (12cp) | c5 (12cp) | Nf6 (0cp) |
| held-out-000Pw | punishment | Ne2+ (17cp) | Ne2+ (17cp) | — |
| held-out-0018S | punishment | Qa1 (26cp) | Qa1 (26cp) | — |
| held-out-000qP | punishment | Kf3 (0cp) | Kf3 (0cp) | — |
| held-out-001h8 | punishment | Qxh7+ (193cp) | Qxh7+ (193cp) | — |
| held-out-001XA | punishment | Rxb7 (0cp) | Rxb7 (0cp) | — |
| held-out-000Zo | punishment | Re1+ (0cp) | Re1+ (0cp) | — |
| book-control-23 | opening-control | Bb5+ (10cp) | Bb5+ (10cp) | — |
| book-control-431 | opening-control | e4 (6cp) | d3 (0cp) | — |
| book-control-1023 | opening-control | b3 (8cp) | b3 (8cp) | — |
| book-control-2047 | opening-control | e3 (17cp) | e3 (17cp) | — |
| book-control-4095 | opening-control | Bb2 (2cp) | Bb2 (2cp) | — |
| book-control-8191 | opening-control | Bg2 (7cp) | Bg2 (7cp) | — |

Cell numbers are defensive evaluation loss under the separate 16/15 oracle, not the selector’s forecast. All new search and book-assisted rows are audited against the 100cp normal / 40cp winning limits using the deeper oracle. Finite-search violations already present in the baseline are reported explicitly and cannot be worsened by the new selector. The six held-out tactical cases must preserve a baseline mate and remain within the greater of 50cp or the baseline’s independent loss; alternative moves can pass.

Independent oracle risk outliers: held-out-001h8/search: 193cp versus 100cp limit (baseline 193cp).

## Preparation checkpoints

| Checkpoint | Baseline | Search only | Book assisted |
|---|---|---|---|
| legal-sound-prepare-2 | human continuation inaccurate | human continuation inaccurate | human continuation inaccurate |
| legal-sound-prepare-4 | different setup; human continuation inaccurate | different setup; human continuation inaccurate | human continuation inaccurate |
| blackburne-prepare-2 | different setup; different bait decision | different setup; different bait decision | verified success |
| blackburne-prepare-4 | different setup; different bait decision | different setup; different bait decision | verified success |
| fishing-pole-prepare-2 | different setup | different setup | verified success |
| fishing-pole-prepare-4 | different setup | different setup | verified success |
| englund-prepare-2 | no verified immediate punishment | different setup; no verified immediate punishment | no verified immediate punishment |
| englund-prepare-4 | no verified immediate punishment | different setup; no verified immediate punishment | no verified immediate punishment |
| elephant-prepare-2 | different setup | different setup | verified success |
| elephant-prepare-4 | different setup | different setup | verified success |

## Controls: zero, middle and maximum

Actual Stockfish/Maia at explicit8/7 one-human-turn budget. End-to-end discovery may change the candidate pool; separately re-rank its union without new searches. Independent selector moves checked at depth14. A fixed random draw makes variety examples reproducible; it is not a style preset.

Fixed-pool results are explicitly “among the searched candidates”: they re-rank the union from that example’s three runs without new discovery. End-to-end results run the selector again at each setting. These are different measurements. Unchanged moves are reported directly; a preference can alter a score without changing the winner. Variety uses one fixed draw, not an implied deterministic style.

| Control | Zero | Middle | Maximum | Observation |
|---|---|---|---|---|
| Trappiness | g4 | g4 | g4 | chosen move unchanged |
| King attack | Nc3 | Nc3 | Nc3 | chosen move unchanged |
| Tension | h3 | h3 | h3 | chosen move unchanged |
| Pawn storms | Kb2 | Kb2 | Kb2 | chosen move unchanged |
| King caution | Nc3 | Nc3 | Nc3 | chosen move unchanged |
| Sacrifice appetite | g4 | Nxe5 | Nxe5 | chosen move changed |
| Sharpness | h5 | h5 | h5 | chosen move unchanged |
| Queen retention | h3 | h3 | h3 | chosen move unchanged |
| Draw aversion | Ke3 | Ke3 | Ke3 | chosen move unchanged |
| Variety | e4 | d4 | d4 | chosen move changed |
| Risk tolerance | h3 | h3 | Nxe5 | chosen move changed |
| Risk when winning | O-O-O | O-O-O | O-O-O | chosen move unchanged |

The example budget is explicitly 8/7 with one human turn, not the full 12/10 release-corpus budget. Per-level settings, candidate pools, contributions, independent depth 14 checks and no-difference cases remain in `play-style-calibration.json`. Risk sliders use 0/150/300cp; percentage controls use 0/50/100%.

Fixed pool from the independently measured300cp-risk example; only analyzed candidates.27 explicit trappiness/risk/variety combinations, three fixed LCG seeds after16 warmup iterations (1664525*s+1013904223 modulo2^32). Distinct from three fresh end-to-end interaction runs below.

The interaction report contains 27 fixed-pool setting combinations, each with three seeded draws, and 3 separate fresh searches.

## Paired games

Eight12-ply bounded games: paired baseline/new, Maia1000/1500, both engine colours, fixed seeds20261101/20261102. Same inverse-CDF draws at each human turn within a pair. Four held-out Stockfish book starts; no trap book following. Actual cold-hash Stockfish oracle14 after every ply. Full12/10 selectors, no model fallback permitted.

Exploratory paired integration evidence, too short and too small to estimate a win rate, Elo, or population lure uptake. Opportunity means selector-nominated bait with an independently >=80cp losing first reply; a nominated second-turn setup is not a first-turn mistake.

| Selector | Games | Own turns | Verified first-reply opportunities | Lure uptake | Punishment retained | Mean concession | Median turn latency |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 4 | 22 | 8 | 2 | 2 | 9.8cp | 16.0s |
| search | 4 | 22 | 9 | 2 | 2 | 9.8cp | 19.3s |

The latency column uses the engine’s own decision diagnostics and excludes subsequent oracle validation. Separate validation-inclusive timings remain in the JSON. Wall time was observed on the development machine under other app/test activity, so this is not a controlled performance comparison. Full legal PGNs, draws, Maia probabilities, per-ply oracle scores and decision counters are retained. Opportunities requiring a second human error are not falsely counted as immediate lure uptake.

## Reproduce

```powershell
node node_modules/tsx/dist/cli.mjs scripts/calibrate-play.ts
node node_modules/tsx/dist/cli.mjs scripts/calibrate-play-styles.ts
node node_modules/tsx/dist/cli.mjs scripts/calibrate-play-games.ts
node scripts/render-play-calibration.mjs
```

Each collector persists completed work. Start a new position calibration with `--fresh` only when intentionally replacing the prior run. The deterministic fast safety suite is `scripts/test-play-engine.ts`; real calibration remains a release step because it is substantially slower.

Data: [CC0 Lichess openings](https://github.com/lichess-org/chess-openings), [CC0 Lichess puzzles](https://database.lichess.org/#puzzles), [pinned Stockfish books](https://github.com/official-stockfish/books/tree/a804a97e709f40aa75a00f9d19e84915b7a3a45c). Original trap-study annotations remain separate from third-party prose.
