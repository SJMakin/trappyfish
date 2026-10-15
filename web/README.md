# Trappyfish

A browser tool for finding practical chess traps in screenshots and positions.
Maia predicts human replies; Stockfish evaluates the consequences. Playing against
the ruthless AI is a separate practice mode.

[Open Trappyfish](https://sjmakin.github.io/trappyfish/). In the GitHub repository,
the browser app lives in `web/`; run the following commands from that directory.

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173. The default workspace is **Analyze**.

## Screenshot to a plan

1. Upload, paste, or drop a screenshot, or paste a FEN.
2. Review the pieces, side to move, and castling. Use the visual correction palette
   to repair a misread square. Uncertain reads require explicit review.
3. Click **Analyze position**. A Quick pass appears first, then Deep verification
   continues. The imported board stays in place; analysis never plays a move.
4. Compare the **best practical move** with the **soundest move**. Inspect candidate
   ideas, human mistake chances, conservative evaluations, and objective risk.
5. Choose a mistake branch or strongest defense. Step through its legal moves,
   inspect the offered bait and targets, or play a different move with either side.
6. Use **Analyze this branch**, **Return to analyzed position**, or **Restore imported
   position**. Copy FEN/PGN, export a line as PGN, or choose **Play from here** to practice.

The main trap and strongest defense appear together. Expand **All opponent replies**
for the complete reply tree, or **Compare all moves** for risky alternatives. **More**
below the board contains exports, restore and practice tools. On mobile, use the sticky
**Board & line / Plans** shortcuts to move between the board and analysis.

Recognition uses [fenshot](https://github.com/scoriiu/fenshot) locally. Images are
never uploaded. The side in check moves next; otherwise the player at the bottom
is the assumed side to move. The importer explains this default and lets you change
it for screenshots taken during the opponent's turn. A pasted FEN with the wrong
turn while a king is in check offers a one-click correction.
The review starts from the detected viewpoint. **Flip board view** changes only
the view and preserves the full FEN. Square remapping is a separate correction
under **Correct pieces → Fix incorrect screenshot orientation** and explicitly
changes the position.
Screenshots cannot establish castling history, en passant, or move
counters; the review starts with neutral values and allows corrections.

## Reading the analysis

All scores refer to the analyzed side to move, even when you are previewing later
moves on the board. Positive is good for that side. Candidate captions describe a
conditional opportunity: a mating punishment after a mistake is not a forced mate
against correct defense.

**Conservative eval** takes the minimum of root and verified reply evaluations.
Separate continuation searches can differ because of depth and search variation.
**Model score** combines Maia reply probabilities with bounded Stockfish outcomes;
it is not a calibrated human win-rate forecast. **Mistake chance** counts searched
replies that lose at least a pawn, including conditional second mistakes. Joint and
conditional probabilities are labeled separately. Unsearched probability receives
the strongest known defense value rather than being renormalized away.

Quick uses root/outcome depths 10/8 and one opponent turn. Deep defaults to 14/12,
12 main candidates, 12 first replies, and two opponent turns: three likely first
branches are extended using up to six second replies, always adding strongest
defense. Forcing-move discovery can add more candidates. Deep also evaluates risky
ideas, labeling them separately from safe recommendations.

The default human profile is 1000. Customize the rating and search budgets, or stop
a search while keeping completed results. Quick results remain usable during Deep.
Results retain their original settings, and late results cannot overwrite a newly
loaded position. Searches cancel when their workspace is hidden.

The search has a finite horizon and follows one Stockfish-optimal engine continuation
between opponent turns. It does not search every possible long trap. Maia describes
population choices, not a guarantee about a particular player. If Maia fails,
objective Stockfish lines remain available with an explicit warning.

## Practice against the AI

Choose **Play AI**. Its default **Ruthless** profile targets mistakes common among
1000-rated opponents, with Stockfish root depth 12 and outcome depth 10. The
independent 100cp risk budget tightens to 40cp when clearly winning.

In the game's **Play** view, current predictions, evaluations, and trap arrows stay
hidden. Post-move review contains committed facts only, so a saved two-turn plan
cannot reveal a still-live trap. The game's explicit **Analysis** view reveals
current and saved plans. Both workspaces preserve their positions when switching.

Tap, click, drag, or use the keyboard to move; promotion offers all four pieces.
**Flip board** preserves the position. **New game** asks for a color before resetting.
The analysis workspace's **Play from here** explicitly starts practice from its
currently viewed position.

## Build and tests

```powershell
npm run build
npm test
npm run test:analysis-real
```

With `npm run dev` running:

```powershell
npm run test:analysis
npm run test:screenshot
npm run test:ux
npm run test:privacy
```

`test:analysis` includes deterministic interaction checks and a real screenshot →
Fenshot → Maia → Stockfish → mating-line replay. Its module-interception checks
require a Vite development server. Set `TRAPPY_TEST_URL` for another server.

With `npm run preview` on port 5180, `npm run test:app` checks the built game's real
trap selection and punishment. `npm run test:analysis-built` verifies the built
screenshot-to-analysis flow with real recognition and engines, without development mocks.
`test:maia` checks real Node/browser inference parity.
`test:game` runs two short seeded games against real Maia-1000 choices; it does not
measure playing strength.

Build preparation copies installed Stockfish and fenshot assets into `public`.
The Maia and screenshot models load locally when their features are used.

## Static hosting

Run `npm ci` and `npm run build`, then serve `dist/`. Keep the model and engine
directories alongside the generated assets. For a project subpath, build with
`node node_modules/vite/bin/vite.js build --base=/your-project/` after the normal
build preparation. Stockfish, Maia and screenshot recognition respect this base.
The production screenshot-to-mate browser check also passes under `/trappyfish/`.

`npm run publish:trappyfish` publishes the separate native engine repository;
it does not deploy this web app.

The repository's `Deploy Trappyfish web app` workflow tests and deploys `web/` on
pushes to `main`. It uses `npm ci`, the engine/model regressions, a Pages-path build,
and a real Chromium screenshot-to-analysis check before deployment. Enable
**Settings → Pages → Source: GitHub Actions** once for the repository. Later
changes to `web/` deploy automatically. `npm run build:pages` and
`npm run test:pages` reproduce the build and integration check locally.

## Evidence and references

- `docs/analysis-review.md`: screenshot-first flow, line exploration, targets,
  probability semantics, cancellation, and actual browser/engine evidence.
- `docs/trap-comparison.md`: preserved pre-change shallow/deep versus Maia comparison.
- `docs/ruthless-review.md`: rating/depth review, trap-chain checks, and real punishments.
- `docs/search-review.md`: risk, conversion, probability, and mate regression tests.
- `docs/ux-review.md`: the earlier game-interface review, before Analyze became primary.

The design references [FlawChess](https://github.com/flawchess/flawchess), with this
project's own search and model adapter. Model provenance, checksum, tensor contract,
and license are in `public/maia/README.md`. Standalone FENs repeat the current board in
eight history slots, following upstream's no-history mode.

The frozen legacy selector is in `benchmarks/legacy-trappy.ts`; raw comparisons and
analysis evidence are under `benchmarks` and `artifacts/analysis`. Focused fixture and
integration results do not establish an Elo improvement. `benchmark:ruthless`
evaluates gameplay defaults; the original comparison runner retains its historical
settings. Native binary publishing remains separate from the browser Maia selector.

Stockfish is GPL-3.0, the Maia-3 model is AGPL-3.0, and fenshot/ONNX Runtime are MIT.
Upstream attribution is included with model assets; FlawChess application source
is not vendored.
