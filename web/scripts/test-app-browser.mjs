import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { Chess } from 'chess.js';
import { mkdir } from 'node:fs/promises';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5180';
const channel = process.env.TRAPPY_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
const errors = [];
await mkdir('artifacts/ux', { recursive: true });
const board = new Chess();
for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'Nc3', 'Bg4', 'h3', 'Bh5']) board.move(move);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(45_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${appUrl}/?mode=play&engine=trappyfish&player=b&fen=${encodeURIComponent(board.fen())}`);
  await page.locator('.board-wrap [data-square="e5"] [data-piece="wN"]').waitFor({ timeout: 300_000 });
  assert.equal(await page.locator('.decision-main:visible').count(), 0, 'Play must hide current evaluations');
  assert.equal(await page.locator('.trap-box:visible').count(), 0, 'Play must hide predicted mistakes and punishment');
  assert.equal(await page.locator('.board-wrap marker').count(), 0, 'Play must not draw engine or trap arrows');
  await page.screenshot({ path: 'artifacts/ux/trap-play-desktop.png', fullPage: true });
  assert.equal(await page.getByTestId('game-review').count(), 0, 'The real engine decision remains private until the game ends');
  assert.match(await page.locator('.move-row').last().innerText(), /Nxe5/, 'Real Maia and Stockfish must find the sound Légal bait');

  // The human takes the queen; Stockfish must execute the mating punishment.
  await page.locator('.board-wrap [data-square="h5"]').click();
  await page.locator('.board-wrap [data-square="d1"]').click();
  await page.locator('.board-wrap [data-square="f7"] [data-piece="wB"]').waitFor({ timeout: 300_000 });
  assert.equal(await page.locator('.decision-main:visible').count(), 0, 'Current plan remains hidden after punishment');
  assert.equal(await page.getByTestId('game-review').count(), 0, 'Committed moves still do not unlock live tactical plans');
  await page.getByRole('button', { name: 'End unfinished game & review', exact: true }).click();
  const review = page.getByTestId('game-review'); await review.waitFor();
  await review.getByRole('heading', { name: 'Why Nxe5?', exact: true }).waitFor();
  assert.match(await review.innerText(), /Bxd1/);
  assert.match(await review.locator('.recorded-bait-line').innerText(), /Bxf7\+/, 'The original root position must render the actual mating continuation in SAN');
  await page.screenshot({ path: 'artifacts/ux/trap-review-desktop.png', fullPage: true });
  assert.equal(await page.locator('.error-strip').count(), 0);

  // Standard mode must work from the built bundle without loading a policy.
  const standard = await browser.newPage();
  standard.setDefaultTimeout(45_000);
  standard.on('pageerror', (error) => errors.push(error.message));
  await standard.goto(`${appUrl}/?mode=play`);
  await standard.locator('.opponent-settings > summary').click();
  await standard.getByRole('button', { name: 'Stockfish', exact: true }).click();
  await standard.getByRole('button', { name: 'New game', exact: true }).click();
  await standard.getByLabel('New game colour').selectOption('b');
  await standard.getByRole('button', { name: 'Start new game', exact: true }).click();
  await standard.locator('.move-row').first().waitFor({ timeout: 60_000 });
  const played = await standard.locator('.move-row').first().locator('span').nth(1).innerText();
  assert.ok(new Chess().moves().includes(played), `Standard mode returned illegal SAN ${played}`);
  assert.equal(await standard.locator('.error-strip').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Built-app browser checks passed: private live predictions, real Maia + Stockfish Légal bait, queen capture and mating punishment, recorded post-game review, and explicit Stockfish mode.');
} finally {
  await browser.close();
}
