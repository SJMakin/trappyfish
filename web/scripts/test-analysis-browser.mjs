import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { Chess } from 'chess.js';
import { mkdir, writeFile } from 'node:fs/promises';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const runReal = !process.argv.includes('--mock-only');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
await mkdir('artifacts/analysis', { recursive: true });
const legal = new Chess();
for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'Nc3', 'Bg4', 'h3', 'Bh5']) legal.move(move);
const screenshotFen = `${legal.fen().split(' ')[0]} w KQkq - 0 1`;
const play = (board, uci) => board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const uci = (move) => `${move.from}${move.to}${move.promotion ?? ''}`;
const score = (cp) => cp >= 90000 ? 1 : cp <= -90000 ? 0 : 1 / (1 + Math.exp(-cp / 200));
const candidate = (fen, move, cp, replies = [], pv = [move]) => ({
  move, san: play(new Chess(fen), move).san, rootScoreCp: cp, adjustedScoreCp: cp + 80, riskCp: 0,
  bonusCp: 80, expectedScoreCp: cp + 80, expectedScore: score(cp + 80), objectiveScore: score(cp),
  policyCoverage: replies.reduce((sum, row) => sum + row.probability, 0), replies, pv,
  analyzed: true, status: 'evaluated', bestDefenseMove: replies.find((row) => row.bestDefense)?.move,
  mistakeProbability: replies.filter((row) => row.lossCp >= 100).reduce((sum, row) => sum + row.probability, 0),
});
const baitReplies = [
  { move: 'h5d1', san: 'Bxd1', probability: 0.6, scoreCp: 99700, expectedScore: 1, lossCp: 99680, punishment: ['c4f7', 'e8e7', 'c3d5'] },
  { move: 'c6e5', san: 'Nxe5', probability: 0.4, scoreCp: 20, expectedScore: score(20), lossCp: 0, punishment: ['c4b5'], bestDefense: true },
];
function makeDecision(fen) {
  const board = new Chess(fen);
  let selected;
  if (fen.split(' ')[0] === legal.fen().split(' ')[0] && board.turn() === 'w') {
    selected = candidate(fen, 'f3e5', 20, baitReplies, ['f3e5', 'c6e5', 'c4b5']);
    selected.trap = { reply: 'h5d1', replySan: 'Bxd1', probability: 0.6, profitCp: 99680, scoreCp: 99700, punishment: ['c4f7', 'e8e7', 'c3d5'] };
  } else {
    const legalMoves = board.moves({ verbose: true });
    const move = legalMoves.find((move) => move.san.endsWith('#')) ?? legalMoves.find((move) => move.san === 'e4') ?? legalMoves.find((move) => move.san === 'e5') ?? legalMoves[0];
    if (!move) return;
    const own = uci(move); board.move(move);
    const reply = board.moves({ verbose: true })[0];
    const replies = reply ? [{ move: uci(reply), san: reply.san, probability: 1, scoreCp: 50, expectedScore: score(50), lossCp: 0, punishment: [], bestDefense: true }] : [];
    selected = candidate(fen, own, move.san.endsWith('#') ? 100000 : 50, replies, reply ? [own, uci(reply)] : [own]);
    if (move.san.endsWith('#')) selected.rootMate = 1;
  }
  return { move: selected.move, san: selected.san, mode: selected.trap ? 'trappy' : 'standard', rootBestMove: selected.move,
    rootBestSan: selected.san, rootBestScoreCp: selected.rootScoreCp, candidates: [selected], selected, policySource: 'maia', riskLimitCp: 100 };
}
const black = new Chess(); for (const move of ['f3', 'e5', 'g4']) black.move(move);
const promotionFen = '7k/P7/8/8/8/8/8/7K w - - 0 37';
const knownFens = [new Chess().fen(), legal.fen(), screenshotFen, black.fen(), promotionFen];
for (const root of [...knownFens]) {
  const decision = makeDecision(root);
  for (const line of decision ? [[decision.move], ...decision.selected.replies.map((reply) => [decision.move, reply.move, ...reply.punishment])] : []) {
    const board = new Chess(root);
    for (const move of line) { play(board, move); knownFens.push(board.fen()); }
  }
}
const catalogue = Object.fromEntries(knownFens.filter((fen) => !new Chess(fen).isGameOver()).map((fen) => [fen, makeDecision(fen)]));
async function mockEngine(page) {
  let intercepted = false;
  await page.route('**/src/engine/trappy.ts*', (route) => {
    if (route.request().url().includes('analysis-original')) return route.continue();
    intercepted = true;
    return route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/engine/trappy.ts?analysis-original';
      import { Chess } from '/node_modules/chess.js/dist/esm/chess.js';
      const catalogue = ${JSON.stringify(catalogue)};
      export class TrappyEngine {
        generation = 0;
        cancel() { this.generation++; }
        terminate() { this.cancel(); }
        async analyzePosition(fen, settings, onProgress) {
          const generation = this.generation;
          window.__analysisCalls ??= [];
          window.__analysisCalls.push({ fen, settings: { ...settings } });
          onProgress?.({ stage: 'root', completed: 0, total: 1, message: 'Finding strong candidate moves with Stockfish…' });
          if (window.__holdAnalysis) await new Promise(resolve => { window.__releaseAnalysis = resolve; });
          else await new Promise(resolve => setTimeout(resolve, window.__analysisDelay ?? 150));
          if (generation !== this.generation) throw new Error('Engine search cancelled.');
          const board = new Chess(fen);
          if (board.isGameOver()) return { fen, terminal: board.isCheckmate() ? 'checkmate' : 'draw' };
          const decision = structuredClone(catalogue[fen]);
          if (!decision) throw new Error('No deterministic analysis fixture for ' + fen);
          if (window.__policyUnavailable) {
            decision.policySource = 'stockfish';
            decision.warning = 'Human-reply analysis unavailable; showing Stockfish results. Model failed to load.';
            for (const candidate of decision.candidates) {
              candidate.policyCoverage = 0; candidate.replies = []; candidate.analyzed = false;
              candidate.status = 'objective-only'; delete candidate.trap; delete candidate.mistakeProbability;
            }
            decision.selected = decision.candidates.find(candidate => candidate.move === decision.move);
          }
          onProgress?.({ stage: 'complete', completed: 1, total: 1, message: 'Analysis complete. Explore the traps and strongest defenses.' });
          return { fen, decision };
        }
      }
    ` });
  });
  return () => assert.equal(intercepted, true, 'Deterministic flow coverage requires the Vite dev server');
}
const analysisBoard = (page) => page.getByTestId('analysis-board');
const results = (page) => page.getByTestId('analysis-results');
async function boardFen(page) { return analysisBoard(page).getAttribute('data-fen'); }
async function waitForResult(page, fen, timeout = 15000) {
  await page.waitForFunction((fen) => document.querySelector('[data-testid="analysis-results"]')?.getAttribute('data-analysis-fen') === fen, fen, { timeout });
}
async function waitForComplete(page) { await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' }); }
async function openReplies(page) {
  await page.locator('.analysis-move-tree').waitFor();
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
}
async function capture(page, path) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path, fullPage: true }); }
async function assertBoardPieces(page, fen) {
  const board = new Chess(fen);
  for (const row of board.board()) for (const piece of row) if (piece) {
    await analysisBoard(page).locator(`[data-square="${piece.square}"] [data-piece="${piece.color}${piece.type.toUpperCase()}"]`).waitFor();
  }
  assert.equal(await analysisBoard(page).locator('[data-piece]').count(), board.board().flat().filter(Boolean).length);
}

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  const assertMocked = await mockEngine(page);
  await page.goto(appUrl);
  await analysisBoard(page).waitFor();
  assertMocked();
  assert.equal(await page.getByRole('button', { name: 'Analyze', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.position-import').getAttribute('open'), '');
  await page.getByRole('button', { name: 'Upload screenshot', exact: true }).waitFor();
  assert.equal(await page.getByText('No moves yet.', { exact: true }).count(), 0, 'Analysis entry must show a useful next step');
  await capture(page, 'artifacts/analysis/landing-desktop.png');

  await page.locator('#import-fen').fill(legal.fen());
  await page.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await waitForResult(page, legal.fen());
  await waitForComplete(page);
  assert.equal(await boardFen(page), legal.fen(), 'Analyzing imported positions cannot autoplay the recommendation');
  assert.equal(await page.getByLabel('You play', { exact: true }).count(), 0, 'Analyzing a position does not require a playing color');
  const bait = page.getByTestId('analysis-candidate').filter({ hasText: 'Nxe5' });
  assert.equal(await bait.getAttribute('data-move'), 'f3e5');
  await bait.click();
  assert.match(await results(page).innerText(), /White.?s perspective/);
  assert.match(await results(page).innerText(), /Bxd1/);
  assert.match(await results(page).innerText(), /Maia chance|Maia weighted/);
  await openReplies(page);
  assert.match(await results(page).innerText(), /checkmate/i);
  assert.equal(await page.getByTestId('engine-hud').isVisible(), true, 'Technical diagnostics are visible alongside the tree');
  assert.equal(await page.getByRole('table').count() >= 1, true, 'Candidate metrics are inspectable');
  await page.getByTestId('analysis-reply').filter({ hasText: 'Bxd1' }).click();
  await page.getByRole('button', { name: 'End of line', exact: true }).click();
  const mate = new Chess(legal.fen()); for (const move of ['f3e5', 'h5d1', 'c4f7', 'e8e7', 'c3d5']) play(mate, move);
  assert.equal(await boardFen(page), mate.fen());
  await assertBoardPieces(page, mate.fen());
  assert.equal(mate.isCheckmate(), true);
  await capture(page, 'artifacts/analysis/legal-punishment-desktop.png');
  await page.getByRole('button', { name: 'Start of line', exact: true }).click();
  assert.equal(await boardFen(page), legal.fen());
  await page.getByRole('button', { name: 'Next move', exact: true }).click();
  const baitBoard = new Chess(legal.fen()); play(baitBoard, 'f3e5');
  assert.equal(await boardFen(page), baitBoard.fen());
  await page.getByRole('button', { name: 'Previous move', exact: true }).click();
  assert.equal(await boardFen(page), legal.fen());
  const defense = page.getByTestId('analysis-reply').filter({ hasText: 'Best defense' }).first();
  await defense.click();
  await page.getByRole('button', { name: 'End of line', exact: true }).click();
  assert.equal(new Chess(await boardFen(page)).isCheckmate(), false);
  await page.getByRole('button', { name: 'Return to analyzed position', exact: true }).click();
  assert.equal(await boardFen(page), legal.fen());

  // A branch can become its own analysis root without changing the imported position.
  await page.getByTestId('analysis-reply').filter({ hasText: 'Bxd1' }).click();
  const clickedNode = new Chess(legal.fen()); for (const move of ['f3e5', 'h5d1']) play(clickedNode, move);
  assert.equal(await boardFen(page), clickedNode.fen(), 'Clicking a tree node jumps to its exact position');
  await page.getByRole('button', { name: 'Start of line', exact: true }).click();
  await page.getByRole('button', { name: 'Next move', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze this branch', exact: true }).first().click();
  await waitForResult(page, baitBoard.fen());
  await waitForComplete(page);
  assert.match(await results(page).innerText(), /Black.?s perspective/);
  await page.locator('.research-more-tools > summary').click();
  await page.getByRole('button', { name: 'Restore imported position', exact: true }).click();
  assert.equal(await boardFen(page), legal.fen());

  // Deepening and cancellation leave the available preview and analyzed board intact.
  await page.evaluate(() => { window.__holdAnalysis = true; });
  await page.getByLabel('Analysis opponent rating', { exact: true }).selectOption('1200');
  await page.getByRole('button', { name: 'Deep', exact: true }).click();
  await page.waitForFunction(() => typeof window.__releaseAnalysis === 'function');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.evaluate(() => { window.__holdAnalysis = false; window.__releaseAnalysis(); delete window.__releaseAnalysis; });
  await page.waitForTimeout(100);
  assert.equal(await boardFen(page), legal.fen());
  assert.equal(await page.locator('.error-strip').count(), 0);
  await page.evaluate(() => { window.__analysisDelay = 100; });
  await page.getByLabel('Analysis opponent rating', { exact: true }).selectOption('1000');
  await page.getByRole('button', { name: 'Quick', exact: true }).click();
  await waitForResult(page, legal.fen());

  // Rating edits must not keep displaying probabilities from another target profile.
  await page.getByLabel('Analysis opponent rating', { exact: true }).selectOption('1400');
  await page.getByRole('button', { name: /^Deep/ }).click();
  await page.waitForFunction(() => window.__analysisCalls.at(-1)?.settings.opponentRating === 1400);
  await waitForResult(page, legal.fen());
  await waitForComplete(page);
  assert.equal((await page.evaluate(() => window.__analysisCalls.at(-1))).settings.opponentRating, 1400);

  // Playing preferences are independent and travel with the actual search settings.
  assert.equal(await page.getByLabel('Analysis king attack', { exact: true }).isVisible(), true);
  for (const [label, value] of [['Analysis trappiness', 0.9], ['Analysis king attack', 0.8], ['Analysis tension', 0.7],
    ['Analysis risk tolerance', 125], ['Analysis risk when winning', 60]]) {
    await page.getByLabel(label, { exact: true }).evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  assert.equal(await page.getByLabel('Analysis root depth', { exact: true }).inputValue(), '14', 'Style changes must not change search depth');
  await page.getByRole('button', { name: /^Deep/ }).click();
  await waitForComplete(page);
  const styleSettings = (await page.evaluate(() => window.__analysisCalls.at(-1))).settings;
  assert.equal(styleSettings.trappiness, 0.9); assert.equal(styleSettings.aggression, 0.8); assert.equal(styleSettings.tension, 0.7);
  assert.equal(styleSettings.maxRiskCp, 125); assert.equal(styleSettings.winningRiskCp, 60);
  assert.equal(styleSettings.opponentRating, 1400);

  // Board exploration permits either side; the player color has no effect on research.
  await analysisBoard(page).locator('[data-square="f3"]').click();
  await analysisBoard(page).locator('[data-square="e5"]').click();
  assert.equal(await boardFen(page), baitBoard.fen());
  await analysisBoard(page).locator('[data-square="h5"]').click();
  await analysisBoard(page).locator('[data-square="d1"]').click();
  const queenTaken = new Chess(baitBoard.fen()); play(queenTaken, 'h5d1');
  assert.equal(await boardFen(page), queenTaken.fen());
  await assertBoardPieces(page, queenTaken.fen());

  // A delayed old search cannot replace results for a newly imported Black position.
  await page.evaluate(() => { window.__analysisDelay = 700; });
  await page.getByRole('button', { name: 'Analyze this branch', exact: true }).first().click();
  await page.locator('.position-import > summary').click();
  await page.locator('#import-fen').fill(black.fen());
  await page.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await waitForResult(page, black.fen());
  await waitForComplete(page);
  await page.waitForTimeout(800);
  assert.equal(await results(page).getAttribute('data-analysis-fen'), black.fen());
  assert.equal(await boardFen(page), black.fen());
  assert.match(await results(page).innerText(), /Black.?s perspective/);
  assert.match(await results(page).innerText(), /Qh4#/);
  await page.evaluate(() => { window.__analysisDelay = 100; });

  // Clipboard output preserves a useful FEN and an importable PGN with the studied line.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy FEN', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), black.fen());
  await page.locator('.research-more-tools > summary').click();
  await page.getByRole('button', { name: 'Copy PGN', exact: true }).click();
  const pgn = await page.evaluate(() => navigator.clipboard.readText());
  const pgnBoard = new Chess(); pgnBoard.loadPgn(pgn);
  assert.ok(pgn.includes('[FEN '));
  assert.equal(pgnBoard.isCheckmate(), true);
  assert.match(pgn, /Qh4#/);
  console.log('PASS deterministic analysis workflow: automatic import analysis, side independence, mate/defense replay, branch research, reset, cancellation, rating, free exploration, race protection and readable clipboard exports.');

  const streaming = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  streaming.on('pageerror', (error) => errors.push(error.message));
  await mockEngine(streaming);
  await streaming.addInitScript(() => { window.__analysisDelay = 1000; });
  await streaming.goto(`${appUrl}/?fen=${encodeURIComponent(legal.fen())}`);
  await waitForResult(streaming, legal.fen());
  assert.ok(await streaming.getByRole('button', { name: 'Stop', exact: true }).isVisible(), 'First-pass results should be usable while deep verification continues');
  await openReplies(streaming);
  await streaming.getByTestId('analysis-reply').filter({ hasText: 'Bxd1' }).click();
  await streaming.getByRole('button', { name: 'End of line', exact: true }).click();
  assert.equal(await boardFen(streaming), mate.fen());
  await waitForComplete(streaming);
  assert.equal(await boardFen(streaming), mate.fen(), 'Deeper results must preserve the user’s current branch and board');
  assert.equal(await streaming.getByTestId('analysis-candidate').filter({ hasText: 'Nxe5' }).getAttribute('aria-pressed'), 'true');
  await streaming.close();
  console.log('PASS quick-preview exploration survives deep completion with the same selected candidate, branch and board.');

  const fallback = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  fallback.on('pageerror', (error) => errors.push(error.message));
  await mockEngine(fallback);
  await fallback.addInitScript(() => { window.__policyUnavailable = true; });
  await fallback.goto(`${appUrl}/?fen=${encodeURIComponent(legal.fen())}`);
  await waitForResult(fallback, legal.fen());
  await waitForComplete(fallback);
  assert.ok(await fallback.getByTestId('analysis-candidate').count(), 'Objective results should be discoverable even when Maia cannot load');
  assert.match(await results(fallback).innerText(), /Best Stockfish move/);
  assert.match(await results(fallback).innerText(), /Human-reply analysis unavailable/);
  assert.doesNotMatch(await fallback.locator('.recommendation.practical').innerText(), /%/);
  assert.equal(await fallback.getByTestId('analysis-reply').count(), 0, 'Fallback must never invent reply probabilities');
  await fallback.getByTestId('analysis-candidate').first().click();
  await fallback.getByRole('button', { name: 'End of line', exact: true }).click();
  const objective = new Chess(legal.fen()); for (const move of catalogue[legal.fen()].selected.pv) play(objective, move);
  assert.equal(await boardFen(fallback), objective.fen());
  await fallback.close();
  console.log('PASS transparent Stockfish fallback exposes replayable candidates without fabricated Maia probabilities.');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', (error) => errors.push(error.message));
  const assertMobileMocked = await mockEngine(mobile);
  await mobile.goto(appUrl);
  assertMobileMocked();
  await mobile.getByRole('button', { name: 'Upload screenshot', exact: true }).waitFor();
  const bounds = await mobile.getByRole('button', { name: 'Upload screenshot', exact: true }).boundingBox();
  assert.ok(bounds.y < 844, 'Main screenshot action must be reachable on the first mobile screen');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await mobile.locator('#import-fen').fill(legal.fen());
  await mobile.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await waitForResult(mobile, legal.fen());
  await waitForComplete(mobile);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await openReplies(mobile);
  await mobile.getByTestId('analysis-reply').filter({ hasText: 'Bxd1' }).click();
  await mobile.getByRole('button', { name: 'End of line', exact: true }).click();
  assert.equal(await boardFen(mobile), mate.fen());
  await capture(mobile, 'artifacts/analysis/legal-punishment-mobile.png');
  await mobile.locator('.position-import > summary').click();
  await mobile.locator('#import-fen').fill(promotionFen);
  await mobile.getByRole('button', { name: 'Analyze position', exact: true }).click();
  await waitForResult(mobile, promotionFen);
  await waitForComplete(mobile);
  await analysisBoard(mobile).locator('[data-square="a7"]').click();
  await analysisBoard(mobile).locator('[data-square="a8"]').click();
  await mobile.getByRole('dialog').waitFor();
  assert.equal(await mobile.getByRole('dialog').getByRole('button').count(), 5);
  await mobile.getByRole('dialog').getByRole('button', { name: /queen/i }).click();
  const promoted = new Chess(promotionFen); play(promoted, 'a7a8q');
  assert.equal(await boardFen(mobile), promoted.fen());
  await mobile.close();
  console.log('PASS mobile analysis entry, layout, touch-friendly line replay, promotion choices and no horizontal overflow.');

  if (runReal) {
    const real = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
    real.on('pageerror', (error) => errors.push(error.message));
    const source = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    await source.goto(`${appUrl}/?mode=play&player=w&fen=${encodeURIComponent(legal.fen())}`);
    await source.locator('.board-wrap [data-square="f3"] [data-piece="wN"]').waitFor();
    const image = await source.locator('.board-wrap').screenshot();
    await writeFile('artifacts/analysis/uploaded-legal-board.png', image);
    await source.close();
    await real.goto(appUrl);
    await real.getByLabel('Upload chessboard screenshot').setInputFiles({ name: 'legal.png', mimeType: 'image/png', buffer: image });
    await real.getByText('Board detected.', { exact: false }).waitFor({ timeout: 90000 });
    assert.equal((await real.locator('#import-fen').inputValue()).split(' ')[0], legal.fen().split(' ')[0], 'Real Fenshot must reconstruct the tactical board from a screenshot');
    await real.getByLabel('Side to move', { exact: true }).selectOption('b');
    await real.getByLabel('Side to move', { exact: true }).selectOption('w');
    for (const right of ['White O-O', 'White O-O-O', 'Black O-O', 'Black O-O-O']) await real.getByText(right, { exact: true }).click();
    assert.equal(await real.locator('#import-fen').inputValue(), screenshotFen);
    await capture(real, 'artifacts/analysis/screenshot-review-desktop.png');
    const began = Date.now();
    await real.getByRole('button', { name: 'Analyze position', exact: true }).click();
    await waitForResult(real, screenshotFen, 240000);
    const previewMs = Date.now() - began;
    assert.equal(await boardFen(real), screenshotFen);
    await real.getByTestId('analysis-candidate').filter({ hasText: 'Nxe5' }).click();
    await openReplies(real);
    await real.getByTestId('analysis-reply').filter({ hasText: 'Bxd1' }).waitFor();
    await real.locator('.analysis-score-details > summary').click();
    assert.match(await results(real).innerText(), /Human reply coverage: [1-9]/);
    assert.equal(await real.locator('.error-strip').count(), 0);
    assert.doesNotMatch(await results(real).innerText(), /unavailable; showing Stockfish/);
    const cancel = real.getByRole('button', { name: 'Stop', exact: true });
    if (await cancel.count() && await cancel.isVisible()) await cancel.click();
    await real.getByTestId('analysis-reply').filter({ hasText: 'Bxd1' }).click();
    await real.getByRole('button', { name: 'End of line', exact: true }).click();
    const realMate = new Chess(screenshotFen); for (const move of ['f3e5', 'h5d1', 'c4f7', 'e8e7', 'c3d5']) play(realMate, move);
    assert.equal(await boardFen(real), realMate.fen(), 'Real Maia/Stockfish output must replay the full mating punishment');
    await assertBoardPieces(real, realMate.fen());
    await capture(real, 'artifacts/analysis/real-maia-punishment-desktop.png');
    console.log(`PASS real Fenshot → reviewed rights/turn → Maia + Stockfish Legal analysis (${previewMs} ms to usable preview) → forced mate replay; root never autoplays.`);
    await writeFile('artifacts/analysis/browser-review.json', JSON.stringify({ previewMs, rootFen: screenshotFen, mateFen: realMate.fen(), errors }, null, 2));
    await real.close();
  }
  assert.deepEqual(errors, [], 'Analysis should have no uncaught browser errors');
} finally { await browser.close(); }
