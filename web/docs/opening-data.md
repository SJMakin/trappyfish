# Opening and trap content

The app bundles the complete Lichess `chess-openings` catalogue at commit
`712a58be746c143f4ab935b68acc50f4bac813eb`: 3,865 named lines from `a.tsv` through
`e.tsv`, plus five project-authored trap studies. The catalogue is CC0; its license
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

Book lookup has no network dependency. The selector must verify a proposed book
move against the same defensive risk budget as other candidates. Book membership
is provenance, not an objective score or a hidden style bonus. A famous opening
or trap can be objectively dubious.

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

`trapRepertoire.ts` contains original notes, setup/bait/reply/punishment sequences,
motifs, caveats and background links for Légal, Blackburne Shilling, Fishing Pole,
Englund and Elephant patterns. These actual selectable library entries end after
the bait move. Their illustrative punishment lines are teaching material and are
not assumed to happen in a game. In particular, Englund's `Bd2` is a correct
defense; its later mating line requires more mistakes. Every sequence is checked
for legal replay. `trapVerification.json` separately records independent Stockfish
18 samples at depth 16, engine and source hashes, measured concessions, and a
sampled best defense. This finite search is not a mathematical proof or evidence
that humans will take a lure. Rebuild it with
`npx tsx scripts/verify-trap-content.ts`.

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
