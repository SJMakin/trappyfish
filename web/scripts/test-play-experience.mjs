import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const url = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.TRAPPY_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
const errors = [];
await mkdir('artifacts/play', { recursive: true });
const mock = `
  export * from '/src/engine/trappy.ts?play-original';
  import { Chess } from '/node_modules/chess.js/dist/esm/chess.js';
  export class TrappyEngine {
    cancel() {} terminate() {}
    async chooseMove(fen,settings,enabled,options={}) {
      window.__playCalls ??= []; window.__playCalls.push({fen,settings:{...settings},bookMoves:options.bookMoves});
      options.onProgress?.({stage:'replies',message:'SECRET Nxf7 Qh4#',candidate:'SECRET',completed:1,total:5,
        diagnostics:{elapsedMs:100,stockfishCalls:6,policyCalls:2,policyTimeMs:5,nodes:900,maxDepth:12,rootTrace:[{depth:12,move:'h4f7',scoreCp:333}]}});
      if(window.__holdNext) { window.__holdNext=false; await new Promise(resolve=>window.__releasePlay=resolve); }
      const board=new Chess(fen), legal=board.moves({verbose:true});
      const uci=m=>m.from+m.to+(m.promotion??'');
      const preferred=options.bookMoves?.[0] ?? ['e7e5','b8c6','g8f6','d7d6','e2e4'].find(m=>legal.some(l=>uci(l)===m)) ?? uci(legal[0]);
      const move=board.move(preferred);
      const selected={move:preferred,san:move.san,rootScoreCp:0,adjustedScoreCp:0,riskCp:0,bonusCp:0,
        expectedScoreCp:0,expectedScore:.5,objectiveScore:.5,policyCoverage:0,replies:[],analyzed:true,status:'evaluated'};
      return {move:preferred,san:move.san,mode:enabled?'trappy':'standard',rootBestMove:preferred,rootBestSan:move.san,
        rootBestScoreCp:0,candidates:[selected],selected,policySource:'stockfish',riskLimitCp:settings.maxRiskCp,
        provenance:{source:options.bookMoves?.length?'opening-book':'search'},
        diagnostics:{elapsedMs:120,stockfishCalls:6,policyCalls:2,policyTimeMs:5,nodes:900,maxDepth:12}};
    }
  }`;
