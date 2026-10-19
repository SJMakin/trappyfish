import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { Chess } from 'chess.js';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const storageKey = 'trappy.position-history.v1';
const game = new Chess();
for (const move of ['e4', 'e5', 'Nf3', 'Nc6']) game.move(move);
const now = Date.now();
const study = {
  id: 'browser-study', kind: 'analysis', name: 'Quiet study', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 27',
  orientation: 'b', createdAt: now - 120_000, updatedAt: now - 60_000,
  settings: { trappiness: 0.65, aggression: 0.85, tension: 0.75, maxRiskCp: 150, winningRiskCp: 30, opponentRating: 1400 },
};
const practice = {
  id: 'browser-game', kind: 'game', name: 'Evening game', fen: game.fen({ forceEnpassantSquare: true }),
  orientation: 'b', playerColor: 'w', startFen: new Chess().fen(), pgn: game.pgn(),
  styleEnabled: true, createdAt: now - 180_000, updatedAt: now - 30_000,
  settings: { trappiness: 0.7, aggression: 0.9, tension: 0.8, maxRiskCp: 175, winningRiskCp: 35, opponentRating: 1800 },
};
const spare = {
  id: 'browser-spare', kind: 'analysis', name: 'Spare position', fen: '4k3/8/8/8/8/8/8/3K4 b - - 0 12',
  orientation: 'w', createdAt: now - 300_000, updatedAt: now - 240_000,
};
const errors = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('artifacts/history', { recursive: true });
const watchErrors = (page) => page.on('pageerror', (error) => errors.push(error.message));
async function openHistory(page) {
  const history = page.locator('.position-history');
  if (!await history.evaluate((element) => element.open)) await history.locator(':scope > summary').click();
  return history;
}
async function savedEntries(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{"entries":[]}').entries, storageKey);
}
async function assertBlackView(board) {
  const white = await board.locator('[data-square="e1"]').boundingBox();
  const black = await board.locator('[data-square="e8"]').boundingBox();
  assert.ok(white && black && white.y < black.y, 'Restoring a position preserves Black at the bottom');
}

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  watchErrors(page);
  await page.goto(appUrl);
  await page.getByTestId('analysis-board').waitFor();
  await page.evaluate(({ key, entries }) => localStorage.setItem(key, JSON.stringify({ version: 1, entries })), {
    key: storageKey, entries: [study, practice, spare],
  });
  await page.reload();
  const history = page.locator('.position-history');
  assert.equal(await history.evaluate((element) => element.open), false, 'History starts collapsed');
  await openHistory(page);
  assert.equal(await history.locator('.history-entry').count(), 3);
  const savedGame = history.locator('[data-history-id="browser-game"]');
  assert.equal(await savedGame.locator('.history-board').getAttribute('data-orientation'), 'black');
  assert.equal(await savedGame.locator('.history-square').first().getAttribute('data-square'), 'h1');
  assert.match(await savedGame.innerText(), /White to move · Move 3/);
  assert.equal(await savedGame.locator('time').count(), 1);

  await page.getByLabel('Search saved positions', { exact: true }).fill('Evening');
  assert.equal(await history.locator('.history-entry').count(), 1);
  await page.getByLabel('Filter saved positions', { exact: true }).selectOption('analysis');
  assert.match(await history.innerText(), /No saved positions match/);
  await page.getByLabel('Search saved positions', { exact: true }).fill('');
  assert.equal(await history.locator('.history-entry').count(), 2);
  await page.getByLabel('Filter saved positions', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: 'Rename Quiet study', exact: true }).click();
  await page.getByLabel('Position name', { exact: true }).fill('Endgame desk');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByRole('button', { name: 'Resume Endgame desk', exact: true }).waitFor();
  await page.reload();
  await openHistory(page);
  await page.getByRole('button', { name: 'Resume Endgame desk', exact: true }).waitFor();
  assert.equal((await savedEntries(page)).find((entry) => entry.id === study.id).name, 'Endgame desk', 'Rename persists after reload');
  await page.getByRole('button', { name: 'Delete Spare position', exact: true }).click();
  assert.equal(await history.locator('.history-entry').count(), 2);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all 2 saved positions', exact: true }).waitFor();
  await history.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await history.locator('.history-entry').count(), 2, 'Cancel leaves saved positions intact');
  await page.screenshot({ path: 'artifacts/history/history-desktop.png', fullPage: true });

  // A terminal analysis exercises the real resume pipeline without downloading an engine/model.
  await page.getByRole('button', { name: 'Resume Endgame desk', exact: true }).click();
  assert.equal(await history.evaluate((element) => element.open), false, 'Resume collapses history and returns to the board');
  await page.waitForFunction((fen) => document.querySelector('[data-testid="analysis-board"]')?.getAttribute('data-fen') === fen, study.fen);
  assert.equal(await page.getByRole('button', { name: 'Analyze', exact: true }).getAttribute('aria-pressed'), 'true');
  await assertBlackView(page.getByTestId('analysis-board'));
  for (const [label, value] of [['trappiness', '0.65'], ['aggressiveness', '0.85'], ['tension', '0.75'], ['risk tolerance', '150'], ['risk when winning', '30']]) {
    assert.equal(await page.getByLabel(`Analysis ${label}`, { exact: true }).inputValue(), value);
  }
  assert.equal(await page.getByLabel('Analysis opponent rating', { exact: true }).inputValue(), '1400');
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Save analysis position', exact: true }).click();
  assert.equal((await savedEntries(page)).length, 2, 'Saving an existing analysis updates its snapshot');

  await openHistory(page);
  await page.getByRole('button', { name: 'Resume Evening game', exact: true }).click();
  assert.equal(await history.evaluate((element) => element.open), false);
  assert.equal(await page.getByRole('button', { name: 'Play AI', exact: true }).getAttribute('aria-pressed'), 'true');
  const playBoard = page.locator('.workspace-panel:not([hidden]) .board-wrap');
  await playBoard.locator('[data-square="f3"] [data-piece="wN"]').waitFor();
  await playBoard.locator('[data-square="c6"] [data-piece="bN"]').waitFor();
  await assertBlackView(playBoard);
  assert.deepEqual(await page.locator('.workspace-panel:not([hidden]) .move-row').allTextContents(), ['1.e4e5', '2.Nf3Nc6']);
  assert.match(await page.locator('.workspace-panel:not([hidden]) .board-meta').innerText(), /You play White/);
  for (const [label, value] of [['trappiness', '0.7'], ['aggressiveness', '0.9'], ['tension', '0.8'], ['risk tolerance', '175'], ['risk when winning', '35']]) {
    assert.equal(await page.getByLabel(`Play ${label}`, { exact: true }).inputValue(), value);
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await playBoard.locator('[data-square="g1"] [data-piece="wN"]').waitFor();
  await playBoard.locator('[data-square="b8"] [data-piece="bN"]').waitFor();
  assert.deepEqual(await page.locator('.workspace-panel:not([hidden]) .move-row').allTextContents(), ['1.e4e5'], 'Restored PGN supports undoing a full pair of moves');
  await page.getByRole('button', { name: 'Stockfish', exact: true }).click();
  await page.getByRole('button', { name: 'Save practice game', exact: true }).click();
  const updatedGame = (await savedEntries(page)).find((entry) => entry.id === practice.id);
  const restored = new Chess(); restored.loadPgn(updatedGame.pgn);
  assert.deepEqual(restored.history(), ['e4', 'e5']);
  assert.equal(updatedGame.styleEnabled, false, 'Engine selection is saved explicitly');
  assert.equal(updatedGame.orientation, 'b');
  await page.reload();
  await openHistory(page);
  await page.getByRole('button', { name: 'Resume Evening game', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Stockfish', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('Play aggressiveness', { exact: true }).count(), 0);
  assert.deepEqual(await page.locator('.workspace-panel:not([hidden]) .move-row').allTextContents(), ['1.e4e5']);

  await page.setViewportSize({ width: 320, height: 850 });
  await openHistory(page);
  await page.screenshot({ path: 'artifacts/history/history-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'History and resumed game fit a 320px viewport');
  await page.getByRole('button', { name: 'Rename Evening game', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Inline rename fits a 320px viewport');
  await page.getByRole('button', { name: 'Cancel rename', exact: true }).click();
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all 2 saved positions', exact: true }).click();
  await history.getByText('No saved positions yet.', { exact: true }).waitFor();
  assert.equal((await savedEntries(page)).length, 0);
  await page.reload();
  await openHistory(page);
  await history.getByText('No saved positions yet.', { exact: true }).waitFor();

  // Storage failure keeps this tab usable and clearly describes the persistence limit.
  const denied = await browser.newPage({ viewport: { width: 320, height: 850 } });
  watchErrors(denied);
  await denied.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Storage disabled by browser', 'SecurityError'); };
  });
  await denied.goto(appUrl);
  await denied.getByRole('button', { name: 'Save analysis position', exact: true }).click();
  await openHistory(denied);
  assert.equal(await denied.locator('.history-entry').count(), 1);
  assert.match(await denied.locator('.history-warning').innerText(), /kept for this tab only/);
  await denied.reload();
  await openHistory(denied);
  assert.equal(await denied.locator('.history-entry').count(), 0, 'Session-only history does not pretend to survive a reload');
  assert.deepEqual(errors, []);
  console.log('History browser checks passed: search/filter, thumbnails/orientation, rename/delete/clear with persistence, analysis and PGN game resume, explicit settings, undo, 320px layout, and storage-denied fallback.');
} finally {
  await browser.close();
}
