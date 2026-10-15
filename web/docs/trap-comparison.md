# Trappyfish: legacy versus Maia-weighted outcomes

The replacement found the sound Légal sacrifice at depth 8, retained Fishing Pole and Elephant opportunities, rejected the unsound premature Légal sacrifice, and preferred the practical Englund queen check. At the new default depth 10, it matched the legacy selections in seven of eight fixtures and improved the shared modeled utility in Englund. These are focused regression benchmarks, not a playing-strength or Elo measurement.

## Evidence recorded before changing the production selector

The original selector was frozen in [`benchmarks/legacy-trappy.ts`](../benchmarks/legacy-trappy.ts). Its only edit is relocating a type import. Original production SHA256: `F599E54ED4443BB5260FA617AE745344B32F5272F9DDD81A88BE76138B08AB28`. Frozen legacy SHA256: `639B7DA7C27923553CC79CFD2FC3CAAB333D8E00685B13B700F94144E2DFAFDB`.

The first completed comparison, its initial failure, and unchanged-production checksum evidence are preserved in [`trap-comparison-prechange-depth8.md`](trap-comparison-prechange-depth8.md), [`compare-depth8.json`](../benchmarks/results/compare-depth8.json) and [`compare-depth10.json`](../benchmarks/results/compare-depth10.json).

The final verified experimental selector had SHA256 `85159E041B72D413D118ABD74CDFEBDA566C3BF2D4A2647E028BDAEDBFD897EE`. Final eight-fixture runs completed at 18:16:57 UTC (depth 8) and 18:17:38 UTC (depth 10) on 2026-10-13. **Both final reports record the unchanged original production hash at the start and end.** Production promotion followed these comparisons.

Final raw reports contain all candidate/reply scores, legal probabilities, search settings, full FENs, SAN/UCI moves, coverage, timings and model/binary checksums:

- [`compare-verified-depth8.json`](../benchmarks/results/compare-verified-depth8.json)
- [`compare-verified-depth10.json`](../benchmarks/results/compare-verified-depth10.json)

After promotion, [`production-depth10.json`](../benchmarks/results/production-depth10.json) reran the full eight-fixture suite against the actual live `src/engine/trappy.ts`. It completed at 18:21:38 UTC. Every selected UCI move, modeled expected score, verified risk and policy source matched the pre-change experimental depth-10 report exactly. The live source SHA256 was `34CCA92B66270E901CD47F636F35AEA91F83E3D225C925D0ABA40AF93865CC7D` at both the start and end. This production run also asserted legal selections through oracle evaluation, bounded outcome scores, actual Maia use in nonterminal decisions, and adherence to the independent risk limit.

## FlawChess reference and search design

