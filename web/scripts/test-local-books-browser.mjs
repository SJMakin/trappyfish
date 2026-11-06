import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const url = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.TRAPPY_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
const errors = [];
await mkdir('artifacts/books', { recursive: true });
const bytes = Buffer.alloc(16); bytes.writeBigUInt64BE(0x463b96181691fc9cn); bytes.writeUInt16BE(0x031c, 8); bytes.writeUInt16BE(7, 10);
async function setup(page) {
  page.setDefaultTimeout(20_000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/openings/localBooks.ts*', route => route.request().url().includes('books-original') ? route.continue()
    : route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/openings/localBooks.ts?books-original';
      import { loadLocalBook as original } from '/src/openings/localBooks.ts?books-original';
      export async function loadLocalBook(id) {
        if(window.__holdBookRead) { window.__holdBookRead=false; window.__bookPending=true; await new Promise(resolve=>window.__releaseBook=resolve); window.__bookReadResolved=true; }
        return original(id);
      }` }));
  await page.route('**/src/engine/trappy.ts*', route => route.request().url().includes('local-books-original') ? route.continue()
    : route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/engine/trappy.ts?local-books-original';
      import { Chess } from '/node_modules/chess.js/dist/esm/chess.js';
      export class TrappyEngine { cancel(){} terminate(){}
        async chooseMove(fen,settings,enabled,options={}) {
          window.__bookCalls ??= []; window.__bookCalls.push({fen,settings:{...settings},bookMoves:options.bookMoves});
          const board=new Chess(fen), legal=board.moves({verbose:true}), uci=m=>m.from+m.to+(m.promotion??'');
          const move=legal.find(m=>options.bookMoves?.includes(uci(m)))??legal[0];
          const selected={move:uci(move),san:move.san,rootScoreCp:0,adjustedScoreCp:0,riskCp:0,bonusCp:0,expectedScoreCp:0,
            expectedScore:.5,objectiveScore:.5,policyCoverage:0,replies:[],analyzed:true,status:'evaluated'};
          return {move:selected.move,san:selected.san,mode:enabled?'trappy':'standard',rootBestMove:selected.move,
            rootBestSan:selected.san,rootBestScoreCp:0,candidates:[selected],selected,policySource:'stockfish',riskLimitCp:settings.maxRiskCp,
            provenance:{source:options.bookMoves?.length?'opening-book':'search'}};
        }
      }` }));
}
const openBooks = async page => { const details = page.locator('.local-book-library'); if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click(); return details; };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); await setup(page);
  let uploads = 0; page.on('request', request => { if (['POST', 'PUT'].includes(request.method())) uploads++; });
  await page.goto(`${url}/?mode=play`); await page.locator('.fish-rival').waitFor();
  await page.getByRole('button', { name: 'Save practice game', exact: true }).click();
  const books = await openBooks(page);
  await page.getByLabel('Import Polyglot opening book', { exact: true }).setInputFiles({ name: 'broken.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([1]) });
  await books.getByRole('alert').filter({ hasText: /16-byte/ }).waitFor(); assert.equal(await books.locator('.local-book-list li').count(), 0);
  await page.getByLabel('Import Polyglot opening book', { exact: true }).setInputFiles({ name: 'Daring-test.bin', mimeType: 'application/octet-stream', buffer: bytes });
  await books.locator('.local-book-list strong').filter({ hasText: 'Daring-test.bin' }).waitFor();
  await books.getByRole('button', { name: 'Use for new game', exact: true }).click();
  assert.equal(await page.getByLabel('New game opening', { exact: true }).inputValue(), 'polyglot');
  await page.getByLabel('New game colour', { exact: true }).selectOption('b');
  await page.evaluate(() => { window.__holdBookRead = true; });
  await page.getByRole('button', { name: 'Start new game', exact: true }).click();
  await page.waitForFunction(() => window.__bookPending);
  await page.locator('.position-history > summary').click();
  await page.getByRole('button', { name: /^Resume Practice.*White/ }).click();
  await page.evaluate(() => window.__releaseBook()); await page.waitForFunction(() => window.__bookReadResolved);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__bookCalls?.length ?? 0), 0, 'Replacing a game while the local read is pending must not start an orphan search');
  const resumedBooks = await openBooks(page);
  await resumedBooks.getByRole('button', { name: 'Use for new game', exact: true }).click();
  await page.getByLabel('New game colour', { exact: true }).selectOption('b');
  await page.getByRole('button', { name: 'Start new game', exact: true }).click();
  await page.locator('.board-wrap [data-square="e4"] [data-piece="wP"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__bookCalls.at(-1).bookMoves), ['e2e4']);
  assert.match(await page.locator('.play-opening-identity').innerText(), /Daring-test.bin/);
  await page.getByRole('button', { name: 'End unfinished game & review', exact: true }).click();
  await page.getByTestId('game-review').locator('.recorded-book-source').waitFor();
  assert.match(await page.locator('.recorded-book-source').innerText(), /Daring-test.bin.*risk checks/);
  await page.reload();
  await page.locator('.position-history > summary').click();
  await page.locator('.history-entry').filter({ hasText: 'Daring-test.bin' }).getByRole('button', { name: /^Review/ }).click();
  await page.getByTestId('game-review').waitFor();
  const storedBooks = await openBooks(page);
  await storedBooks.locator('.local-book-list strong').filter({ hasText: 'Daring-test.bin' }).waitFor();
  await storedBooks.getByRole('button', { name: 'Use for new game', exact: true }).click();
  await page.getByLabel('New game colour', { exact: true }).selectOption('b');
  await page.getByRole('button', { name: 'Start new game', exact: true }).click();
  await page.locator('.board-wrap [data-square="e4"] [data-piece="wP"]').waitFor();
  const activeBooks = await openBooks(page);
  await activeBooks.getByRole('button', { name: 'Remove book Daring-test.bin', exact: true }).click();
  await page.locator('.board-wrap [data-square="e7"]').click(); await page.locator('.board-wrap [data-square="e5"]').click();
  await page.getByRole('alert').filter({ hasText: 'Opening book unavailable' }).waitFor();
  assert.equal(await page.evaluate(() => window.__bookCalls.length), 1, 'No normal-search fallback is silently substituted for a missing book');
  await page.reload(); await page.locator('.position-history > summary').click();
  await page.locator('.history-entry').filter({ hasText: 'Daring-test.bin' }).getByRole('button', { name: /^Resume/ }).click();
  await page.getByRole('alert').filter({ hasText: 'Opening book unavailable' }).waitFor();
  await page.getByRole('button', { name: 'Continue without book', exact: true }).click();
  await page.waitForFunction(() => window.__bookCalls?.length === 1);
  assert.equal(await page.evaluate(() => window.__bookCalls.at(-1).bookMoves), undefined);
  assert.equal(uploads, 0, 'Local books are never uploaded');
  await page.setViewportSize({ width: 320, height: 740 });
  // The chessboard measures its container after a viewport change.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  await page.screenshot({ path: 'artifacts/books/local-book-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Local book browser checks passed: binary validation, local persistence, exact book nominations, original review, missing-file resume/explicit fallback, cancellation on game replacement, privacy and mobile320.');
} finally { await browser.close(); }
