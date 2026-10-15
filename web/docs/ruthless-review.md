# Ruthless default: UI intent and trap quality evidence

The default targets a 1000-rated opponent, uses full practical aggression, and examines two opponent replies. Stockfish searches the root at depth 12 and verifies outcomes at depth 10. The independent risk budget stays 100cp, tightening to 40cp once the objective best move is at least +500cp. Engine rating 2400 conditions Maia's opponent predictions; it is a configuration input, not a measured Trappyfish Elo.

The previous engine was frozen byte for byte before this review at `benchmarks/review/baseline-trappy.ts`, SHA256 `34CCA92B66270E901CD47F636F35AEA91F83E3D225C925D0ABA40AF93865CC7D`. The reviewed production source was `A5E3AD63931B511AA1EA12E0D0350A3E648B760DDCB9EE7C9F64338829FEF9DF` at both comparison start and end.

## Rating and depth review before selection changes

The frozen selector ran all eight fixtures at opponent ratings 800, 1000, 1200 and 1500, plus 1000 with root depth 12 / outcome depth 10: 40 real decisions using the shipped Maia ONNX model and Stockfish WASM. Seven fixtures chose the same move under all settings. Blackburne changed from Nf6 at 1500 to f5 at 800/1000/1200 with depth 10. A deeper independent oracle gave f5 utility 0.518 versus Nf6 0.522, despite f5's much larger modeled mistake mass. Root depth 12 restored Nf6. This supports 1000 with the deeper root search; lowering the modeled rating alone did not establish stronger play.

These are focused diagnostics, not game results, an Elo estimate, or evidence of broad superiority. The eight final root selections match the frozen default. The new behavior is lower-rated reply conditioning, additional trap-chain analysis, explicit punishment forecasts and safer conversion when winning.

## Independent default comparison

Both selected moves are checked by one shared Maia 1000/2400 and cold Stockfish oracle. The first chance oracle uses root depth 12 and opponent depth 11, up to ten replies or 95% coverage, always including strongest defense. The second chance oracle extends the three largest non-mate first branches along Stockfish's preferred continuation, using root depth 10 and opponent depth 9 with up to ten replies or 95% coverage plus strongest defense. This is wider than production's four second replies. Both keep true probabilities and give all unsearched mass conservative defense utility.

Utility is `sigmoid(cp / 200)`, with exact terminal values 0/0.5/1. It is a bounded evaluation transform, not calibrated game win probability. “Mistake mass” is the searched probability of an outcome more than 100cp better for the engine than strongest known defense, over one or two opponent replies. It excludes unknown tail outcomes. Independent root risk compares the depth-12 root best with the candidate's conservative root/defense/forced-reply baseline.

| Position | Frozen → new move | One → two chance root risk | One → two chance utility | One → two chance mistake mass | New selection time |
| --- | --- | ---: | ---: | ---: | ---: |
| Légal after h3 / Bh5 | Nxe5 → Nxe5 | 11 → 11cp | 0.832 → 0.867 | 43.9% → 53.2% | 7.54s |
| Premature Légal sacrifice | h3 → h3 | 0 → 0cp | 0.581 → 0.633 | 0.0% → 10.8% | 14.86s |
| Blackburne Shilling bait | Nf6 → Nf6 | 8 → 18cp | 0.526 → 0.536 | 12.1% → 16.9% | 5.37s |
| Fishing Pole hook | h5 → h5 | 6 → 25cp | 0.604 → 0.757 | 67.2% → 86.0% | 3.34s |
| Englund queen fork | Qb4+ → Qb4+ | 79 → 95cp | 0.528 → 0.660 | 45.5% → 81.4% | 9.65s |
| Elephant Trap recapture | exd5 → exd5 | 10 → 10cp | 0.557 → 0.570 | 23.4% → 24.9% | 1.66s |
| Immediate mate control | Qh4# → Qh4# | 0 → 0cp | 1.000 → 1.000 | 0.0% → 0.0% | 0.34s |
| Starting-position control | e4 → e4 | 5 → 17cp | 0.555 → 0.566 | 0.0% → 0.7% | 5.79s |

Mean production selection time was 6.07s, with a 0.34–14.86s range on this machine. Node Maia uses one inference thread; Stockfish is the shipped single-thread WASM. Browser and device timing can differ. The test clears Stockfish's transposition table between searches, making comparisons independent of search order. Model initialization and concurrent machine load affect runtime.

## Isolating the extra opponent reply

A separate live-engine control holds opponent/engine ratings 1000/2400, root/outcome depths 12/10, reply budgets, aggression and risk settings fixed. Only opponentPlies changes from 1 to 2. Root selections match in all eight fixtures. The table reports each actual production selector's own forecast, using its configured reply budgets; it therefore isolates the effect of additional chance-ply search and verification. Higher forecast values alone do not establish improved play or a guaranteed gain in move ranking.

