# Screenshot-first trap analysis review

Trappyfish now opens in **Analyze**. A screenshot is a position to study: importing it automatically starts analysis for the side to move, keeps the uploaded board unchanged, and returns moves, likely mistakes, targets, strongest defenses and replayable continuations. **Play AI** remains a separate workspace for practice.

## The broken flow

The previous Analysis button only revealed a plan from the bot's last played move. Loading a screenshot cleared that plan and move history. If the uploaded side to move matched the playing color, there was no engine move, no plan and no independent analysis request. The only result was “No moves yet.” The importer was also below the empty move list, and required choosing a playing color for a research task.

The [before screenshot](../artifacts/ux/analysis-before.png) records that state. The new [desktop entry](../artifacts/analysis/landing-desktop.png) puts screenshot upload and FEN input at the front of the workflow, with a usable example and instructions for the next step.

## The flow now

1. **Import and confirm.** Upload, paste or drop a screenshot, or paste a FEN. Review the detected pieces, side to move and castling rights. Screenshots cannot establish castling or en passant history; these start unset. The visual correction palette can repair a square without editing FEN by hand. An uncertain scan requires explicit review before analysis.
2. **Get a plan.** Analyze position starts a quick Maia/Stockfish pass, then deeper verification. The quick results remain usable while the deep search continues. The default opponent profile is 1000; it models the lower-rated opponent's replies rather than weakening Stockfish.
3. **Compare choices.** Recommended practical and soundest moves share a card when they agree, and appear separately when they differ. Compact candidates and an expandable comparison expose alternatives, with explicit labels for risky moves.
4. **Study the punishment and defense.** Each candidate presents mistake branches beside strongest defense. Captured material, offered bait and the target king are named. Conditional wording makes clear that a trap's mating finish depends on the opponent taking the bait. The reply tree includes probabilities and second-turn branches, including a later trap after an initially correct defense.
5. **Walk or change the line.** Click a move or use the start/previous/next/end controls. The board follows a legal continuation without modifying the imported position. Move either side to explore another idea, then Analyze this branch. Return to the analyzed root, restore the original import, copy FEN/PGN, export PGN or practice from the current board.

Completed results retain their original opponent rating and search settings. Editing controls marks existing results as belonging to the previous settings until a new search completes. Stopping a search keeps completed results. Loading another position or switching to Play cancels the previous analysis, and a late result cannot replace the new board.

## Compact analysis layout

The desktop view now prioritizes the board, recommendation, one useful mistake line and the strongest defense. Settings use a small toolbar. Duplicate recommendation/candidate cards disappear when they describe the same sole safe move. Further trap lines, the complete human reply tree, scoring explanations and export tools expand on demand.

The board responds to viewport height so its replay controls stay visible on shorter screens. A single horizontal move strip follows the selected move without scrolling the page. Mobile has sticky Board & line / Plans shortcuts; choosing a line returns to the board.

The actual Maia/Stockfish review uses the user's Nb6+ position at 1828×846, 1366×900, 1280×720 and 390×844. At desktop sizes both main line cards and replay controls fit on the first screen, with no horizontal page overflow. The original desktop content was about 2,500 pixels tall; the compact result fits approximately one screen at 1828×846. See [before/after measurements](../artifacts/layout/review.json), [desktop](../artifacts/layout/viewport-1828.png), [short laptop](../artifacts/layout/viewport-1280.png) and [mobile](../artifacts/layout/after-390.png). Run `npm run test:analysis-layout` against the dev server or set `TRAPPY_TEST_URL` to a production preview.

## What the numbers mean

Maia supplies human reply probabilities; Stockfish scores the resulting positions from the **analyzed side's fixed perspective**. Positive is good for that side, including when Black is analyzed. Model score is a bounded evaluation transform, not an empirical win-rate prediction. Unsearched probability mass retains the conservative defense outcome. Second-reply probabilities are conditional; the corresponding full branch also shows their joint chance.

