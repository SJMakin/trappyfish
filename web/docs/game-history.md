# Saved games and recorded decisions

Games and analysis positions remain in `localStorage` under `trappy.position-history.v1`. The existing version is retained: opening identity, book-exit reason, search profile and game result are optional fields. Older entries load with their original PGN, FEN, player colour, orientation and explicit settings. An omitted continuation width restores as one, independently of the default for new Play games.

The saved result distinguishes resignation, an intentionally unfinished game, checkmate and draw. An ended entry opens review and cannot restart the opponent. PGN retains moves played before an opening start position, including the setup FEN when the original position was custom. Renaming a game does not change its identity or decision records.

Engine decisions use a separate IndexedDB database, `trappy.decision-traces.v1`, with one record per game ID and committed engine ply. A record contains the position **before** the engine move, the settings used, decision provenance, the selected candidate and relevant alternatives, reply evidence, bounded PVs and preference contributions. The next actual reply is attached to that record. Human opening deviations are recorded explicitly. No camera frames or imported images enter either history store.

The trace store has a **20 MiB** budget measured from UTF-8 serialized records plus per-record overhead. Oldest traces are removed first; this operation never deletes a saved game, position or PGN. A smaller browser quota also evicts older traces before retrying. Blocked persistence keeps available records in the current tab and reports the storage limit. Traces missing after eviction, storage failure or an older release are labelled unavailable; the move timeline remains usable. Explicitly deleting or clearing saved history removes the corresponding traces.

Undo serializes behind pending writes, deletes future decision records and removes any actual reply that was undone. Replaying a different continuation can therefore never present the abandoned continuation as the historical decision. Engine search cancellation prevents a stale search result from committing a move or a record to a new game.

## Review semantics

Live Play shows visible board events and filtered search counters. Tactical explanations open only after the game ends. Review separates the considered bait, the actual played reply and the best searched defense. A mating or fork label requires the stored legal line to exhibit that motif; a generic tactic label is used when it does not.

The retained tree contains the chosen continuation and its reply evidence. When Deep compared more than one own continuation, review lists each compared move, its defensive evaluation, bounded expected utility and preference ranking. These values describe the original decision and are not a calibrated player win probability.

The preference experiment is labelled **among the searched candidates**. It reweights the retained candidates using stored outcomes and defense lines, does not discover new moves or replies, does not resample variety, and does not modify the recorded decision. A separate **Fresh analysis in a new tab** link searches the inspected position with the Analysis workspace's settings.

Run `node node_modules/tsx/dist/cli.mjs scripts/test-decision-traces.ts` for persistence, reload, undo ordering, bounded eviction, quota recovery, blocked storage, corrupt traces, opening/result compatibility and stored-pool reweighting checks. Browser regressions cover the ended-game review and live-plan privacy.
