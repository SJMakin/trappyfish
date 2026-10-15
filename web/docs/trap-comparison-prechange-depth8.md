# Comparison completed before the production engine changed

Recorded 2026-10-13, 18:08:14–18:08:45 UTC. This report preserves the initial experimental implementation, including its failure to find the sound Légal sacrifice. Production `src/engine/trappy.ts` had SHA256 `F599E54ED4443BB5260FA617AE745344B32F5272F9DDD81A88BE76138B08AB28` at both the start and end. The frozen legacy copy is [`benchmarks/legacy-trappy.ts`](../benchmarks/legacy-trappy.ts), with only its UCI type import relocated; its SHA256 is `639B7DA7C27923553CC79CFD2FC3CAAB333D8E00685B13B700F94144E2DFAFDB`.

Raw decisions, every scored candidate, FENs, continuations, legal Maia probabilities, coverage and common outcome-oracle results are in [`compare-depth8.json`](../benchmarks/results/compare-depth8.json). A separate legacy-only run is in [`baseline-depth8.json`](../benchmarks/results/baseline-depth8.json). Neither report uses synthetic policy probabilities.

## Method

Both algorithms used root and trap depth 8. The old algorithm retained all original settings apart from those depths: six nominal candidates/replies, aggression 1.45, risk 170cp scaled by aggression. Its effective candidate budget is ten and its effective risk budget is 246.5cp. The experimental model used ten Stockfish root candidates plus up to four Maia root suggestions, ten opponent replies, a hard 100cp risk limit, aggression 1, 95% target reply coverage, opponent rating 1500 and engine rating 2000. Those differences are explicit: this is a comparison of the intended replacement defaults, not an isolated causal estimate of weighting alone.

Stockfish was the real npm `stockfish@18.0.8` Stockfish 18 lite single-thread WASM, identical to the browser engine family. The transposition table was cleared before every search so forced branch evaluations did not depend on preceding searches. Maia was the real local Maia3-5M ONNX model, with identical browser and Node encoding and legality masking. Model and WASM SHA256 hashes are recorded in JSON.

The shared comparison oracle independently evaluated each selected move: a forced root search at depth 8, opponent best defense and forced policy replies at depth 7, then `sigmoid(cp/200)` in the original mover's perspective. Terminal wins/draws use 1/0.5. Probabilities remain their full normalized legal-policy mass; the unsearched tail receives the strongest-defense score. The selected policy replies include Stockfish's best defense. The reported score is a bounded evaluation utility, **not an empirically calibrated game win rate**.

## Results

| Position | Legacy move | Maia-weighted move | Legacy utility | Maia utility | Maia evaluated coverage |
| --- | --- | --- | ---: | ---: | ---: |
| Légal after h3 / Bh5 | O-O | d3 | 0.553 | 0.620 | 95.9% |
| Premature Légal sacrifice | Bd5 | h3 | 0.528 | 0.584 | 97.2% |
| Blackburne Shilling bait | Be7 | Nf6 | 0.453 | 0.530 | 96.1% |
| Fishing Pole hook | h5 | h5 | 0.541 | 0.541 | 95.2% |
| Englund queen fork | b6 | Qb4+ | 0.300 | 0.499 | 98.8% |
| Elephant Trap recapture | exd5 | exd5 | 0.564 | 0.564 | 95.1% |
| Immediate mate control | Qh4# | Qh4# | 1.000 | 1.000 | 100% |
| Starting position | e4 | e4 | 0.560 | 0.560 | 95.7% |

On these eight fixtures, the replacement improved the shared modeled utility in four positions and tied in four; mean difference was +0.050. These few selected positions cannot establish broad playing strength. The experiment completed in 31 seconds on the test machine, including both selectors and separate oracle scoring.

## Findings that must guide the replacement

The initial shortlist misses **Nxe5 in the sound Légal position**. Maia assigns 55.7% to the losing queen capture Bxd1 and the shared oracle gives Nxe5 utility 0.867, substantially above d3. Nxe5 is absent from the experimental shortlist. Its depth-8 forced root evaluation is only +4cp whereas a depth-7 opponent search sees +158cp after it; finite-depth search instability and candidate omission both matter. A broader generic candidate search and deeper validation are required before considering the replacement good.

The superficially similar premature Nxe5 is objectively unsound: the shared strongest-defense score is −261cp and the experimental risk estimate is 255cp, so the hard 100cp budget rejects it despite Maia assigning 52.6% to Bxd1. A frequent blunder cannot justify arbitrary self-inflicted loss.

Blackburne's Nd4 is also not a mandatory success criterion: its common utility is 0.417, below the chosen Nf6 at 0.530. Nxe5 is assigned 28.9%, but the famous smothered mate requires an additional Nxf7 mistake; accepting the pawn does not itself force mate. The one-opponent-reply model intentionally avoids counting an entire cooperative trap line as certain.

Fishing Pole h5 produces a concrete policy-weighted opportunity: hxg4 has 47.2% probability and +168cp for Black after optimal continuation, with alternatives weighted separately. Both algorithms found h5 here. Elephant exd5 similarly has a 22.8% Nxd5 blunder leading to +341cp for Black. In Englund, Bd2 is the proper defense and has 55.2% probability; the replacement's gain comes from other plausible weaker defenses rather than assuming the full later mating sequence.

## Reproduce

```powershell
npx tsx scripts/benchmark-traps.ts --phase baseline --depth 8
npx tsx scripts/benchmark-traps.ts --phase compare --depth 8
```

The fixture definitions in [`trap-positions.ts`](../benchmarks/trap-positions.ts) legally validate every setup, candidate, tempting reply and continuation when imported. Sources include [the sound Légal move order](https://www.thechesswebsite.com/legal/), [Blackburne opening entry](https://www.chess.com/openings/Italian-Game-Blackburne-Shilling-Gambit-4.Nxe5-Qg5), [Fishing Pole tutorial](https://www.thechesswebsite.com/fishingpoletrap/), [Englund opening analysis](https://www.chess.com/openings/Englund-Gambit) and [Elephant Trap tutorial](https://www.thechesswebsite.com/elephant-trap/). These are fixtures, not a claim that choosing every named bait is strategically correct.
