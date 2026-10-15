# Search review: ruthless defaults

The revised default models a 1000-rated opponent against a 2400-rated engine,
with Stockfish root depth 12, tactical depth 10, full practical weighting, and
two opponent chance turns. It refines the three most likely first replies using
up to four modeled second replies each, always adding Stockfish's strongest
defense. The engine continuation between those replies comes from Stockfish's
principal variation; Maia determines the opponent's choices.

The independent objective risk limit remains 100cp. When the strongest verified
candidate is at least +500cp, the limit falls to 40cp to preserve a winning
position. Known root mates bypass practical modeling. Outcome utilities remain
bounded, and the inverse utility transform does not establish a forced mate.

Both chance layers retain their actual probability mass. Omitted replies use
the strongest known conservative outcome rather than a renormalized top-k
distribution. A rare defense found in either layer can tighten the objective
baseline and disqualify an attractive but unsafe bait. Ratings and score signs
retain the same root-player perspective for White and Black.

The review exposed two presentation defects in the initial two-turn change.
A very rare second-reply mate could create a misleading direct trap label with
zero profit; nested labels now require at least 0.5% joint probability across
both replies. The displayed punishment also initially followed Stockfish's
strongest second defense, even when another second reply was the named human
mistake. It now includes the selected mistake and its corresponding punishment.

`npx tsx scripts/test-ruthless-engine.ts` passes all 14 independent regression
cases. They cover two-turn selection, omitted probability mass, conditional
mistake probability, rare-mate utility and labels, nested defensive discoveries,
terminal outcomes, Black's perspective, forced-mate preservation, conversion,
model failure, and cancellation while waiting for the second policy.
These use controlled legal positions and mocked policy/evaluation outputs to
check search correctness; they do not measure playing strength or Elo.

The second turn uses a smaller Stockfish budget and follows one engine-optimal
continuation per first reply. It does not optimize an entire subsequent tree
against the human model. Finite-depth defensive evaluations and Maia's
population-level predictions remain sources of uncertainty.

## Bounded real-model play smoke

`npx tsx scripts/test-maia-game.ts` also passes two starting-position games
using actual Stockfish and Maia, capped at 12 plies each. The opponent samples
Maia's complete legal 1000-versus-2400 distribution with fixed seeds 20261013
and 20261014 selected before observing the games. The run used the unchanged
production defaults, completed 24 legal plies and 12 engine decisions, and had
no model fallback. Source/model/binary hashes and per-move probabilities,
evaluations, material, risk, and selected search details are preserved in
[`maia-game.json`](../artifacts/benchmarks/review/maia-game.json).

| Engine side | Initial Stockfish score | Final Stockfish score | Final material balance |
| --- | ---: | ---: | ---: |
| White | +37cp | +217cp | Equal |
| Black | -37cp | +616cp | +500cp |

Black immediately punished the sampled Nxc7+ with Qxc7 and Bb5+ with axb5.
All engine selections respected their verified objective risk budgets. A
separate cold Stockfish depth-12 score can differ from that verification:
Black's final d3 had a verified 27cp risk within the 40cp conversion limit,
while the separate before/after evaluations fell from +677cp to +616cp.
This illustrates finite-depth uncertainty, rather than a guarantee of a
universal 40cp loss bound. Two short games provide integration and punishment
examples, not a general playing-strength or Elo result.
