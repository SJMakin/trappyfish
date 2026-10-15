# UI review and changes

The default is **Ruthless**, targeting a **1000-rated player**, in **Play** mode.
The board remains the main element; rating presets and playing controls are visible,
while search budgets are under Advanced. Desktop and 390px mobile layouts were
inspected in real Edge screenshots with no horizontal overflow.

The highest-impact issue was revealing the engine's plans before the player committed.
Predicted replies, evaluation numbers, continuation lines, candidate scores and trap
arrows now appear only in explicit Analysis. A subtler two-turn leak was also fixed:
the saved plan from the previous move could reveal a still-live second trap. Play's
post-move review now contains only facts about the committed reply. Full saved plans
become available in Analysis or after the game ends. The saved position is retained
so review continuations render in valid SAN.

White/Black previously reset the board immediately. New game now has an explicit
color choice and Start action. Flip board changes orientation while preserving the
position and playing color. FEN/screenshot loading remains a deliberate reviewed
action, clears old history/plans, cancels the previous search, and closes the importer.

Drag-only input and automatic queen promotion were replaced with click/tap selection,
legal destination markers, four promotion choices, and keyboard board navigation.
Arrow keys move focus; Enter/Space select and move. Promotion dialogs trap focus,
support Escape, and return focus to the pawn when cancelled. Illegal destinations
do not change the position.

Two-turn search costs more time. The interface shows when the engine is searching;
Advanced offers one opponent turn for faster play. The model rating targets the
player's mistakes and does not set a weak bot strength. Engine rating context is
not a measured Elo. See [the trap review](ruthless-review.md) for timings and limits.

Verified with real browser suites:

- `npm run test:ux`: desktop/mobile layout, safe controls, legal click/touch moves,
  keyboard navigation, promotion choices, focus and cancellation.
- `npm run test:app`: real Maia + Stockfish Legal bait and mating punishment,
  default plan hiding, explicit Analysis, factual review and Stockfish mode.
- `npm run test:privacy`: a deterministic two-turn plan verifies that reviewing the
  first committed move cannot expose the upcoming second mistake in Play.
- `npm run test:screenshot`: actual White/Black screenshot recognition, upload,
  paste/drop, confidence review, FEN validation and loading during a pending search.

Before/after images and actual trap views are under `artifacts/ux`:
[desktop](../artifacts/ux/after-desktop.png),
[mobile](../artifacts/ux/after-mobile.png),
[hidden trap in Play](../artifacts/ux/trap-play-desktop.png),
[explicit Analysis](../artifacts/ux/trap-analysis-desktop.png).