Quick uses root/outcome depths 10/8 and one opponent turn. Deep defaults to 14/12, twelve root candidates, twelve first replies, and two opponent turns with three extended branches and six second replies. Forcing-move discovery can add candidates beyond the root count. Analysis evaluates discovered risky moves too, while recommendation eligibility retains the configured risk limit. The budget tightens when clearly winning. These finite searches do not establish a forced win against every defense, nor do they cover arbitrary long traps.

If Maia fails, the app exposes Stockfish candidates and legal principal variations with an explicit warning. It displays no invented reply probabilities or modeled mistake chances. Finished positions have a checkmate or draw result instead of an empty panel.

## QA and evidence

Thirteen deterministic engine regressions cover root immutability, progress and cancellation, Black's score perspective, unsafe attractive alternatives, best-defense metadata, exact Légal mate replay, promotion identity, finished positions, forced-mate root analysis, transparent model fallback, and PGN round trips. Rare stronger defenses uncovered by forced searches are verified at both opponent turns: the marked defense and replayed branch must match the actual scored floor. The shared line helpers are checked against the same functions used by the UI.

Browser flow regressions cover automatic import analysis without autoplay, first-pass exploration during a deep search, replayed board pieces and FENs, strongest defense, branch reanalysis, imported-root restoration, cancellation, rating context, freely moving both sides, stale-search races, readable clipboard exports, transparent objective fallback, and mobile promotion. Desktop and a 390px touch viewport were inspected with no horizontal overflow. The primary upload action is visible on the first mobile screen.

Review also caught and fixed several subtler issues: unconditional mate captions for conditional traps, hiding second mistakes after a correct first defense, quick settings falsely reported as user edits, and deeper results resetting a reply-tree branch the user was already studying.

One complete **real browser** path uploaded a screenshot rendered from the Légal fixture, reconstructed the board through Fenshot, reviewed turn/castling rights, obtained actual Maia and Stockfish results, and replayed **Nxe5 Bxd1 Bxf7+ Ke7 Nd5#** to the exact checkmate position. It produced usable results in **5.099 seconds** on the final live-server run on this machine; previous runs varied from 3.479 to 6.499 seconds. No engine move was played on the imported root. See the [uploaded image](../artifacts/analysis/uploaded-legal-board.png), [recognition review](../artifacts/analysis/screenshot-review-desktop.png), [actual Maia punishment](../artifacts/analysis/real-maia-punishment-desktop.png), and [raw browser record](../artifacts/analysis/browser-review.json).

Independent real-engine checks analyzed the Légal position in Quick and Deep, then the Elephant position with Black to move. The final run examined ten moves in Quick in 2.607 seconds including cold model initialization; Deep examined thirteen moves in 13.919 seconds; Black Quick examined ten in 1.692 seconds. They preserved every root, used actual Maia, checked legal trap/defense lines and target metadata, and round-tripped each variation through PGN. These timings describe this run and machine, not a performance guarantee. Raw settings, candidates and replies are in [real-analysis.json](../artifacts/analysis/real-analysis.json).

The production build was also tested without development module interception: screenshot recognition, reviewed position, actual Maia/Stockfish candidates, unchanged root, and exact mate replay all passed, with no browser errors. Its first preview took 8.696 seconds in the latest compact-layout run. See [built-browser-review.json](../artifacts/analysis/built-browser-review.json) and [the built result](../artifacts/analysis/built-analysis-desktop.png). The built gameplay regression also passed, including hidden hints and actual punishment.

## Reproduce

```powershell
npm run build
npm test
npm run test:analysis-real
# With npm run preview running on 127.0.0.1:5180:
npm run test:analysis-built
# With the Vite development server running on 127.0.0.1:5173:
npm run test:analysis
# Faster state/interaction coverage, with deterministic scored fixtures:
node scripts/test-analysis-browser.mjs --mock-only
```

The browser suite requires a Vite development server for its deterministic module interception. Its real screenshot, Maia and Stockfish case runs without those mocks. `TRAPPY_TEST_URL` can target another dev-server port. Earlier development runs used a frozen source snapshot on port 5174 to prevent concurrent edits from reloading QA pages; the final `npm run test:analysis` passed against the normal app on port 5173. The temporary QA server was stopped after review.
