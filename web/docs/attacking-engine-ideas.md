# Attacking engines and opening books

Reviewed 6 November 2026. This work adds opening data and studies design ideas while retaining Stockfish and Maia. No other engine is integrated, and there is no hidden “Tal” preset.

## Primary sources

| Source | Verified finding | Consequence here |
| --- | --- | --- |
| [Chess System Tal 3 README](https://github.com/ChrisWhittington/ChessSystemTal3/blob/a07e88e7da8d573ad9b14d58ed774348ceacd41e/README.md), revision `a07e88e7da8d573ad9b14d58ed774348ceacd41e` | Windows 64-bit AVX2 binary; source is private; all rights reserved. The [publisher page](https://whittingtonchess.com/chess-system-tal) lists an approximately 113 MB download. | Its advertised attacking style is inspiration. We cannot inspect or reproduce its private evaluation or infer exact settings from its name. |
| [Polyglot collection README](https://github.com/ChrisWhittington/polyglot-books/blob/7e67e8b114b39d74271d14d9ccff09355c53a171/README.md), revision `7e67e8b114b39d74271d14d9ccff09355c53a171` | `Daring.bin`: 0.29 MB, 19,152 entries, credited to Jeroen Noomen. `uho-pohl.bin`: 76.7 MB, 5,027,499 entries, credited to Stefan Pohl. Entries are position–move pairs. Books remain their authors’ property. | Users can download a release ZIP, unzip it and import the `.bin` locally. These books are not bundled or automatically fetched. The current 128 MiB per-file and total import limits accommodate either listed file individually. |
| Supplied [Human/Saros page](https://digilander.libero.it/taioscacchi/programmi/saros-page.html) | Returned HTTP 410 Gone during this review. | No verified acquisition route or implementation claims. |
| [AggroChess 4.5.0 README](https://github.com/PhelRin/AggroChess/blob/bbdb4a50f5a81b65791c4a399f828c268bdcf6de/README.md), revision `bbdb4a50f5a81b65791c4a399f828c268bdcf6de` | Public Rust source describes sacrifice follow-ups, king clamps and extra searches for forcing sacrifices. | These are hypotheses for separate experiments, not evidence that copying its bonuses improves this engine. |

At that AggroChess revision, [UCI handling](https://github.com/PhelRin/AggroChess/blob/bbdb4a50f5a81b65791c4a399f828c268bdcf6de/src/uci.rs) advertises only `Threads` and `BookPath`. Swindle, aggression, contempt and sacrifice tuning accept changes only with `AGGRO_DEV` set. They are development controls, rather than a public personality interface. We do not copy their numeric coefficients or make comparative strength claims.

Its [book implementation](https://github.com/PhelRin/AggroChess/blob/bbdb4a50f5a81b65791c4a399f828c268bdcf6de/src/book.rs) merges side-specific SAN repertoires by position, handles transpositions, retains the highest weight for duplicate moves and falls back to an optional Polyglot file. The separate provenance of its `ph-gambitbook.bin` was not established; it is not redistributed here.

## What is implemented

Local Polyglot lookup identifies positions, so different move orders can reach the same book entry. Imported bytes have a SHA-256 identity and legal candidate moves still undergo the engine’s objective risk checks. Book membership does not certify a sound trap. Our catalogue studies retain explicit move paths; they are not all position-indexed repertoires. See [reader details](polyglot-reader.md).

Independent attack, pawn-storm, sacrifice, tension and other preferences remain separate from evaluation risk. Sacrifice appetite measures material invested at a verified continuation endpoint, gated by compensation. Deep Play compares up to two own continuations after refined human replies, including strongest-defense checks. See [playing preferences](playing-style.md) and [search decisions](play-search.md).

Our host discovers candidate moves, asks Stockfish to calculate, then ranks the verified candidates using human-reply utility and explicit preferences. Moving a slider does not alter Stockfish’s internal leaf evaluations, move ordering, pruning or search bounds. An internally biased engine can explore different branches throughout its search. Our reranking cannot recover a speculative quiet setup that candidate discovery never found; wider discovery and continuation comparison address only part of that difference.

## Experiments worth testing next

These are proposed controls, not current behavior. Each should default off and retain the explicit objective-risk boundary.

| Possible control | Meaning | Evidence required before exposure |
| --- | --- | --- |
| Sacrifice window | How long material must remain invested before receiving a preference; optionally recognize connected follow-up sacrifices. | Distinguish temporary exchanges, sound long-term compensation and unsound losses across several search horizons. No automatic sacrifice quota. |
| King restriction | Prefer lasting removal of escape squares, including supported advanced pawns near a castled king. | Paired positions separating a useful clamp from an undefended pawn push; check overlap with attack and pawn-storm features. |
| Forcing-search budget | Spend an explicit extra budget investigating plausible checking sacrifices and rescue resources. | Find additional sound candidates under equal total time; measure latency and missed defensive resources. |
| Mating flourish | Prefer a sacrificial route among independently verified winning mates. | Confirm every defense and bound any extra mate distance; default behavior continues to prioritize the known fastest mate. |

Evaluate changes with independent tactical fixtures, best-defense risk measurements, trap preparation separated from supplied human mistakes, and paired games. A more spectacular selected line alone is insufficient evidence of better trap preparation or playing strength.
