# Trap library evidence

Generated 2026-11-06T18:05:37.688Z. 20 audited studies; 19 selectable studies.

The expansion adapts a pinned [Chess Coach dataset](https://github.com/jcabiles/chess-coach/blob/de21fd8bf93641840bda9df7875759f7c1124e00/data/traps.json) at revision `de21fd8bf93641840bda9df7875759f7c1124e00`, with its [MIT license](https://github.com/jcabiles/chess-coach/blob/de21fd8bf93641840bda9df7875759f7c1124e00/LICENSE) preserved. Original source bytes, annotation audit, derived study data and hashes are checked in. The five original Trappyfish studies are retained without modifying their calibrated source file.

Imported source descriptions were treated as hypotheses. Legal replay establishes that a sequence can occur; it does not prove that a move is forced, that the bait is sound or that a human would choose the reply. Source engine assessments and informal popularity ratings are not adopted as verified facts.

## Independent engine checks

Cold-hash depth-16 unrestricted root, forced bait, strongest reply, forced illustrative reply, and unrestricted/forced first-punishment searches. Scores refer to the trapper; reply loss compares searches of the same post-bait position. Source decline lines are replayed independently and scored as optional alternatives, not presumed best defenses.

Independent finite-depth samples, not mathematical proofs, full-line forcedness checks or measured human lure rates. The live engine still verifies every book move using the chosen game settings.

Every row has its own before-bait, after-bait and after-illustrative-reply position. Evaluation loss compares the unrestricted and forced searches for the same mover and position. Positive bait concession means the bait gives up objective evaluation; the actual game engine still uses its explicit chosen risk cap. A move allowed at 100cp may be rejected at zero risk.

| Study | Availability | Bait concession | Best searched defense | Illustrative reply loss | First punishment concession | Caveats |
|---|---|---:|---|---|---|---:|
| trap-legal | selectable | 0cp | Nxe5 | allows searched mate | retains searched mate | 0 |
| trap-blackburne | selectable | 76cp | Nxd4 | 141cp | 0cp | 1 |
| trap-fishing-pole | selectable | 0cp | d4 | 361cp | 0cp | 0 |
| trap-englund | selectable | 0cp | Bd2 | 0cp | 30cp | 2 |
| trap-elephant | selectable | 9cp | e3 | 352cp | 10cp | 0 |
| trap-import-fried-liver-attack | selectable | 7cp | Na5 | 109cp | 0cp | 0 |
| trap-import-petrov-queen-trap | selectable | 0cp | Qe7 | 416cp | 0cp | 0 |
| trap-import-damiano-defense-trap | selectable | 0cp | Qe7 | 147cp | 51cp | 1 |
| trap-import-scholars-mate | selectable | 61cp | Qe7 | allows searched mate | retains searched mate | 0 |
| trap-import-tennison-gambit-scandi | selectable | 0cp | Nc6 | 335cp | 12cp | 0 |
| trap-import-london-qxb2-trap | quarantined | 6cp | e6 | 192cp | 399cp | 2 |
| trap-import-stafford-gambit-1 | selectable | 0cp | Qe2 | allows searched mate | retains searched mate | 0 |
| trap-import-stafford-gambit-2 | selectable | 132cp | dxe4 | 28cp | 0cp | 1 |
| trap-import-lasker-trap | selectable | 28cp | fxe3 | 486cp | 0cp | 0 |
| trap-import-noahs-ark-trap | selectable | 6cp | c3 | 232cp | 29cp | 0 |
| trap-import-siberian-trap | selectable | 13cp | Rd1 | 267cp | 13cp | 1 |
| trap-import-kieninger-trap | selectable | 0cp | Nxe5 | allows searched mate | retains searched mate | 0 |
| trap-import-caro-kann-smothered-mate | selectable | 30cp | Ndf6 | allows searched mate | retains searched mate | 0 |
| trap-import-mortimer-trap | selectable | 20cp | d4 | 183cp | 0cp | 0 |
| trap-import-qga-b5-trap | selectable | 0cp | Qb6 | 82cp | 5cp | 0 |

The first-punishment column checks the first own response after the illustrative reply. Remaining source moves are a legal illustrative continuation, not a proof of optimal play on every ply. A displayed checkmate is the final result of that supplied legal line; it is labelled separately from a mate found against strongest searched defense.

## Quarantine and source limitations

- **trap-import-london-qxb2-trap**: The source’s first illustrative punishment loses about four pawns against the independently searched best continuation. Retained for audit, excluded from the playable catalogue.

The raw and derived London study remain available for audit, but it is omitted from the selectable opening book and trap browser. This keeps the source record intact without recommending its poor illustrative continuation.

Englund’s first supplied reply is a correct defense under the sampled search, and the second Stafford study’s named reply loses little evaluation. Their model probabilities therefore describe the chance of a reply, not the chance of a mistake. Additional inaccuracies may be required later. Minor finite-search disagreement is also retained rather than rounded away.

## Human choices and model references

Observed source: [Lichess Opening Explorer](https://lichess.org/api#tag/Opening-Explorer), endpoint `https://explorer.lichess.org/lichess`, rated rapid with rating buckets 1000, 1200, 1400, 1600 (1000–1799), collected 2026-11-02T22:58:51.948Z.

0/20 observed-frequency samples are available. The unauthenticated endpoint returned HTTP 401 during collection; subsequent requests were skipped. No credentials were read, requested or stored. Unavailable counts and probabilities remain null. Missing replies in a limited top-move list also have unknown counts; child-position counts are never substituted because transpositions would change the denominator.

Separate [Maia-3](https://www.maiachess.com/) references use actual local model inference with SHA256 `f7bd01b3e41dceb5e93eb9f4c61e9c4db8b35411effd1d8c984b006cd74bb804`, fixed human-model ratings 1000 and 1400 and engine rating 2400. The same legal mask and encoding are used as in the app. These are conditional model estimates at the position after the bait, not observed frequencies, whole-game trap success rates or calibrated predictions about a particular player. They do not change the active game controls.

| Study | Maia 1000 reply estimate | Maia 1400 reply estimate |
|---|---:|---:|
| trap-legal | 43.9% | 47.3% |
| trap-blackburne | 36.5% | 31.0% |
| trap-fishing-pole | 66.2% | 54.2% |
| trap-englund | 30.8% | 48.8% |
| trap-elephant | 16.9% | 17.7% |
| trap-import-fried-liver-attack | 63.8% | 46.2% |
| trap-import-petrov-queen-trap | 13.9% | 18.9% |
| trap-import-damiano-defense-trap | 89.1% | 82.3% |
| trap-import-scholars-mate | 15.7% | 10.1% |
| trap-import-tennison-gambit-scandi | 33.4% | 39.1% |
| trap-import-london-qxb2-trap | 36.8% | 41.3% |
| trap-import-stafford-gambit-1 | 63.3% | 66.1% |
| trap-import-stafford-gambit-2 | 73.8% | 74.7% |
| trap-import-lasker-trap | 41.2% | 35.4% |
| trap-import-noahs-ark-trap | 56.0% | 71.9% |
| trap-import-siberian-trap | 30.3% | 37.3% |
| trap-import-kieninger-trap | 55.2% | 52.2% |
| trap-import-caro-kann-smothered-mate | 32.0% | 46.8% |
| trap-import-mortimer-trap | 39.5% | 40.8% |
| trap-import-qga-b5-trap | 22.6% | 34.3% |

## Real book-selector checks

The original 30-case engine calibration and source hashes remain unchanged. These focused checks add actual Stockfish selection tests for newly imported, selectable content. They use the ordinary engine entry point with human-model preferences disabled, retain the game risk cap, and verify that no policy call is made.

| New study | Required behavior | Actual choice | Selected risk | Result |
|---|---|---|---:|---|
| trap-import-petrov-queen-trap | accept-book | Qe2 | 0cp | pass |
| trap-import-stafford-gambit-2 | reject-book | Bxf2+ | 0cp | pass |

## Reproduce

```powershell
node node_modules/tsx/dist/cli.mjs scripts/verify-trap-library.ts
node node_modules/tsx/dist/cli.mjs scripts/sample-trap-model.ts
node node_modules/tsx/dist/cli.mjs scripts/sample-trap-humans.ts
node scripts/render-trap-library-evidence.mjs
```

Stockfish queries are cached by full FEN, forced move, depth and engine WASM checksum. Model samples retain their actual inference timestamps. Cached observations remain dated snapshots; `--fresh` explicitly reacquires human statistics or model samples. Authentication failures stop further calls, and HTTP 429 produces a cooldown of at least one minute respecting longer Retry-After values. No game or opening browse performs these offline collection calls.

Study-input SHA256: `23f7df4e15ac9d12c81794c40ee3a1c1977b9b0905c1525f03504427c717f8b8`. Engine WASM SHA256: `a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1`. Selection-policy SHA256: `3f807f530334ee270b2dfaf862bb3c40ca967244d862457d8572716cdf8edda6`. Original trap source, snapshot source data and model references retain their separate hashes.
