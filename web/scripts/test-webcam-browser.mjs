import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const recognitionModule = `
export async function recognizeScreenshot(file) {
  const bitmap = await createImageBitmap(file);
  window.__webcamFiles.push({ isFile: file instanceof File, name: file.name, type: file.type, width: bitmap.width, height: bitmap.height });
  bitmap.close();
  if (window.__delayRecognition) await new Promise(resolve => { window.__resolveRecognition = resolve; });
  return { fen: '${fen}', reliable: false, minConfidence: .5, meanConfidence: .9, orientation: 'white', turnSource: 'orientation' };
}`;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/import/fenshot.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: recognitionModule }));
  await page.addInitScript(() => {
    window.__cameraCalls = [];
    window.__cameraTracks = [];
    window.__webcamFiles = [];
    const media = {
      async getUserMedia(constraints) {
        window.__cameraCalls.push(constraints);
        if (window.__cameraFailure) throw new DOMException('Fake camera error', window.__cameraFailure);
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const context = canvas.getContext('2d');
        context.fillStyle = '#aaaaaa'; context.fillRect(0, 0, 640, 480);
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0];
        const originalStop = track.stop.bind(track);
        const ticker = setInterval(() => context.fillRect(0, 0, 1, 1), 50);
        track.stop = () => { clearInterval(ticker); originalStop(); };
        track.getSettings = () => ({ deviceId: constraints.video.deviceId?.exact ?? 'rear-camera', facingMode: constraints.video.facingMode?.ideal ?? 'environment' });
        window.__cameraTracks.push(track);
        if (window.__delayCamera) await new Promise(resolve => { window.__resolveCamera = () => resolve(); });
        return stream;
      },
      async enumerateDevices() {
        return [{ kind: 'videoinput', deviceId: 'rear-camera', label: 'Test rear camera' }, { kind: 'videoinput', deviceId: 'front-camera', label: 'Test front camera' }];
      },
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (window.__delayFrame) window.__resolveFrame = () => nativeToBlob.call(this, callback, ...args);
      else nativeToBlob.call(this, callback, ...args);
    };
  });
  const importer = () => page.locator('.workspace-panel:not([hidden]) .position-import');
  const openCamera = async () => {
    await importer().getByRole('button', { name: 'Use webcam', exact: true }).click();
    await importer().getByRole('button', { name: 'Capture position', exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Capture position') && !button.disabled));
  };
  const allStopped = async () => page.waitForFunction(() => window.__cameraTracks.length > 0 && window.__cameraTracks.every((track) => track.readyState === 'ended'));

  await page.goto(appUrl);
  await importer().getByRole('button', { name: 'Use webcam', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__cameraCalls.length), 0, 'The camera must start only after an explicit click');
  await openCamera();
  assert.deepEqual(await page.evaluate(() => window.__cameraCalls[0]), { audio: false, video: { facingMode: { ideal: 'environment' } } });
  await importer().getByLabel('Camera', { exact: true }).selectOption('front-camera');
  await page.waitForFunction(() => window.__cameraCalls.length === 2 && window.__cameraTracks[0].readyState === 'ended');
  assert.deepEqual(await page.evaluate(() => window.__cameraCalls[1]), { audio: false, video: { deviceId: { exact: 'front-camera' } } });
  await importer().getByRole('button', { name: 'Cancel', exact: true }).click();
  await allStopped();
  await importer().getByRole('button', { name: 'Use webcam', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent.includes('Use webcam'));

  // Captured pixels become an ordinary PNG File in the existing recognition path.
  await openCamera();
  await importer().getByRole('button', { name: 'Capture position', exact: true }).click();
  await importer().getByText('Uncertain read', { exact: false }).waitFor();
  await allStopped();
  const file = await page.evaluate(() => window.__webcamFiles[0]);
  assert.equal(file.isFile, true);
  assert.match(file.name, /^chessboard-webcam-\d+\.png$/);
  assert.equal(file.type, 'image/png');
  assert.deepEqual([file.width, file.height], [480, 480], 'Capture must match the centered square preview');
  assert.equal(await importer().locator('#import-fen').inputValue(), fen);
  assert.equal(await importer().getByRole('button', { name: 'Analyze position', exact: true }).isDisabled(), true, 'Existing uncertain-read review stays mandatory');
  assert.equal(await page.getByTestId('analysis-results').count(), 0, 'A capture must not start analysis before review and Analyze position');
  await importer().getByLabel('I checked the board and corrected any mistakes.').check();
  assert.equal(await importer().getByRole('button', { name: 'Analyze position', exact: true }).isEnabled(), true);

  // Analysis keeps its paste-to-open shortcut when its import review is collapsed.
  const scansBeforePaste = await page.evaluate(() => window.__webcamFiles.length);
  await importer().locator(':scope > summary').click();
  await page.evaluate(async () => {
    const blob = await fetch(document.querySelector('.source-screenshot').src).then((response) => response.blob());
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'clipboard.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction((count) => window.__webcamFiles.length === count + 1, scansBeforePaste);
  assert.notEqual(await importer().getAttribute('open'), null, 'Pasting into active Analysis reopens its importer');

  // An importer collapse releases the camera, including a late permission result.
  await page.evaluate(() => { window.__delayCamera = true; });
  await importer().getByRole('button', { name: 'Use webcam', exact: true }).click();
  await page.waitForFunction(() => typeof window.__resolveCamera === 'function');
  await importer().locator(':scope > summary').click();
  await page.evaluate(() => { window.__delayCamera = false; window.__resolveCamera(); });
  await allStopped();
  await importer().locator(':scope > summary').click();
  assert.equal(await importer().locator('.webcam-capture').count(), 0);

  // Cancelling during PNG conversion cannot launch a stale import.
  const scansBefore = await page.evaluate(() => window.__webcamFiles.length);
  await page.evaluate(() => { window.__delayFrame = true; });
  await openCamera();
  await importer().getByRole('button', { name: 'Capture position', exact: true }).click();
  await page.waitForFunction(() => typeof window.__resolveFrame === 'function');
  await allStopped();
  await importer().getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => { window.__delayFrame = false; window.__resolveFrame(); });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__webcamFiles.length), scansBefore);

  // Hiding the workspace stops video and cancels an in-flight recognition commit.
  await page.evaluate(() => { window.__delayRecognition = true; });
  await openCamera();
  await importer().getByRole('button', { name: 'Capture position', exact: true }).click();
  await page.waitForFunction(() => typeof window.__resolveRecognition === 'function');
  await page.getByRole('button', { name: 'Play AI', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  assert.equal(await importer().getByRole('button', { name: 'Use webcam', exact: true }).isEnabled(), true, 'Cancelled recognition must release its in-flight guard');
  const newerDraft = '4k3/8/8/8/8/8/8/4K2R w - - 0 1';
  await importer().locator('#import-fen').fill(newerDraft);
  await page.evaluate(() => { window.__delayRecognition = false; window.__resolveRecognition(); });
  await page.waitForTimeout(150);
  assert.equal(await importer().locator('#import-fen').inputValue(), newerDraft, 'A recognition result from the hidden workspace must not overwrite a newer draft');
  await openCamera();
  await page.getByRole('button', { name: 'Play AI', exact: true }).click();
  await allStopped();
  assert.equal(await page.locator('.webcam-capture').count(), 0, 'A hidden workspace must not keep a camera mounted');

  // Both workspaces use the same camera and reviewed import controls.
  await importer().locator(':scope > summary').click();
  await openCamera();
  await importer().getByRole('button', { name: 'Capture position', exact: true }).click();
  await importer().getByText('Uncertain read', { exact: false }).waitFor();
  assert.equal(await importer().getByRole('button', { name: 'Load position', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.board-wrap [data-piece]').count(), 32, 'Capture must leave the loaded game untouched');

  // Permission, missing device, busy camera, pagehide, and narrow layout paths.
  for (const [name, message] of [['NotAllowedError', 'Camera access was denied.'], ['NotFoundError', 'No camera was found.'], ['NotReadableError', 'The camera is unavailable or being used by another app.']]) {
    await page.evaluate((value) => { window.__cameraFailure = value; }, name);
    await importer().getByRole('button', { name: 'Use webcam', exact: true }).click();
    await importer().getByText(message, { exact: false }).waitFor();
    await importer().getByRole('button', { name: 'Cancel', exact: true }).click();
    await allStopped();
  }
  await page.evaluate(() => { delete window.__cameraFailure; });
  await page.setViewportSize({ width: 390, height: 844 });
  await openCamera();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Camera controls must fit a mobile viewport');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await allStopped();
  await page.waitForFunction(() => !document.querySelector('.webcam-capture'));
  assert.deepEqual(errors, []);
  console.log('Webcam browser checks passed: opt-in camera, no audio, centered PNG File import, review gate, device selection, cancel/collapse/hide/pagehide cleanup, stale camera/frame/recognition cancellation, errors, both workspaces, and mobile layout.');
} finally {
  await browser.close();
}
