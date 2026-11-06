# Local Polyglot reader

`src/openings/polyglot.ts` parses local binary opening books without a server. It
contains no book-selection policy: legal lookup moves still pass through the
existing engine's style ranking and defensive risk verification.

Polyglot records are sixteen bytes in big-endian order: a 64-bit position key,
16-bit move, 16-bit weight and 32-bit opaque learn value. The parser validates the
128 MiB cap, record alignment, unsigned key order and structural move encoding.
It copies the input before retaining it, so caller mutations cannot invalidate the
validated key order. Position lookup uses binary search, followed by the matching
key range; it does not scan an entire book on each move.

All matching moves receive normal chess legality checks. King-to-rook castling is
converted to ordinary UCI king destinations, and all four promotion pieces are
supported. Zero-weight records are inactive, as in python-chess. Duplicate legal
moves combine their weights and record counts; the first record's learn field is
retained as opaque metadata and never changes move selection. An empty binary
book is format-valid; the import UI can require active records before accepting it.

The position hash ignores move counters. An en-passant file contributes when an
adjacent pawn of the side to move can make the capture geometrically, including
when that pawn is pinned. The lookup caller must preserve the original EP target,
using `game.fen({ forceEnpassantSquare: true })`; normal `fen()` can omit a pinned
capture. The lookup still filters the capture out when it is illegal.

The standard 781-entry Zobrist table is taken from python-chess, pinned to commit
`0c6bdaccfcb3b09cdbe94b0f81e948cb2a356015`. The original source, full GPLv3 license
and attribution notice are retained in `src/openings/source/`. The TypeScript table
is GPL-3.0-or-later, compatible with this GPL project. `polyglotProvenance.json`
records source/license checksums, the immutable source URL and independent test
vector source. `POLYGLOT_LICENSE_URL` makes the license available as a Vite asset;
the product's credit panel also includes the attribution notice.

Reproduce the constants with `node scripts/update-polyglot-constants.mjs` and run
`npx tsx scripts/test-polyglot.ts`. Tests include nine independently published keys,
white-to-move hashing, normal and pinned en passant, both colors' castling, all
promotions, deduplicated weights, immutable input, unsigned binary search and
invalid/oversize file guards.
