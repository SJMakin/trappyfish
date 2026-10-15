import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const fen = 'r6q/1ppk1pQp/pNn1pn2/3p3b/1b1P1B2/3BP2N/PPP2PPP/2K4R b - - 0 1';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
await mkdir('artifacts/layout', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${appUrl}/?fen=${encodeURIComponent(fen)}`);
  await page.getByTestId('analysis-results').waitFor({ timeout: 180000 });
  await page.getByTestId('analysis-progress').filter({ hasText: 'Deep analysis ready' }).waitFor({ timeout: 180000 });
  assert.equal(await page.getByTestId('analysis-board').getAttribute('data-fen'), fen);
  assert.equal(await page.locator('.recommendation').count(), 1, 'Matching practical and sound moves share a recommendation');
  assert.equal(await page.locator('.human-reply-tree').getAttribute('open'), null);
  const rows = [];
  for (const viewport of [{ width: 1828, height: 846 }, { width: 1366, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/layout/after-${viewport.width}.png`, fullPage: true });
    await page.screenshot({ path: `artifacts/layout/viewport-${viewport.width}.png` });
    const row = await page.evaluate(() => {
      const rect = (selector) => { const value = document.querySelector(selector).getBoundingClientRect(); return { top: value.top, bottom: value.bottom, height: value.height }; };
      return { width: innerWidth, height: innerHeight, pageHeight: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth,
        board: rect('.research-board-wrap'), plans: rect('.branch-comparison'), transport: rect('.line-transport') };
    });
    rows.push(row);
    assert.equal(row.overflow, false, `${viewport.width}: no horizontal page overflow`);
    if (viewport.width > 780) {
      assert.ok(row.plans.bottom <= row.height, `${viewport.width}: both useful lines must fit on the first screen`);
      assert.ok(row.transport.bottom <= row.height, `${viewport.width}: replay controls must fit with the board`);
    }
  }
  await page.getByRole('link', { name: /^Plans ·/ }).click();
  await page.locator('.trap-column > .research-branch-card').click();
  const mobileBoard = await page.getByTestId('analysis-board').boundingBox();
  assert.ok(mobileBoard.y >= 0 && mobileBoard.y + mobileBoard.height < 844, 'Selecting a plan returns mobile users to the visible board');
  await page.getByRole('button', { name: 'End of line', exact: true }).click();
  const strip = await page.locator('.line-move-chips').evaluate((element) => {
    const selected = element.querySelector('.is-active');
    return { selectedLeft: selected.offsetLeft, selectedRight: selected.offsetLeft + selected.offsetWidth, left: element.scrollLeft, right: element.scrollLeft + element.clientWidth };
  });
  assert.ok(strip.selectedLeft >= strip.left - 1 && strip.selectedRight <= strip.right + 1, 'The current move stays visible in the horizontal line strip');
  await page.locator('.research-more-tools > summary').click();
  assert.equal(await page.getByRole('button', { name: 'Export PGN', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: 'Restore imported position', exact: true }).click();
  assert.equal(await page.getByTestId('analysis-board').getAttribute('data-fen'), fen);
  await page.locator('.human-reply-tree > summary').click();
  assert.ok(await page.getByTestId('analysis-reply').count() >= 1, 'All searched replies remain accessible');
  await page.locator('.analysis-score-details > summary').click();
  assert.match(await page.locator('.analysis-score-details').innerText(), /Human reply coverage:/);
  await page.getByRole('button', { name: /^Compare all/ }).click();
  assert.equal(await page.getByTestId('analysis-candidate').count(), 4, 'Risky alternatives remain available');
  const baseline = JSON.parse(await readFile('artifacts/layout/before.json', 'utf8').catch(() => '[]'));
  const comparison = rows.map((row) => ({ ...row, before: baseline.find((old) => old.width === row.width) }));
  await writeFile('artifacts/layout/review.json', JSON.stringify({ fen, comparison, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(comparison, null, 2));
  console.log('Compact layout passed: actual Maia/Stockfish, desktop viewport fit, mobile plan-to-board navigation, active move visibility, complete reply access, risky alternatives, exports and restore.');
} finally { await browser.close(); }
