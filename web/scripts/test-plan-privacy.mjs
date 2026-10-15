import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { Chess } from 'chess.js';

// This source-module regression uses the dev server to supply a deterministic two-turn trap.
// Real Maia/Stockfish selection is exercised separately in test-app-browser.mjs.
const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const board = new Chess();
for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']) board.move(move);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
function decision(move, san, reply, trap) {
  const selected = {
    move, san, rootScoreCp: -20, adjustedScoreCp: 90, riskCp: 0, bonusCp: 110,
    expectedScoreCp: 90, expectedScore: 0.7, objectiveScore: 0.7, policyCoverage: 0.95,
    replies: [reply], trap, mistakeProbability: 0.48,
  };
  return { move, san, mode: 'trappy', rootBestMove: move, rootBestSan: san, rootBestScoreCp: -20,
    candidates: [selected], selected, policySource: 'maia' };
}
const bait = decision('c6d4', 'Nd4', {
  move: 'f3e5', san: 'Nxe5', probability: 0.62, scoreCp: 0, expectedScore: 0.7, lossCp: 20,
  punishment: ['d8g5', 'e5f7', 'g5g2'],
  continuation: { move: 'd8g5', san: 'Qg5', scoreCp: 0, expectedScore: 0.7, policyCoverage: 0.95,
    replies: [{ move: 'e5f7', san: 'Nxf7', probability: 0.78, scoreCp: 600, expectedScore: 0.95, lossCp: 600, punishment: ['g5g2'] }] },
}, { reply: 'f3e5', replySan: 'Nxe5', probability: 0.62, profitCp: 20, scoreCp: 0,
  punishment: ['d8g5', 'e5f7', 'g5g2'], setupSan: 'Qg5',
  nextReply: { reply: 'e5f7', replySan: 'Nxf7', probability: 0.78, scoreCp: 600 } });
const followUp = decision('d8g5', 'Qg5', {
  move: 'e5f7', san: 'Nxf7', probability: 0.78, scoreCp: 600, expectedScore: 0.95, lossCp: 600, punishment: ['g5g2'],
}, { reply: 'e5f7', replySan: 'Nxf7', probability: 0.78, profitCp: 600, scoreCp: 600, punishment: ['g5g2'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  let intercepted = false;
  await page.route('**/src/engine/trappy.ts*', (route) => {
    if (route.request().url().includes('privacy-original')) return route.continue();
    intercepted = true;
    return route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/engine/trappy.ts?privacy-original';
      export class TrappyEngine {
        turn = 0; cancel() {} terminate() {}
        async chooseMove() { return this.turn++ === 0 ? ${JSON.stringify(bait)} : ${JSON.stringify(followUp)}; }
      }
    ` });
  });
  await page.goto(`${appUrl}/?mode=play&fen=${encodeURIComponent(board.fen())}`);
  assert.equal(intercepted, true, 'This deterministic regression requires the Vite dev server');
  await page.locator('.board-wrap [data-square="d4"] [data-piece="bN"]').waitFor();
  assert.equal(await page.locator('.trap-box').count(), 0);
  await page.locator('.board-wrap [data-square="f3"]').click();
  await page.locator('.board-wrap [data-square="e5"]').click();
  await page.locator('.board-wrap [data-square="g5"] [data-piece="bQ"]').waitFor();
  await page.locator('.past-review > summary').click();
  const review = await page.locator('.past-review').innerText();
  assert.match(review, /Nxe5/);
  assert.doesNotMatch(review, /Nxf7|Qg5|Qxg2|Stockfish continuation|Predicted reply|Tempting line/, 'Play review must not disclose the second-turn trap through a saved first-turn plan');
  assert.equal(await page.locator('.past-review .decision-main').count(), 0);
  assert.equal(await page.locator('.reply-list').count(), 0);
  assert.equal(await page.locator('.board-wrap marker').count(), 0);
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  assert.match(await page.locator('.past-review').innerText(), /Nxe5 → Qg5 → Nxf7/);
  assert.match(await page.locator('.past-review .punishment-line').last().innerText(), /Qg5 Nxf7 Qxg2/, 'Analysis must render the saved continuation against its original position');
  assert.match(await page.locator('.side-panel > .decision .trap-box').innerText(), /Nxf7/);
  assert.deepEqual(errors, []);
  console.log('Two-turn plan privacy passed: committed-only Play review hides live follow-up traps; explicit Analysis restores correctly rendered saved plans.');
} finally { await browser.close(); }
