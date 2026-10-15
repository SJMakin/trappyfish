import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { Chess } from 'chess.js';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const placement = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (error) => failures.push(error.message));
  const recognitionRequests = [];
  page.on('request', (request) => {
    if (/\/fenshot\/.*\.(?:onnx|wasm)$/.test(request.url())) recognitionRequests.push(request.url());
  });
  await page.goto(appUrl);
  await page.locator('.research-board-wrap [data-square="e1"]').waitFor();
  const screenshot = await page.getByTestId('analysis-board').screenshot();
  assert.equal(recognitionRequests.length, 0, 'Recognition model must not load before a scan');
  await page.getByLabel('Upload chessboard screenshot').setInputFiles({ name: 'board.png', mimeType: 'image/png', buffer: screenshot });
  await page.getByText('Board detected. Review the pieces, whose turn it is, and castling; then analyze.', { exact: true }).waitFor({ timeout: 90_000 });
  assert.equal(await page.locator('#import-fen').inputValue(), `${placement} w - - 0 1`);
  assert.equal(recognitionRequests.length, 2, 'Local classifier and WASM runtime are loaded lazily');
  assert.equal(await page.locator('.scan-confidence').count(), 1, 'The real app screenshot should read confidently');
  await page.getByLabel('Side to move', { exact: true }).selectOption('b');
  assert.equal(await page.locator('#import-fen').inputValue(), `${placement} b - - 0 1`);

  for (const eventType of ['paste', 'drop']) {
    await page.locator('#import-fen').fill('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    await page.evaluate(({ base64, eventType }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], `${eventType}.png`, { type: 'image/png' }));
      if (eventType === 'paste') window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      else document.querySelector('.image-drop-zone').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }, { base64: screenshot.toString('base64'), eventType });
    await page.waitForFunction((expected) => document.querySelector('#import-fen').value === expected, `${placement} w - - 0 1`, { timeout: 90_000 });
  }
  await page.getByText('White O-O', { exact: true }).click();
  assert.equal((await page.locator('#import-fen').inputValue()).split(' ')[2], 'K');
  await page.getByRole('button', { name: 'Flip board view', exact: true }).click();
  assert.equal(await page.locator('#import-fen').inputValue(), `${placement} w K - 0 1`, 'One view flip must preserve all FEN fields, including castling');
  assert.equal(await page.locator('.import-preview').getAttribute('data-orientation'), 'black');
  await page.getByRole('button', { name: 'Flip board view', exact: true }).click();
  assert.equal(await page.locator('#import-fen').inputValue(), `${placement} w K - 0 1`);

  // A screenshot genuinely rendered from Black's view must read to the same FEN.
  const blackPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await blackPage.goto(`${appUrl}/?mode=play&player=b&fen=${encodeURIComponent(`${placement} b - - 0 1`)}`);
  await blackPage.locator('.board-wrap [data-square="e8"]').waitFor();
  const blackScreenshot = await blackPage.locator('.board-wrap').screenshot();
  await page.getByLabel('Upload chessboard screenshot').setInputFiles({ name: 'black-board.png', mimeType: 'image/png', buffer: blackScreenshot });
  await page.getByText('Detected black at the bottom.', { exact: false }).waitFor({ timeout: 90_000 });
  assert.equal(await page.locator('#import-fen').inputValue(), `${placement} b - - 0 1`);
  assert.match(await page.locator('.import-warning').innerText(), /Assuming Black to move/);
  await blackPage.close();

  // The user's Nb6+ position: check overrides orientation and c7xb6 must be available.
  const checkedPlacement = 'r6q/1ppk1pQp/pNn1pn2/3p3b/1b1P1B2/3BP2N/PPP2PPP/2K4R';
  const checked = await browser.newPage();
  await checked.goto(`${appUrl}/?mode=play&player=b&fen=${encodeURIComponent(`${checkedPlacement} b - - 0 1`)}`);
  await checked.locator('.board-wrap [data-square="d7"]').waitFor();
  const checkedScreenshot = await checked.locator('.board-wrap').screenshot();
  await page.getByLabel('Upload chessboard screenshot').setInputFiles(process.env.TRAPPY_SCREENSHOT_FILE
    ?? { name: 'nb6-check.png', mimeType: 'image/png', buffer: checkedScreenshot });
  await page.waitForFunction((expected) => document.querySelector('#import-fen').value === expected, `${checkedPlacement} b - - 0 1`, { timeout: 90000 });
  await page.getByText('Black is in check, so Black must move next.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Side to move', { exact: true }).inputValue(), 'b');
  assert.equal(await page.locator('.import-preview').getAttribute('data-orientation'), 'black', 'The review starts from the detected screenshot viewpoint');
  const pawnBefore = await page.locator('.import-preview [data-square="c7"]').boundingBox();
  await page.getByRole('button', { name: 'Flip board view', exact: true }).click();
  const pawnAfter = await page.locator('.import-preview [data-square="c7"]').boundingBox();
  assert.notEqual(pawnAfter.x, pawnBefore.x, 'Flipping changes the visual viewpoint');
  assert.equal(await page.locator('#import-fen').inputValue(), `${checkedPlacement} b - - 0 1`);
  assert.equal(new Chess(await page.locator('#import-fen').inputValue()).move('cxb6').lan, 'c7b6', 'Capturing the knight remains legal after a single view flip');
  assert.equal(await page.locator('.import-preview [data-square="c7"] [data-piece="bP"]').count(), 1);
  assert.equal(await page.locator('.import-preview [data-square="b6"] [data-piece="wN"]').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Remap piece squares (changes FEN)', exact: true }).isVisible(), false, 'Square remapping is absent from the normal flip flow');
  await page.getByRole('button', { name: 'Correct pieces', exact: true }).click();
  await page.locator('.import-orientation-correction > summary').click();
  await page.getByRole('button', { name: 'Remap piece squares (changes FEN)', exact: true }).click();
  assert.notEqual(await page.locator('#import-fen').inputValue(), `${checkedPlacement} b - - 0 1`, 'The explicit correction still remaps incorrectly detected squares');
  assert.match(await page.locator('.import-notice').innerText(), /Piece squares changed/);
  assert.equal(await page.locator('.import-preview [data-square="f2"] [data-piece="bP"]').count(), 1);
  await page.getByRole('button', { name: 'Finish corrections', exact: true }).click();
  await checked.close();
  await page.locator('#import-fen').fill(`${checkedPlacement} w - - 0 1`);
  assert.equal(await page.getByRole('button', { name: 'Analyze position', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Set Black to move', exact: true }).click();
  assert.equal(await page.locator('#import-fen').inputValue(), `${checkedPlacement} b - - 0 1`);
  assert.equal(await page.getByRole('button', { name: 'Analyze position', exact: true }).isEnabled(), true);
  const epFen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 17 43';
  await page.locator('#import-fen').fill(epFen);
  await page.getByRole('button', { name: 'Flip board view', exact: true }).click();
  assert.equal(await page.locator('#import-fen').inputValue(), epFen, 'View flips preserve en passant and move counters too');

  // Non-board images must report failure and leave the loaded game intact.
  const blankImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 400;
    canvas.getContext('2d').fillRect(0, 0, 400, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Upload chessboard screenshot').setInputFiles({ name: 'not-a-board.png', mimeType: 'image/png', buffer: Buffer.from(blankImage, 'base64') });
  await page.getByText('No chessboard found.', { exact: false }).waitFor({ timeout: 90_000 });
  await page.locator('#import-fen').fill('8/8/8/8/8/8/4k3/4K3 w - - 0 1');
  assert.equal(await page.getByRole('button', { name: 'Analyze position', exact: true }).isDisabled(), true);
  const sparse = '4k3/8/8/8/8/8/8/4K2R w - - 0 1';
  await page.locator('#import-fen').fill(sparse);
  assert.equal(await page.getByLabel('You play', { exact: true }).count(), 0, 'Research import should ask whose turn it is, not who plays an AI');
  await page.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.research-board-wrap [data-piece]').length === 3);
  assert.equal(await page.locator('.research-board-wrap [data-piece]').count(), 3);
  await page.getByTestId('analysis-results').waitFor({ timeout: 180_000 });
  assert.equal(await page.getByTestId('analysis-results').getAttribute('data-analysis-fen'), sparse, 'Imported position must analyze immediately without an engine move');
  assert.ok(await page.getByTestId('analysis-candidate').count() > 0, 'A loaded screenshot/FEN must produce useful candidate analysis');
  assert.equal(await page.locator('.position-import').getAttribute('open'), null, 'Successful import closes review to show the analysis');
  assert.equal(await page.locator('.move-scroll').count(), 0, 'Research workspace should show lines, not an empty game move list');

  // Exercise the review gate using an uncertain classifier response.
  const uncertain = await browser.newPage();
  await uncertain.route('**/src/import/fenshot.ts*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export async function recognizeScreenshot() { return { fen: '${placement} w - - 0 1', reliable: false, minConfidence: 0.4, meanConfidence: 0.92, orientation: 'white' }; }`,
  }));
  await uncertain.goto(appUrl);
  await uncertain.getByLabel('Upload chessboard screenshot').setInputFiles({ name: 'uncertain.png', mimeType: 'image/png', buffer: screenshot });
  await uncertain.getByText('Uncertain read', { exact: false }).waitFor();
  assert.equal(await uncertain.getByRole('button', { name: 'Analyze position', exact: true }).isDisabled(), true);
  await uncertain.getByLabel('I checked the board and corrected any mistakes.').check();
  await uncertain.getByRole('button', { name: 'Flip board view', exact: true }).click();
  assert.equal(await uncertain.getByLabel('I checked the board and corrected any mistakes.').isChecked(), true, 'Changing viewpoint does not invalidate a reviewed position');
  assert.equal(await uncertain.getByRole('button', { name: 'Analyze position', exact: true }).isEnabled(), true);
  await uncertain.close();

  // Import while a real UCI search is pending; a delayed old search cannot move the new board.
  const searching = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  searching.on('pageerror', (error) => failures.push(error.message));
  await searching.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message, transfer) {
        if (typeof message === 'string' && message.startsWith('go ')) {
          window.__pendingSearch = true;
          window.setTimeout(() => super.postMessage(message, transfer), 3000);
        } else super.postMessage(message, transfer);
      }
    };
  });
  await searching.goto(`${appUrl}/?mode=play&fen=${encodeURIComponent(`${placement} b KQkq - 0 1`)}`);
  await searching.waitForFunction(() => window.__pendingSearch, undefined, { timeout: 30_000 });
  await searching.getByText('Set position from FEN or screenshot', { exact: true }).click();
  await searching.locator('#import-fen').fill(sparse);
  await searching.getByRole('button', { name: 'Load position', exact: true }).click();
  await searching.getByText('Position loaded.', { exact: true }).waitFor();
  await searching.waitForTimeout(3500);
  assert.equal(await searching.locator('.board-wrap [data-piece]').count(), 3);
  assert.equal(await searching.locator('.panel-header p').innerText(), 'Your move.');
  assert.equal(await searching.locator('.move-scroll').innerText(), 'No moves yet.');
  assert.equal(await searching.locator('.decision.empty-state').count(), 1);
  await searching.close();

  assert.deepEqual(failures, [], 'The app should not produce uncaught browser errors');
  console.log('Browser screenshot import passed: primary Analyze workflow, real White/Black scans, upload/paste/drop, lazy assets, orientation, rights, invalid FEN, no-board failure, immediate Stockfish/Maia candidate analysis with root preserved, uncertain-read review, and Play import during a pending UCI search.');
} finally {
  await browser.close();
}
