import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.TRAPPY_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
const errors = [];
await mkdir('artifacts/traps', { recursive: true });
async function setRange(page, name, value) {
  await page.getByLabel(name, { exact: true }).evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000); page.on('pageerror', error => errors.push(error.message));
  let explorerRequests = 0;
  await page.route('https://explorer.lichess.*/**', route => { explorerRequests++; return route.abort(); });
  await page.route('**/src/engine/trappy.ts*', route => route.request().url().includes('trap-library-original') ? route.continue() : route.fulfill({ contentType: 'application/javascript', body: `
    export * from '/src/engine/trappy.ts?trap-library-original';
    import { Chess } from '/node_modules/chess.js/dist/esm/chess.js';
    export class TrappyEngine {
      cancel() {} terminate() {}
      async chooseMove(fen, settings, enabled, options={}) {
        window.__trapCalls ??= []; window.__trapCalls.push({fen,settings:{...settings},bookMoves:options.bookMoves});
        const board = new Chess(fen), legal = board.moves({verbose:true});
        const uci = move => move.from + move.to + (move.promotion ?? '');
        const move = legal.find(move => options.bookMoves?.includes(uci(move))) ?? legal[0];
        const selected={move:uci(move),san:move.san,rootScoreCp:0,adjustedScoreCp:0,riskCp:0,bonusCp:0,
          expectedScoreCp:0,expectedScore:.5,objectiveScore:.5,policyCoverage:0,replies:[],analyzed:true,status:'evaluated'};
        return {move:selected.move,san:selected.san,mode:enabled?'trappy':'standard',rootBestMove:selected.move,rootBestSan:selected.san,
          rootBestScoreCp:0,candidates:[selected],selected,policySource:'stockfish',riskLimitCp:settings.maxRiskCp,
          provenance:{source:options.bookMoves?.length?'opening-book':'search'}};
      }
    }` }));
  await page.goto(`${appUrl}/?mode=play`);
  await page.locator('.opponent-settings > summary').click();
  await setRange(page, 'Play king attack', .65); await setRange(page, 'Play risk tolerance', 75);
  await page.getByRole('button', { name: '1400', exact: true }).click();
  await page.locator('.opponent-settings > summary').click();
  await page.getByRole('button', { name: 'Explore traps', exact: true }).click();
  const library = page.locator('.opening-browser');
  const trapTab = library.getByRole('button', { name: /^Trap studies/ });
  assert.equal(await trapTab.getAttribute('aria-pressed'), 'true');
  const studyCount = await library.locator('.opening-results li').count(); assert.ok(studyCount >= 15, 'Expanded trap collection should be directly discoverable');
  assert.match(await library.locator('.trap-preview-phase').innerText(), /Before the bait/);
  assert.equal(explorerRequests, 0, 'Opening the trap library never requests human statistics');
  await library.getByRole('searchbox').fill('London');
  assert.equal(await library.locator('.opening-results li').count(), 0, 'The independently refuted London source line is excluded from playable studies');
  await library.getByRole('searchbox').fill('');

  await library.getByLabel('Filter trapper color', { exact: true }).selectOption('b');
  const blackCount = await library.locator('.opening-results li').count(); assert.ok(blackCount > 0 && blackCount < studyCount);
  assert.ok((await library.locator('.opening-results button > span:nth-child(2) > small').allTextContents()).every(label => label.startsWith('Black ·')));
  await library.getByLabel('Filter trapper color', { exact: true }).selectOption('either');
  const motif = await library.getByLabel('Filter trap pattern', { exact: true }).locator('option').nth(1).getAttribute('value');
  await library.getByLabel('Filter trap pattern', { exact: true }).selectOption(motif);
  assert.ok((await library.locator('.opening-results button > span:nth-child(2) > small').allTextContents()).every(label => label.includes(motif)));
  await library.getByLabel('Filter trap pattern', { exact: true }).selectOption('all');
  await library.getByRole('searchbox').fill('Legal');
  assert.equal(await library.locator('.opening-results li').count(), 1);
  await library.locator('.opening-results button').click();
  await library.getByRole('button', { name: 'Preview bait: Nxe5', exact: true }).click();
  assert.match(await library.locator('.trap-preview-phase').innerText(), /Bait played: Nxe5/);
  await library.getByRole('button', { name: 'Preview illustrative reply: Bxd1', exact: true }).click();
  assert.match(await library.locator('.trap-preview-phase').innerText(), /Illustrative reply: Bxd1/);
  await library.getByRole('button', { name: 'Preview continuation: Nd5#', exact: true }).click();
  assert.match(await library.locator('.opening-preview-navigation').innerText(), /Ply 15 \/ 15/);
  assert.match(await library.locator('.opening-trap-study').innerText(), /Best searched defense|Finite searches/);
  assert.equal(await library.locator('.trap-model-sample dl > div').count(), 2, 'Two genuine fixed-rating model references are shown');
  assert.match(await library.locator('.trap-model-sample').innerText(), /separate from observed human frequencies/);
  await library.getByRole('button', { name: /Add Légal queen lure.*to favourites/ }).click();
  await library.getByLabel('Favourites only', { exact: true }).check();
  await library.getByRole('searchbox').fill(''); assert.equal(await library.locator('.opening-results li').count(), 1);
  await library.getByLabel('Favourites only', { exact: true }).uncheck();

  await library.getByRole('button', { name: /^All openings/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Explore openings', exact: true }).getAttribute('aria-expanded'), 'true');
  await trapTab.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('button', { name: 'Explore traps', exact: true }).getAttribute('aria-expanded'), 'true');
  await library.getByRole('searchbox').fill('Fried Liver');
  await library.locator('.opening-results button').click();
  await library.locator('.trap-source-license > summary').click();
  assert.match(await library.locator('.trap-source-license pre').innerText(), /MIT License[\s\S]*John Cabiles/);
  assert.doesNotMatch(await library.locator('.opening-trap-study').innerText(), /winning in practice|inhuman accuracy|99%/i);
  await library.getByRole('searchbox').fill('Légal'); await library.locator('.opening-results button').click();
  await page.screenshot({ path: 'artifacts/traps/library-desktop.png', fullPage: true });

  await library.getByRole('button', { name: 'Face this trap', exact: true }).click();
  assert.equal(await page.getByLabel('New game colour', { exact: true }).inputValue(), 'b');
  assert.equal(await page.getByLabel('Opening start mode', { exact: true }).inputValue(), 'position');
  await page.getByRole('button', { name: 'Start new game', exact: true }).click();
  await page.locator('.board-wrap [data-square="e5"] [data-piece="wN"]').waitFor();
  const chosen = await page.evaluate(() => window.__trapCalls.at(-1));
  assert.deepEqual(chosen.bookMoves, ['f3e5']); assert.equal(chosen.settings.aggression, .65);
  assert.equal(chosen.settings.maxRiskCp, 75); assert.equal(chosen.settings.opponentRating, 1400);
  assert.match(await page.locator('.board-meta').innerText(), /You play Black/);
  assert.equal(await page.locator('.opening-trap-study').count(), 0, 'Teaching details close before live play');
  assert.equal(await page.locator('.trap-line-replay').count(), 0); assert.equal(await page.getByTestId('game-review').count(), 0);

  await page.getByRole('button', { name: 'Explore traps', exact: true }).click();
  await library.getByRole('button', { name: 'Play this trap', exact: true }).click();
  assert.equal(await page.getByLabel('New game colour', { exact: true }).inputValue(), 'w');
  await page.getByRole('button', { name: 'Start new game', exact: true }).click();
  await page.locator('.board-wrap [data-square="f3"] [data-piece="wN"]').waitFor();
  assert.equal(await page.locator('.board-wrap [data-square="e5"] [data-piece="bP"]').count(), 1);
  assert.match(await page.locator('.panel-header p').innerText(), /Your move/);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('button', { name: 'Explore traps', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'artifacts/traps/library-mobile.png', fullPage: true });
  assert.equal(explorerRequests, 0); assert.deepEqual(errors, []);
  console.log('Trap library browser passed: direct collection/filtering, full legal replay, source license, explicit sides and unchanged settings, private live play, mobile320 and no implicit statistics.');
} finally { await browser.close(); }
