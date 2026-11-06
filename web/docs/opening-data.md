# Opening and trap content

The app bundles the complete Lichess `chess-openings` catalogue at commit
`712a58be746c143f4ab935b68acc50f4bac813eb`: 3,865 named lines from `a.tsv` through
`e.tsv`, plus 19 selectable trap studies from 20 audited records. The catalogue is CC0; its license
is included in `src/openings/DATA-LICENSE-CC0.txt`. `provenance.json` records the
revision and SHA256 of each source TSV. `node scripts/update-openings.mjs` rebuilds
the catalogue from that exact revision, parses every PGN, and derives its UCI move
sequence and complete endpoint FEN with chess.js. It does not update to a moving
branch silently.

Names, ECO codes and moves are searchable offline. Catalogue branch counts count
named lines, not human games or quality. Favourites use local browser storage,
with a tab-only fallback when persistence is unavailable. Starting at a preview
uses exactly that ply and retains the full PGN prefix. Playing into a line starts
at the initial board. A selected line or a set of favourites only supplies moves
compatible with the actual game prefix; no player move is forced.

Book lookup has no network dependency. The selector verifies a proposed book move
against the same defensive risk budget as other candidates; forced wins take
precedence. Book membership is provenance, not an objective score or a hidden
style bonus. A famous opening or trap can be objectively dubious. Stockfish remains
the calculation engine and Maia remains the human-reply model.

## Local Polyglot files

In Play, expand **Opening book files**, import an unzipped Polyglot `.bin`, then
choose **Use for new game**. This opens the New game panel; starting the game is
an explicit action. Importing does not switch the current game's book or change
style, variety, risk or search controls. Users acquire books separately; the app
does not bundle or automatically download third-party books.

The reader validates sorted sixteen-byte records and structural move encoding,
then filters lookup results for legal moves, including castling and promotions.
Position-key lookup supports transpositions and ignores move counters. Zero-weight
rows are inactive. Positive weights and opaque learning metadata receive no
ranking bonus: eligible moves use the existing style and variety policy after
defensive verification. See [the reader format, tests and GPL attribution](polyglot-reader.md).

Each file and the combined local library are limited to **128 MiB**. A SHA-256 of
the exact file contents identifies the book; importing identical bytes reuses its
identity, and persisted bytes are checked against that fingerprint before use.
**Keep new imports on this device** retains books in IndexedDB. Disabling it or a
storage failure keeps an import for the current tab, with a visible notice. Files
and hashes are never uploaded. Removing a book deletes its local file, preserving
saved game moves, settings and recorded decisions. A game that needs an unavailable
book pauses until the original bytes are reimported or **Continue without book**
is selected explicitly. See [saved-game behavior](game-history.md).

