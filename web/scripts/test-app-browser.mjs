import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { Chess } from 'chess.js';
import { mkdir } from 'node:fs/promises';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5180';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
await mkdir('artifacts/ux', { recursive: true });
const board = new Chess();
for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'Nc3', 'Bg4', 'h3', 'Bh5']) board.move(move);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${appUrl}/?mode=play&engine=trappyfish&player=b&fen=${encodeURIComponent(board.fen())}`);
  await page.locator('.board-wrap [data-square="e5"] [data-piece="wN"]').waitFor({ timeout: 180_000 });
  assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.decision-main:visible').count(), 0, 'Play must hide current evaluations');
  assert.equal(await page.locator('.trap-box:visible').count(), 0, 'Play must hide predicted mistakes and punishment');
  assert.equal(await page.locator('.board-wrap marker').count(), 0, 'Play must not draw engine or trap arrows');
  await page.screenshot({ path: 'artifacts/ux/trap-play-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  assert.equal(await page.locator('.decision-main strong').first().innerText(), 'Nxe5', 'Real browser engine must find sound Legal bait');
  assert.match(await page.locator('.trap-box').innerText(), /Bxd1/);
  assert.match(await page.locator('.trap-box').innerText(), /%/);
  await page.screenshot({ path: 'artifacts/ux/trap-analysis-desktop.png', fullPage: true });
  assert.equal(await page.locator('.error-strip').count(), 0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  assert.equal(await page.locator('.trap-box:visible').count(), 0);

  // The human takes the queen; Stockfish must execute the mating punishment.
  await page.locator('.board-wrap [data-square="h5"]').click();
  await page.locator('.board-wrap [data-square="d1"]').click();
  await page.locator('.board-wrap [data-square="f7"] [data-piece="wB"]').waitFor({ timeout: 180_000 });
  assert.equal(await page.locator('.decision-main:visible').count(), 0, 'Current plan remains hidden after punishment');
  await page.locator('.past-review > summary').click();
  assert.equal(await page.locator('.past-review .punishment-line').count(), 0, 'Play review must not reveal continuations that could still contain a live trap');
  assert.equal(await page.locator('.past-review .reply-list').count(), 0, 'Play review must contain committed facts only');
  assert.match(await page.locator('.committed-review').innerText(), /Bxd1/);
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  assert.equal(await page.locator('.past-review .decision-main strong').first().innerText(), 'Nxe5', 'Post-move review must retain the previous engine plan');
  assert.match(await page.locator('.review-intro').innerText(), /Bxd1/);
  assert.match(await page.locator('.past-review .punishment-line').innerText(), /Bxf7\+/, 'Saved position must render the previous continuation in SAN');
  assert.equal(await page.locator('.error-strip').count(), 0);

  // Standard mode must work from the built bundle without loading a policy.
  const standard = await browser.newPage();
  standard.on('pageerror', (error) => errors.push(error.message));
  await standard.goto(`${appUrl}/?mode=play`);
  await standard.getByRole('button', { name: 'Stockfish', exact: true }).click();
  await standard.getByRole('button', { name: 'Analysis', exact: true }).click();
  await standard.getByRole('button', { name: 'New game', exact: true }).click();
  await standard.getByLabel('New game colour').selectOption('b');
  await standard.getByRole('button', { name: 'Start new game', exact: true }).click();
  await standard.locator('.decision-main strong').first().waitFor({ timeout: 60_000 });
  const played = await standard.locator('.decision-main strong').first().innerText();
  assert.ok(new Chess().moves().includes(played), `Standard mode returned illegal SAN ${played}`);
  assert.equal(await standard.locator('.error-strip').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Built-app browser checks passed: hidden Play predictions/arrows, explicit Analysis, real Maia + Stockfish Legal bait, tap-to-move queen capture, punishment, previous-plan review, and Stockfish mode.');
} finally {
  await browser.close();
}
