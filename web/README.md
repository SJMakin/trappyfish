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

1. Upload, paste, or drop a screenshot, capture a 2D board with **Use webcam**, or paste a FEN.
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

The candidate matrix compares objective evaluations, practical model scores, risk,
mistake mass and final rankings. Select a candidate to explore its **Move tree**:
shared moves appear once, with branching human replies and engine continuations.
Click any move to jump to its exact board position; expand or collapse its children,
or use **Expand all**. **Compare all moves** includes rejected alternatives. **More**
below the board contains PGN exports, restore and practice tools. On mobile, use the
sticky **Board & line / Plans** shortcuts to move between the board and analysis.

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

## Webcam capture

Choose **Use webcam** in the position importer in Analyze or Play AI. Camera access
is requested only when you open it, with no microphone. Choose or switch cameras,
center the complete board in the square preview, then select **Capture position**.
The frame goes through the same local recognition and piece/turn/castling review as
an uploaded screenshot; it never starts a game or analysis before you confirm it.
The camera stops after capture, cancel, leaving the workspace, hiding the page, or
closing the importer. Captured frames are not uploaded or saved in position history.

The current recognizer supports flat **2D chessboards**, such as a board displayed
on another screen. Physical boards with **3D pieces are not supported** by this
model. Camera access requires HTTPS or localhost and the browser's camera permission;
file upload and FEN input remain available when a camera cannot be used.

## Recent positions and saved games

Open **Recent positions** below the workspace navigation to resume an earlier study
or practice game. Positions you analyze are saved automatically. Practice games
update one saved entry as you play, including the move history, side you play,
orientation, engine selection, and individual playing controls. **Save** under the
analysis board keeps the exact position you are viewing, including an explored
branch; **Save game** also works before making the first move.

History shows board previews, names, turn/move numbers and saved times. Search or
filter the entries, rename them, delete individual entries, or clear the list.
**Resume** restores the saved workspace and controls. Analysis is recalculated for
the saved position; practice restores its PGN so move lists, undo and game history
remain available. A damaged optional PGN falls back to the intact saved position.

The latest **40** entries are kept in browser storage on this site, with repeated
analysis of the same full position combined. Nothing is synced to an account or
another device. Clearing this site's browser data removes the saved history. If
browser storage is blocked or full, a visible notice explains that changes last only
for the current tab; the board and import tools remain usable.

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

### Technical analysis HUD

The **Engine internals** panel exposes actual Stockfish search counters, root-depth
convergence, the selected move's score ledger, reply probability accounting, style
contributions, and the settings used for the result. The matrix keeps the original
root score separate from the conservative score after defense verification.

Telemetry counts Stockfish invocations and policy requests, elapsed and policy time,
reported nodes, depth/selected depth, latest search speed, and hash occupancy.
Nodes and engine time are cumulative within each Stockfish call; the HUD adds each
completed call once rather than double-counting MultiPV entries or depth iterations.
Counters update between Stockfish calls. Missing measurements remain unavailable.
While a deeper pass runs, its live counters are explicitly separate from the saved
tree and score ledger. The convergence plot follows the initial root search's leader
at each reported depth, including partial MultiPV iterations.

The **Score ledger** shows baseline utility, the Maia-weighted expectation including
unsearched mass, trappiness interpolation, the utility-to-ranking transform, and
attack/tension bonuses. Probability accounting expands both chance layers without
renormalizing sampled replies. Mate sentinels are labeled separately from finite
centipawn evaluations, and recorded engine risk remains authoritative.

The tree shows all returned human replies, strongest defenses, engine setup moves,
and legal Stockfish PV tails. **cond** is a reply's probability given its parent
position; **joint** multiplies the human-choice probabilities along the path. Engine
moves and unevaluated PV nodes have no assigned human probability. Unsearched mass
is a non-move leaf, credited with the strongest known defense utility. Branch outcome
scores are not fresh static evaluations of every intermediate board. These are the
host's evaluated branches and principal variations; Stockfish's wider alpha-beta
search is exposed through aggregate counters, not a fabricated full search tree.

Use **JSON** in the analysis header to export the complete candidate/reply data,
diagnostics and settings snapshot. Tree rendering initially permits 500 visible nodes,
with **Show 500 more** for large expanded trees. A bounded scrolling pane keeps the
tree manageable and follows the selected board position. At an unresolved choice,
replay defaults to a known defense; selecting a mistake follows that branch instead.
Illegal PV suffixes stop at the last
legal position, preserving promotion, Black's move numbering, and replay/export.

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

Choose **Play AI**. **Custom style** exposes independent controls, with no style presets:

| Control | What increasing it does | Default |
| --- | --- | --- |
| Trappiness | Favours better expected outcomes against Maia's likely human replies | 100% |
| Aggressiveness | Favours coordinated king pressure and supported pawn storms | 0% |
| Tension | Favours keeping pieces and unresolved pawn/piece exchanges in play | 0% |
| Risk tolerance | Allows a larger evaluation loss compared with the soundest searched move | 1 pawn |
| Risk when winning | Sets the additional risk cap at +5 pawns or better; the lower cap applies | 0.40 pawns |

Zero means no preference for that parameter. Turning up aggression or tension does
not change trappiness, risk limits, ratings, or search depth. Defaults preserve the
previous trap selection; add attack and tension preferences explicitly to taste.
**Stockfish** bypasses custom style without resetting the controls. In **Analyze**,
use the visible **Playing style** controls for recommendations. Each workspace
keeps its own settings, and edits apply to the next move or analysis search.

Attack and tension are bounded ranking preferences, measured on the candidate and
up to four plies of its strongest known defense continuation. Attacking pressure
includes control around the king, coordinated attackers and supported advanced
pawns, discounted by pressure against the AI's own king. Tension counts retained
material and unresolved contacts between opposing pawns or defended pieces.
Discovery also checks up to four moves favoured by these preferences beyond the
usual shortlist. The analysis score details show each preference's contribution.
Style points never change objective evaluations, Maia probabilities, or model scores.
They never enlarge the shared risk limit or displace a known forced win with a
non-mating move. These are style heuristics, not calibrated playing-strength metrics.

Aggression and tension work with trappiness at zero without loading Maia. If Maia
fails while these preferences are active, the app retains them with Stockfish
defense verification and explains the fallback.

The default opponent rating is 1000, with Stockfish root depth 12 and outcome depth
10. Rating and search budgets remain individually adjustable under Advanced settings.

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
npm run test:style-real
```

With `npm run dev` running:

```powershell
npm run test:analysis
npm run test:screenshot
npm run test:ux
npm run test:privacy
npm run test:webcam
npm run test:history
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
- `scripts/test-playing-style.ts`: independent style controls, shared risk limits,
  model-score separation, Black's perspective, and model fallback regressions.
- `scripts/test-analysis-tree.ts`, `scripts/test-analysis-diagnostics.ts`, and
  `scripts/test-search-telemetry.ts`: legal tree merging/replay, probability and score
  reconstruction, actual UCI counters, fallback and cancellation isolation.
- `scripts/test-position-history.ts`, `scripts/test-workspace-history.ts`,
  `scripts/test-history-browser.mjs`, and `scripts/test-webcam-browser.mjs`: local
  persistence, PGN resume, saved controls, storage failure, camera lifecycle,
  reviewed capture, and stale-request cancellation.
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