An actual interoperability check used the author's published
[Daring release archive](https://github.com/ChrisWhittington/polyglot-books/releases/download/v1.0/Daring.zip).
The 306,432-byte `.bin` parsed as 19,152 active entries across 14,271 position keys;
its SHA-256 was `168ccb0b467c9280e0e79c9d6309e5fd84d16e229bb28a1903b8ced7c0c2b187`.
Three published Polyglot hash vectors matched, and the real selector chose `e4`
from the initial position with zero measured risk and no human-policy calls.
This is a compatibility sample, not a strength or trap-quality measurement, and
was not a whole-file comparison against python-chess. The report is
`artifacts/trap-library/daring-interop.json`; downloaded book bytes are not app assets.
The [source collection](https://github.com/ChrisWhittington/polyglot-books/blob/7e67e8b114b39d74271d14d9ccff09355c53a171/README.md)
retains the respective authors' rights. [Attacking-engine research](attacking-engine-ideas.md)
separates implemented book support from future experiments; no other engine is integrated.

## Optional human statistics

The explicit statistics button requests only the preview FEN and chosen rating
buckets/time controls from [Lichess Opening Explorer](https://lichess.org/api#tag/Opening-Explorer).
It sends no game history, account credentials or application metadata. Requests
are serialized, time out after 15 seconds, and use an optional local 24-hour cache
(at most 30 positions/filter combinations). Initial filters are rated rapid games
in the 1000, 1200, 1400 and 1600 buckets. These are Lichess buckets rather than a
calibrated app rating or an exact closed numerical interval.

Opening the panel, changing a preview, and changing filters never make a request.
429 responses create a cooldown of at least one minute, respecting longer
`Retry-After` values. Offline, malformed, empty and unavailable results have
distinct messages. The game remains available. Live API responses are not bundled
as a purported CC0 game-frequency dataset.

## Trap studies and motif examples

The audited library has **20 studies; 19 are selectable**. `trapRepertoire.ts`
retains the exact five original project-authored Légal, Blackburne Shilling,
Fishing Pole, Englund and Elephant studies. Their source and the existing
calibration remain unchanged. `trapLibrary.ts` aggregates these with fifteen
adapted studies from the MIT-licensed [Chess Coach source](https://github.com/jcabiles/chess-coach/blob/de21fd8bf93641840bda9df7875759f7c1124e00/data/traps.json),
pinned to `de21fd8bf93641840bda9df7875759f7c1124e00`. Exact upstream bytes and
license, checksums, legal-replay audit and original neutral descriptions are
preserved. Overlapping families are deduplicated. Source claims of forcedness,
winning play and popularity are not adopted as facts. See [data derivation](trap-library-data.md).

**Explore traps** filters by side and motif and previews the setup, own bait,
tempting human reply, illustrative punishment and defensive alternatives.
**Face this trap** chooses the opponent's side; **Play this trap** chooses the
trapper's side. Both prepare the exact position **before the bait**, preserving
its PGN prefix, and open New game for explicit confirmation. Selectable catalogue
paths end after the bait; the human is never forced to follow the teaching line.

All setup, bait, reply, punishment and source alternative paths are checked for
legal replay. `trapLibraryVerification.json` adds real independent Stockfish 18
depth-16 searches before the bait, after it and after the illustrative reply,
with engine/data hashes, bait concessions, strongest searched defenses and first
punishment comparisons. The London `Qxb2` study remains in the 20-record audit but
is excluded from selection: its supplied first punishment loses about 399cp
against the best independently searched continuation. The original five also
retain their earlier `trapVerification.json` evidence.

Finite search is not a mathematical proof, a check of optimal play on every
later ply, or evidence that a human will take the bait. Englund's `Bd2` is a correct
defense in the sample; the second Stafford reply loses little evaluation. Their
later teaching continuations require further inaccuracies. The engine still
checks a bait under the current game's risk settings instead of trusting its
library label. Full measurements and caveats are in [trap library evidence](trap-library-evidence.md).

Maia references are actual local inference at fixed model ratings 1000 and 1400.
They estimate a particular reply **conditional on the position after the bait**;
they are not observed frequencies, whole-game trap success rates or forecasts
calibrated to an individual player. The checked-in observed-frequency collection
has **0/20 available samples**: Lichess returned HTTP 401 and further requests
were skipped. Missing counts remain null, separately labelled from model estimates;
no credentials were read or stored. This offline evidence collection is separate
from the optional statistics button described above.

Run `npm run verify:traps` to regenerate independent engine and model evidence,
and `npx tsx scripts/sample-trap-humans.ts` for the separate opt-in observed-data
collector. `npx tsx scripts/test-trap-library.ts` checks original preservation,
all legal branches, deduplication and the London quarantine;
`npx tsx scripts/test-trap-evidence.ts` checks evidence integrity.

Six small CC0 motif examples are pinned from the official
[Lichess puzzle database](https://database.lichess.org/). The raw rows and subset
hash are in `puzzleSourceRows.json` and `puzzleProvenance.json`; derived replayable
positions are in `puzzleExamples.json`. The database FEN occurs **before the
opponent's mistake**. `initialMove` must be played to reach `solverFen`, then the
solution starts. These are supplied-mistake punishment examples, not successful
trap preparations. Motif labels and ratings come from Lichess; legal replay does
not independently prove every label or solution. No AGPL puzzle tagger code is
included.

`python scripts/acquire-puzzle-examples.py` streams a small prefix of the compressed
database (optional Python `zstandard` dependency), records six distinct motifs,
and closes the stream immediately. This intentionally acquires a new subset;
the checked-in raw rows are the pinned test input. Follow with
`node scripts/build-puzzle-examples.mjs` to validate and derive solver positions.

Run `npx tsx scripts/test-openings.ts` for deterministic library/network-service
checks, adding `--catalogue` to replay every bundled endpoint. The browser suite
`node scripts/test-openings-browser.mjs` covers opt-in network behavior, caching,
rate limiting, favourites, exact preview starts, PGN preservation and 320 px layout.
`npm run test:traps-browser` covers trap discovery, evidence and before-bait starts;
`npm run test:books-browser` covers local import and missing-file recovery.
Reader and storage regressions are `npx tsx scripts/test-polyglot.ts` and
`npx tsx scripts/test-local-books.ts`.
