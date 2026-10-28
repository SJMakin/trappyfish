# Independent playing preferences

Play and Analyze have separate settings. Every preference is explicit; there are
no personality presets or changes to other parameters when a slider moves. New
preferences default to zero. Old history retains its `aggression` value as King
attack; the new controls start at zero and saved games persist every setting.

## Ranking and objective evaluation

Stockfish supplies objective evaluations and the strongest known defenses. Maia
supplies human reply probabilities. Trappiness blends defensive utility with the
policy-weighted expected utility. Positional preferences then add bounded ranking
points. The objective evaluations, human probabilities and expected utility are
retained separately and displayed unchanged.

| Preference | Raw feature | Maximum effect at 100% |
| --- | --- | --- |
| King attack | Weighted control of the enemy king's 5×5 zone plus coordinated attackers | +60 ranking points |
| Pawn storms | Supported, advancing pawns on the enemy king's file and adjacent files | +50 points |
| King caution | Opponent control and coordinated attackers around the AI's king | −60 points |
| Sacrifice appetite | Net material invested, gated by increased king pressure or piece activity | +60 points |
| Tension | Retained material and unresolved pawn/defended-piece contacts | +40 points |
| Queen retention | Fraction of the original own queen count retained across sampled positions | +30 points |
| Sharpness | Twice the standard deviation of policy-weighted bounded utility | +60 points |
| Draw aversion | Stockfish's actual draw probability for the conservative evaluation | −60 points |

These point bounds are ranking weights, not measured improvements in position or
playing strength. Zero weight adds no preference. Own-king caution is independent
of king attack: attack no longer includes a hidden counterattack discount, and
pawn storms are no longer bundled into king attack.

## Positional sampling

The engine samples the candidate move and at most four plies of its strongest
known defense continuation. King pressure weights controlled adjacent squares
more strongly than the outer king zone, and gives extra credit to attackers that
are defended or not under attack. Pawn storms consider defended pawns on the king
file and adjacent files, increasing continuously as they advance beyond their
home rank. The raw values and signed contributions are available in the HUD.

Sacrifice investment is the decrease in the mover's net material balance from
the root to the end of the verified sampled continuation. Existing deficits are
not counted again. A normal exchange followed by recapture is not rewarded as a
temporary sacrifice. A bonus additionally requires increased king pressure or
piece activity that remains at the sampled endpoint. This is a finite-horizon
heuristic; Stockfish's independent objective-risk check still applies.

## Reply-dependent preferences

Sharpness uses the actual Maia reply tree. Conditional second replies retain
their joint probability. Unsearched probability mass receives the corresponding
defensive baseline utility. This describes dispersion in the searched model, not
a calibrated prediction of a particular person's outcomes. Sharpness requires
Maia even with trappiness zero; unavailable model data is never replaced with
invented volatility.

Draw aversion uses UCI `wdl` values normalized from Stockfish's per-thousand
win/draw/loss estimates. When a stronger defense lowers a candidate's baseline,
its WDL values follow that defense in the root player's perspective. Exact
terminal draws and mates have their known outcomes. If no matching WDL is
available, the draw contribution is zero and marked unavailable. These estimates
are Stockfish's WDL model, rather than calibrated forecasts against the selected
Maia opponent.

## Variety and safety

Variety is a selection mechanism, not a score bonus. For eligible verified moves,
with ranking `R`, the Play probability is proportional to
`exp((R − R_best) / T)`, where `T = 100 × variety` ranking points. At zero variety
the best ranking is selected deterministically. Out-of-risk and unverified moves
have zero sampling probability. Forced mate outcomes bypass random selection.

Analyze shows the same Play selection distribution while retaining a deterministic
highest-ranked recommendation. Diagnostics record the temperature, probability
of each move, and the random sample when Play actually samples a move.

The evaluation-risk limit applies independently of every preference and sampling.
At +500 centipawns or better, the lower of ordinary and winning risk limits
applies. Material sacrificed is not equivalent to evaluation lost. A sound piece
sacrifice can remain inside a small evaluation-loss limit.

Candidate discovery nominates up to two moves for each active positional
preference, plus speculative offers for sacrifice appetite, with a shared cap of
12 style nominations. Stockfish scores them alongside the ordinary shortlist,
checks, captures, promotions and Maia candidates. Discovery does not itself grant
a bonus or waive the objective-risk boundary.
