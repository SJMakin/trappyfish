# Saved games and recorded decisions

Games and analysis positions remain in `localStorage` under `trappy.position-history.v1`. The existing version is retained: opening identity, book-exit reason, search profile and game result are optional fields. Older entries load with their original PGN, FEN, player colour, orientation and explicit settings. An omitted continuation width restores as one, independently of the default for new Play games.

Trap practice starts retain the PGN setup before the bait and the selected opening identity. The library has 20 audited studies and 19 selectable entries; the London study is retained for audit and excluded from new practice starts after independent engine evidence found its illustrative punishment unsound. The original five studies and their calibration remain unchanged. **Face this trap** and **Play this trap** choose the human side explicitly, then open New game for confirmation; neither forces the opponent's illustrative reply.

The saved result distinguishes resignation, an intentionally unfinished game, checkmate and draw. An ended entry opens review and cannot restart the opponent. PGN retains moves played before an opening start position, including the setup FEN when the original position was custom. Renaming a game does not change its identity or decision records.

Engine decisions use a separate IndexedDB database, `trappy.decision-traces.v1`, with one record per game ID and committed engine ply. A record contains the position **before** the engine move, the settings used, decision provenance, the selected candidate and relevant alternatives, reply evidence, bounded PVs and preference contributions. The next actual reply is attached to that record. Human opening deviations are recorded explicitly. No camera frames or imported images enter either history store.

The trace store has a **20 MiB** budget measured from UTF-8 serialized records plus per-record overhead. Oldest traces are removed first; this operation never deletes a saved game, position or PGN. A smaller browser quota also evicts older traces before retrying. Blocked persistence keeps available records in the current tab and reports the storage limit. Traces missing after eviction, storage failure or an older release are labelled unavailable; the move timeline remains usable. Explicitly deleting or clearing saved history removes the corresponding traces.

Undo serializes behind pending writes, deletes future decision records and removes any actual reply that was undone. Replaying a different continuation can therefore never present the abandoned continuation as the historical decision. Engine search cancellation prevents a stale search result from committing a move or a record to a new game.

## Imported opening books

Polyglot files use a separate IndexedDB database, `trappy.opening-books.v1`, with a **128 MiB total** library limit. An import is identified by the SHA-256 of its exact contents, independently of its filename. Saved game opening metadata and decision traces retain that book identity and name; the binary is not copied into each game or trace. Files are never uploaded. **Keep new imports on this device** controls persistence, with a visible tab-only fallback when storage is unavailable or full. Importing prepares an available book; **Use for new game** opens New game, and confirming it applies the book to that new game without changing other controls.

Removing a file leaves saved game moves, settings, results and existing decision traces intact. Clearing saved history removes its traces but does not remove the independent book library. Clearing the site's browser data can remove all three stores. A tab-only book must be reimported after returning. Reimporting identical bytes restores the same identity; a different file with the same name does not silently replace it. Persisted bytes are fingerprint-checked before lookup.

When an unfinished saved game needs a missing or unreadable book, the opponent pauses with a visible explanation. Reimport the original file and retry, or explicitly select **Continue without book**. That choice records a book exit and uses normal search; it does not erase the game's earlier opening provenance. Ended reviews and their stored explanations remain readable without the book, subject to ordinary trace retention. A missing trace remains unavailable rather than being recreated with current engine settings.

Book moves still pass normal defensive risk checks. Positive file weights identify active moves and add no ranking bonus; current style and variety controls select among verified eligible moves. Stockfish and Maia are unchanged. See [opening data](opening-data.md), [the Polyglot reader](polyglot-reader.md) and [attacking-engine ideas](attacking-engine-ideas.md) for acquisition, attribution and the distinction between current behavior and future experiments.

## Review semantics

Live Play shows visible board events and filtered search counters. Tactical explanations open only after the game ends. Review separates the considered bait, the actual played reply and the best searched defense. A mating or fork label requires the stored legal line to exhibit that motif; a generic tactic label is used when it does not.

The retained tree contains the chosen continuation and its reply evidence. When Deep compared more than one own continuation, review lists each compared move, its defensive evaluation, bounded expected utility and preference ranking. These values describe the original decision and are not a calibrated player win probability.

The trap browser's independent depth-16 Stockfish samples, its Maia conditional reply estimates and any observed human counts are separate evidence. The checked-in observed samples are unavailable after HTTP 401; model probabilities do not fill that gap. Neither a legal illustrative mating line nor a model reply probability establishes a whole-game trap success rate. See [trap library evidence](trap-library-evidence.md).

The preference experiment is labelled **among the searched candidates**. It reweights the retained candidates using stored outcomes and defense lines, does not discover new moves or replies, does not resample variety, and does not modify the recorded decision. A separate **Fresh analysis in a new tab** link searches the inspected position with the Analysis workspace's settings.

Run `node node_modules/tsx/dist/cli.mjs scripts/test-decision-traces.ts` for persistence, reload, undo ordering, bounded eviction, quota recovery, blocked storage, corrupt traces, opening/result compatibility and stored-pool reweighting checks. Browser regressions cover the ended-game review and live-plan privacy.
`npx tsx scripts/test-local-books.ts` covers content identity, import validation and storage fallback; `npm run test:books-browser` covers the user-facing import and missing-book recovery workflow.
