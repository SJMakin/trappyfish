# Expanded trap library data

The audited library contains the five original Trappyfish studies and fifteen additional
studies derived from nineteen source families in
[Chess Coach](https://github.com/jcabiles/chess-coach), pinned at commit
`de21fd8bf93641840bda9df7875759f7c1124e00`.
Five overlapping families retain the existing project records. The Stafford family
has two distinct later bait positions, producing twenty audited studies in total.
Nineteen are selectable: the imported London queen-capture example is quarantined
because independent engine analysis refutes its first illustrative response. Its
source, derived line and verification remain available for audit; it cannot supply
opening moves to a game.

The exact upstream `data/traps.json` and its MIT license are retained under
`src/openings/source/`. The license is copyright John Cabiles, 2026; its notice must
accompany redistributed copies. `trapLibraryProvenance.json` records the revision,
source and license checksums, paths, exclusions and derived-data checksum.

All nineteen source lead-ins and declared FENs, all twenty main variations, and
every supplied defensive branch are checked with chess.js. SAN and UCI must agree.
SAN is canonicalized for annotation symbols and check suffixes; corrections are
listed in `trapImportAudit.json`. Source assertions such as `forced`, `commonness`,
`winning-attack` and `engineNote` are not accepted as engine evidence or displayed
as established facts. The product summaries are original, neutral descriptions of
the legal lines.

The source uses `bait: true` for an opponent's reply, not for the trapper's preceding
move. Each derived record therefore identifies its own setup, bait, root FEN, human
reply and illustrative continuation explicitly. Stafford's initial `Nxc6` is a sound
defensive exchange, so its imported studies instead begin at the later `Nxe4` offers
and examine `Bxd8` or `dxe4`. The earlier source alternative is not attached to those
later positions. Defensive alternatives always include their exact starting FEN.

Legal replay does not prove soundness, a forced win, or how often people choose a
reply. Independent finite-depth Stockfish results and human-frequency observations
remain separate evidence. The playing engine still applies its existing risk checks;
membership in the library adds no hidden score bonus.

Reproduce the pinned import with:

```powershell
node scripts/acquire-trap-library.mjs
node scripts/build-trap-library.mjs
npx tsx scripts/test-trap-library.ts
```

Acquisition always downloads the pinned commit and verifies checksums. It does not
follow a moving upstream branch. The original `trapRepertoire.ts` stays unchanged
because its five records belong to the existing calibration baseline.