[FlawChess](https://github.com/flawchess/flawchess) combines Maia's human move probabilities with Stockfish evaluation to rank moves by practical expected score. Its [expectimax reference](https://github.com/flawchess/flawchess/blob/main/frontend/src/lib/engine/fallbackExpectimax.ts) uses a fixed root-player perspective, bounded score conversion, exact terminal outcomes and probability-weighted backups. This project implements its own simpler search: one modeled opponent reply, followed by optimal Stockfish continuation. It does not reproduce FlawChess's full multi-ply expectimax/MCTS allocator.

For a root move, the replacement predicts legal opponent replies with **the real Maia3-5M ONNX model**, conditioned on opponent and engine ratings. Stockfish scores the resulting continuations. The ranking utility is a weighted sum of bounded outcome scores:

```text
outcome(cp) = 1 / (1 + exp(-cp / 200))
expected = sum(reply_probability * outcome_after_reply)
         + unsearched_probability * strongest_known_defense_outcome
ranking  = objective + aggression * (expected - objective)
```

Actual mate/draw outcomes use 1/0/0.5, and engine-reported mate scores saturate. This prevents a rare mate branch from dominating ordinary outcomes through an artificial 100,000cp magnitude. The sigmoid is an evaluation transform; it is **not a calibrated forecast of a human player's game result**.

Search evaluates the highest-probability replies up to 95% coverage or ten replies, always adding Stockfish's strongest defense if omitted. It retains the true mass of evaluated replies and gives the tail a conservative value. It never normalizes a truncated top-k set to 100%.

The root shortlist combines the top ten Stockfish candidates, up to four Maia suggestions, and **every legal capture, check and promotion**. This lets the engine execute uncommon tactical moves that a human policy might not suggest. Maia determines opponent likelihoods; there is no trap book or expected-SAN condition in the selector.

Each candidate's objective baseline is the minimum of its root score, the strongest-defense score and every evaluated forced reply outcome. Risk uses the best consistently verified objective baseline. If verification changes that reference, the search evaluates newly eligible candidates before choosing. Aggression never enlarges the independent 100cp risk budget.

Model metadata, exact pinned source, license, encoding and limitations are documented in [`public/maia/README.md`](../public/maia/README.md). Standalone FENs repeat the current board in eight history slots, matching the official Maia UCI no-history mode. Maia predictions model populations of players, not a particular person's decisions.

## Benchmark method

The engine was actual Stockfish 18 lite single-thread WASM from `stockfish@18.0.8`. The npm WASM and the app's public WASM have the identical SHA256 `A8FBC05EC6920B56D7485826DCB02C5FFD2826BCBF751CF973046F237A9096F1`. The benchmark clears its transposition table before each analysis, so preceding searches do not change forced outcome results.

Both selectors used the same root/trap depths in each comparison. Legacy settings preserved the old defaults apart from depth: six nominal root/reply candidates, aggression 1.45, 170cp configured risk scaled by aggression, and score-drop/temptation bonuses. Its effective root budget is ten and effective risk limit is 246.5cp. New settings used ten nominal root/reply candidates plus generic forcing additions, aggression 1, an independent 100cp risk limit, target reply coverage 95%, opponent rating 1500 and engine rating 2000. This compares the intended replacement to the previous settings; it does not isolate one mathematical change while holding all other budgets constant.

The **shared comparison oracle** independently scores both selected moves under identical Maia probabilities and cold Stockfish searches. A forced root score is recorded at depth N; strongest defense and forced reply continuations are evaluated at depth N−1 from the opponent-to-move position. All utilities use the original mover's perspective. The oracle's unsearched tail uses its strongest-defense evaluation; the selector itself additionally takes the conservative minimum across the root and forced replies. Every nonterminal new decision asserts that actual Maia was used. Model failure cannot masquerade as a successful benchmark.

Fixture setups, candidate moves, tempting replies and full illustrative lines are legally validated by chess.js in [`trap-positions.ts`](../benchmarks/trap-positions.ts). Named trap moves are separately evaluated for diagnosis; selecting a dubious bait is not automatically a success.

## Final results

Each utility pair is legacy → replacement, scored by the shared oracle.

| Position | Depth 8 move | Depth 8 utility | Depth 10 move | Depth 10 utility |
| --- | --- | ---: | --- | ---: |
| Sound Légal after h3 / Bh5 | O-O → Nxe5 | 0.553 → 0.867 | Nxe5 → Nxe5 | 0.866 → 0.866 |
| Premature Légal sacrifice | Bd5 → h3 | 0.528 → 0.584 | h3 → h3 | 0.582 → 0.582 |
| Blackburne Shilling bait | Be7 → Nf6 | 0.453 → 0.530 | Nf6 → Nf6 | 0.509 → 0.509 |
| Fishing Pole hook | h5 → h5 | 0.541 → 0.541 | h5 → h5 | 0.529 → 0.529 |
| Englund queen fork | b6 → Qb4+ | 0.300 → 0.499 | f6 → Qb4+ | 0.331 → 0.441 |
| Elephant Trap recapture | exd5 → exd5 | 0.564 → 0.564 | exd5 → exd5 | 0.566 → 0.566 |
| Immediate mate control | Qh4# → Qh4# | 1.000 → 1.000 | Qh4# → Qh4# | 1.000 → 1.000 |
| Starting-position control | e4 → e4 | 0.560 → 0.560 | e4 → e4 | 0.557 → 0.557 |

Depth 8: four higher modeled utilities and four ties; mean difference +0.0809. Depth 10: one higher modeled utility and seven ties; mean difference +0.0137. All final selected moves are legal and within the configured risk limit. Nonterminal selected-move coverage is 95.1–98.8%; immediate mate bypasses the model. These eight positions are too few to infer general superiority or an Elo increase.

## What the comparisons exposed

The **first replacement was worse in the sound Légal position at depth 10**: legacy found Nxe5 while the initial Maia shortlist chose d3 (0.866 versus 0.617). The move was missing from the new candidate set. Expanding all captures/checks/promotions fixed this without adding any opening-specific condition. At depth 8, Nxe5 is strongly undervalued by one Stockfish root search (+4cp versus +158cp from its opponent search), which also illustrates finite-depth uncertainty. The final method still finds it.

In sound Légal, Maia assigns 55.7% to Bxd1, which Stockfish identifies as mate for White. In the premature version, Maia assigns 52.6% to the same losing queen capture, but Black can instead win material with Nxe5. The replacement rejects the unsound sacrifice even though its modeled payoff can look attractive.

Blackburne Nd4 is intentionally not forced: its depth-10 shared utility is only 0.405 versus Nf6 at 0.509. Maia gives Nxe5 28.9%, but the famous mating line needs a further Nxf7 mistake. A one-reply model cannot treat the entire cooperative sequence as certain. This is a documented limit, not a missing mate recognition claim.

Fishing Pole h5 tempts hxg4 with 47.2% Maia probability. Elephant exd5 tempts Nxd5 with 22.8%. The engine scores their consequences rather than relying on shallow score drops. Englund's Qb4+ has a 55.2% Bd2 probability, but Bd2 is the proper defense. Its practical gain comes from plausible weaker alternatives, including Nc3, c3 and Nbd2. At depth 10 its verified risk is 62cp relative to the consistently evaluated best alternative.

A short deeper probe at depth 12, before the final risk refinement, found Nxe5 in sound Légal with both engines and Qb4+ in Englund with the replacement versus d6 with legacy; raw details are in [`compare-widened-depth12.json`](../benchmarks/results/compare-widened-depth12.json). Depth-12 is a sensitivity check, not a complete final-default benchmark.

## Reproduce

Run from the repository root after installing dependencies. Give reruns their own output names to preserve the original evidence.

```powershell
npx tsx scripts/benchmark-traps.ts --phase compare --depth 8 --output benchmarks/results/rerun-depth8.json
npx tsx scripts/benchmark-traps.ts --phase compare --depth 10 --output benchmarks/results/rerun-depth10.json
npx tsx scripts/benchmark-traps.ts --phase production --depth 10 --output benchmarks/results/production-depth10.json
npx tsx scripts/benchmark-traps.ts --phase compare --depth 12 --positions "legal-sound,englund" --output benchmarks/results/rerun-depth12.json
```

`--phase baseline` runs only the frozen legacy selector. `--phase compare` runs the frozen legacy selector versus the experimental scorer preserved in `benchmarks/practical.ts`; `--phase production` imports the promoted live selector.

Fixture references: [Légal's sound move order](https://www.thechesswebsite.com/legal/), [Blackburne Shilling opening entry](https://www.chess.com/openings/Italian-Game-Blackburne-Shilling-Gambit-4.Nxe5-Qg5), [Fishing Pole tutorial](https://www.thechesswebsite.com/fishingpoletrap/), [Englund opening analysis](https://www.chess.com/openings/Englund-Gambit), and [Elephant Trap tutorial](https://www.thechesswebsite.com/elephant-trap/).