async function setup(page) {
  page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(60_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/engine/trappy.ts*', route => route.request().url().includes('play-original') ? route.continue()
    : route.fulfill({ contentType: 'application/javascript', body: mock }));
}
async function move(page, from, to) { await page.locator(`.board-wrap [data-square="${from}"]`).click(); await page.locator(`.board-wrap [data-square="${to}"]`).click(); }
async function setRange(page, name, value) {
  await page.getByLabel(name, { exact: true }).evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await setup(page);
  let explorerRequests = 0; page.on('request', request => { if (request.url().includes('explorer.lichess')) explorerRequests++; });
  await page.goto(`${url}/?mode=play`); await page.locator('.fish-rival').waitFor();
  assert.equal(await page.locator('.opponent-settings').getAttribute('open'), null);
  assert.match(await page.locator('.play-settings-summary').innerText(), /Deep/);
  await page.locator('.opponent-settings > summary').click();
  assert.equal(await page.getByLabel('Engine continuations per branch', { exact: true }).inputValue(), '2');
  await setRange(page, 'Play king attack', .8);
  await page.locator('.budget-choices').getByRole('button', { name: 'Quick', exact: true }).click();
  assert.equal(await page.getByLabel('Play king attack', { exact: true }).inputValue(), '.8'.replace(/^\./, '0.'));
  assert.equal(await page.getByLabel('Play risk tolerance', { exact: true }).inputValue(), '100');
  assert.match(await page.locator('.budget-readout').innerText(), /12 \/ 8/);
  await page.locator('.budget-choices').getByRole('button', { name: 'Deep', exact: true }).click();
  await page.locator('.opponent-settings > summary').click();
  await page.evaluate(() => { window.__holdNext = true; }); await move(page, 'e2', 'e4');
  await page.waitForFunction(() => Boolean(window.__releasePlay));
  assert.match(await page.locator('.rival-activity').innerText(), /Modeling human replies|900|12/);
  assert.doesNotMatch(await page.locator('main').innerText(), /SECRET|Nxf7|Qh4#|333/);
  assert.equal(await page.getByTestId('game-review').count(), 0);
  await page.evaluate(() => window.__releasePlay());
  await page.locator('.board-wrap [data-square="e5"] [data-piece="bP"]').waitFor();
  await page.getByRole('button', { name: 'Explore openings', exact: true }).click();
  await page.locator('.opening-preview-title h3').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Add Italian Game to favourites', exact: true }).click();
  await page.getByRole('button', { name: 'Use favourites for new games (1)', exact: true }).click();
  assert.equal(await page.getByLabel('New game opening', { exact: true }).inputValue(), 'favourites');
  await page.getByRole('button', { name: 'Start new game', exact: true }).click();
  await move(page, 'e2', 'e4'); await page.locator('.board-wrap [data-square="e5"] [data-piece="bP"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__playCalls.at(-1).bookMoves), ['e7e5']);
  await move(page, 'd2', 'd4'); await page.waitForFunction(() => window.__playCalls.length >= 3);
  await page.waitForFunction(() => !document.querySelector('.rival-activity[data-searching="true"]'));
  await page.getByRole('button', { name: 'Opening guidance', exact: true }).click();
  await page.getByRole('button', { name: 'Rewind to opening', exact: true }).click();
  assert.match(await page.locator('.moves').innerText(), /e4\s+e5/);
  assert.doesNotMatch(await page.locator('.moves').innerText(), /d4/);
  await page.getByRole('button', { name: 'End unfinished game & review', exact: true }).click();
  await page.getByTestId('game-review').waitFor();
  await page.getByRole('heading', { name: 'Why e5?', exact: true }).waitFor();
  assert.match(await page.getByTestId('game-review').innerText(), /Opening book · safety verified/);
  await page.reload(); await page.locator('.history-summary').count();
  await page.locator('.position-history > summary').click();
  await page.locator('.history-entry').filter({ hasText: /Favourite openings/ }).getByRole('button', { name: /^Review/ }).first().click();
  await page.getByTestId('game-review').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Resign & review', exact: true }).count(), 0, 'Resuming an ended game must not restart the opponent');
  await page.evaluate(async () => { const library = await import('/src/openings/library.ts');
    library.setFavouriteIds([...library.loadFavouriteIds(), library.allOpenings.find(opening => opening.name === 'French Defense').id]); });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('trappy.opening-favourites.v1')).length === 2);
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  assert.equal(await page.getByLabel('New game opening', { exact: true }).inputValue(), 'favourites', 'Explicit favourites default survives reload');
  await page.waitForFunction(() => document.querySelector('[aria-label="New game opening"]').textContent.includes('Favourites · 2 lines'));
  await page.getByRole('button', { name: 'Browse openings', exact: true }).click();
  await page.getByRole('button', { name: 'Previous opening move', exact: true }).click();
  await page.getByRole('button', { name: 'Start at preview position', exact: true }).click();
  await page.getByRole('button', { name: 'Start new game', exact: true }).click();
  assert.match(await page.locator('.moves').innerText(), /e4\s+e5[\s\S]*Nf3\s+Nc6/, 'Starting at preview preserves PGN prefix');
  assert.equal(explorerRequests, 0, 'Catalogue, favourites and gameplay never request online statistics implicitly');
  await page.screenshot({ path: 'artifacts/play/play-desktop.png', fullPage: true });
  const mobile = await browser.newPage({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' }); await setup(mobile);
  await mobile.goto(`${url}/?mode=play`); await mobile.locator('.fish-rival').waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await mobile.locator('.rival-fish').evaluate(el => getComputedStyle(el).animationName), 'none');
  await mobile.getByRole('button', { name: 'Explore openings', exact: true }).click();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: 'artifacts/play/play-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Play experience passed: explicit budgets, private real activity, opening/favourites/preview, deviation rewind, stored review/resume, offline data, mobile320 and reduced motion.');
} finally { await browser.close(); }