| Position | One → two chance move | Actual selector utility, one → two chance |
| --- | --- | ---: |
| Légal after h3 / Bh5 | Nxe5 → Nxe5 | 0.831 → 0.857 |
| Premature Légal sacrifice | h3 → h3 | 0.576 → 0.626 |
| Blackburne Shilling bait | Nf6 → Nf6 | 0.522 → 0.534 |
| Fishing Pole hook | h5 → h5 | 0.586 → 0.720 |
| Englund queen fork | Qb4+ → Qb4+ | 0.551 → 0.642 |
| Elephant Trap recapture | exd5 → exd5 | 0.559 → 0.568 |
| Immediate mate control | Qh4# → Qh4# | 1.000 → 1.000 |
| Starting-position control | e4 → e4 | 0.559 → 0.566 |

Before the Fishing Pole hook has been played, a ninth sensitivity probe after 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O changes Bc5 to Nd4, with 36cp independent first-chance risk. Shared one-chance utility changes 0.482 → 0.486; shared two-chance utility changes 0.502 → 0.525. First-chance punishable mass changes 6.3% → 31.4%. The named Ng4 bait is not selected. This discovery probe compares both full defaults and does not isolate one changed parameter; it shows a generic candidate chosen to pose more practical problems without any opening-specific production rule.

## Trap chains and actual punishment

At Maia 1000/2000, Blackburne Nd4 attracts Nxe5 with 34.4% probability. Stockfish's strongest continuation is Qg5. Its next-reply expected utility is 0.757, with 79.4% modeled punishable replies; its strongest defense is -20cp. Maia assigns 53.4% to Nxf7, which Stockfish scores at +346cp. The continuation does not assume the full famous mating sequence is certain.

In Englund, Bd2 is correct defense to Qb4+; Maia gives it 28.1%. Stockfish's preferred Qxb2 sets a further problem, with next-reply utility 0.493 and 42.9% punishable replies, versus -219cp under strongest defense. In Elephant, the initial Nxd5 capture already loses: the engine recaptures Nxd5 and retains 308cp under strongest defense, with next-reply utility 0.836.

Actual production decisions in the Blackburne illustrative line chose Qg5, Qxg2, Qxe4+, and Nf3# at every engine turn. Production also chose Qxb2 after Englund Bd2 and Nxd5 after Elephant Nxd5. These checks establish that it executes punishment when supplied those mistakes; they do not establish that a player will make them.

The report generator independently checked 80 recorded decisions for legal moves, bounded utilities, real Maia use, the hard risk budget, exact terminal outcomes, and both chance-ply probability backups. It verifies that reply masses equal reported coverage and that residual mass is retained at the defense value.

## Reproduce

Run from the repository root:

```powershell
npx tsx scripts/review-traps.ts --mode baseline --deeper --output benchmarks/review/baseline-ratings.json
npx tsx scripts/review-traps.ts --mode chains --output benchmarks/review/chains-1000-depth12.json
npx tsx scripts/review-traps.ts --mode compare --oracle-engine 2400 --output benchmarks/review/default-comparison-2400.json
npx tsx scripts/review-traps.ts --mode control --oracle-engine 2400 --output benchmarks/review/same-settings-horizon-control.json
npx tsx scripts/review-traps.ts --mode discovery --oracle-engine 2400 --output benchmarks/review/fishing-pole-discovery.json
npx tsx scripts/review-traps.ts --mode punishments --output benchmarks/review/punishments-production.json
node scripts/review-traps-report.mjs
```

Raw final reports contain all FENs, candidate/reply scores, true Maia probabilities, settings, actual decisions, runtimes and source/model/binary hashes. Earlier exploratory reports are retained separately; the validated comparisons above use the actual default 2400.

The search follows the same practical expected-outcome principle described in [FlawChess](https://github.com/flawchess/flawchess), with Stockfish choosing engine continuations and Maia modeling the opponent. This bounded two-reply extension still misses traps that require further later mistakes, and four production second replies can leave substantial conservative tail probability in diffuse positions.

## Real-play integration smoke

Two starting-position games used fixed seeds selected before results, real Maia-1000
sampling and the actual default engine, capped at twelve plies each. All 24 moves
were legal; all twelve engine decisions used real Maia and satisfied the selector's
verified risk limits. White ended at +217cp with equal material. Black ended at
+616cp and five pawns' worth of extra material after immediately punishing Nxc7+
with Qxc7 and Bb5+ with axb5. Neither short game establishes a win rate or Elo.

The final winning Black move had 27cp risk under the selector's consistently verified
baseline. A separate cold, single-PV depth-12 evaluation changed from +677cp to
+616cp across that move. Finite searches can disagree, so the configured 40cp
conversion limit describes the selector's comparison rather than a guarantee against
every deeper or differently configured evaluation.

Run `npm run test:game`; raw moves, probabilities, material, evaluations and source
hashes are in `artifacts/benchmarks/review/maia-game.json`.
