# Play search and opening decisions

The opponent still calculates with Stockfish. Maia supplies probabilities for human replies, rather than replacing the tactical search. A high trappiness value prefers outcomes against those replies inside the explicit evaluation-risk limit. It is not a promise that the opponent will fall for a trap.

## Own continuations

`continuationCandidates` controls how many of the engine’s own moves are compared after each refined first human reply. Fresh Deep Play games use two; old saves and Analysis settings that omit the field retain one. Valid values are one or two. This width is separate from `continuationBranches` (how many first human replies receive refinement) and `continuationReplies` (how many second human replies are sampled).

With width two, Stockfish first proposes up to two own continuations. Moves outside the local risk limit are removed, and a known winning mate takes precedence. Each remaining move receives its own human-policy query and unrestricted strongest-defense search. The strongest defense is included even when Maia assigns it almost no probability. A forced reply search that reveals an even stronger defense also tightens the score.

The engine ranks the safe continuations using bounded expected game utility and the same explicit style preferences. It does not sample among these internal continuations. The selected continuation’s conservative outcome contributes to the original root candidate’s defensive score and risk. A tempting continuation cannot escape the original root risk check by having attractive average outcomes.

For each chance layer, unsearched probability retains defensive utility. Sampled probabilities are not inflated to sum to one. Utility is `1 / (1 + exp(-cp / 200))`, with exact terminal utilities zero, one half and one. This transform prevents a tiny mate chance from dominating a normal result; it is not a calibrated win-rate model.

The decision trace retains the chosen continuation, both compared own-move summaries, their defensive scores and their ranking scores. Replaying the punishment follows the chosen own move, including when it differs from the original Stockfish PV.

## Opening following

The UI supplies legal next UCI moves from compatible selected opening lines. The engine adds any missing book move to its Stockfish candidate discovery and verifies it against the ordinary defensive risk limits. If several book moves remain eligible, their current style and variety ranking decides. There is no hidden book-score bonus.

A known winning mate overrides the opening. If there is no legal compatible book move, all book moves exceed risk, or verification fails, the decision reports search provenance and a concrete exit reason. Human-model failure remains visible and never creates invented human probabilities. Disabling style ignores all saved preferences and variety while still checking book safety.

Following a famous trap is not a certificate of equality. For example, a move evaluated 76cp below the best is permitted by a 100cp limit and rejected by a sufficiently strict smaller limit. The independent calibration reports those concessions alongside preparation successes.

## Evidence

The fast deterministic suite is `scripts/test-play-engine.ts`. It covers missing book nominations, safe and unsafe books, forced-mate precedence, inactive preferences, competing own continuations, residual mass, rare defensive refutations, legal replay and compatibility with old settings.

The full position, control and paired-game collectors live in `scripts/calibrate-play*.ts`. Their JSON reports retain source, model, Stockfish, corpus and data hashes. [Play calibration](play-calibration.md) distinguishes search-only preparation from book assistance and supplied-mistake punishment. Fixed-pool counterfactuals describe results **among the searched candidates**; new searches are labelled separately.
