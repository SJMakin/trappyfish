import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const appUrl = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.TRAPPY_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
const storageKey = 'trappy.position-history.v1';
const terminal = '4k3/8/8/8/8/8/8/4K3 w - - 0 27';
const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const preferences = [
  ['trappiness', 'trappiness', 0.15], ['aggression', 'king attack', 0.25], ['tension', 'tension', 0.35],
  ['pawnStorm', 'pawn storms', 0.45], ['kingCaution', 'king caution', 0.55], ['sacrifice', 'sacrifice appetite', 0.65],
  ['sharpness', 'sharpness', 0.75], ['queenRetention', 'queen retention', 0.85], ['drawAversion', 'draw aversion', 0.95],
  ['variety', 'variety', 0.5], ['maxRiskCp', 'risk tolerance', 175], ['winningRiskCp', 'risk when winning', 35],
];
const errors = [];
const setRange = async (page, label, value) => page.getByRole('slider', { name: label, exact: true }).evaluate((input, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const values = async (page) => Object.fromEntries(await page.locator('.workspace-panel:not([hidden]) .playing-style-controls input[type="range"]').evaluateAll(inputs => inputs.map(input => [input.getAttribute('aria-label'), input.value])));
const openHistory = async (page) => {
  const history = page.locator('.position-history');
  if (!await history.evaluate(element => element.open)) await history.locator(':scope > summary').click();
};

// Fixed display fixtures exercise HUD accounting and the separation between own-move
// sampling and human reply probabilities. Engine mathematics has separate unit tests.
async function mockEngine(page) {
  await page.route('**/src/engine/trappy.ts*', route => {
    if (route.request().url().includes('wild-original')) return route.continue();
    return route.fulfill({ contentType: 'application/javascript', body: `
      export * from '/src/engine/trappy.ts?wild-original';
      import { Chess } from '/node_modules/chess.js/dist/esm/chess.js';
      const utility = cp => 1 / (1 + Math.exp(-cp / 200));
      const toUci = move => move.from + move.to + (move.promotion ?? '');
      function decision(fen, settings, analysis) {
        const board = new Chess(fen);
        const legal = board.moves({ verbose: true });
        const ordered = [legal.find(move => move.san === 'e4'), legal.find(move => move.san === 'd4'), ...legal].filter(Boolean);
        const roots = [...new Map(ordered.map(move => [toUci(move), move])).values()].slice(0, 2);
        const candidates = roots.map((move, index) => {
          const next = new Chess(fen); next.move(move);
          const replies = next.moves({ verbose: true }).slice(0, 2).map((reply, i) => ({
            move: toUci(reply), san: reply.san, probability: i ? 0.4 : 0.6, scoreCp: i ? 80 : 20,
            expectedScore: utility(i ? 80 : 20), lossCp: i ? 60 : 0, punishment: [], bestDefense: !i,
          }));
          const unavailable = Boolean(window.__wildUnavailable);
          const style = { attackPressure: 0.5, pawnStorm: 0.4, kingExposure: 0.3, materialInvestment: 1.5,
            tension: 0.6, queenRetention: 1, positionalAvailable: true,
            aggressionBonusCp: 60 * (settings.aggression ?? 0) * 0.5,
            pawnStormBonusCp: 50 * (settings.pawnStorm ?? 0) * 0.4,
            kingCautionPenaltyCp: 60 * (settings.kingCaution ?? 0) * 0.3,
            sacrificeBonusCp: 60 * (settings.sacrifice ?? 0) * 0.5,
            tensionBonusCp: 40 * (settings.tension ?? 0) * 0.6,
            queenRetentionBonusCp: 30 * (settings.queenRetention ?? 0),
            sharpness: unavailable ? undefined : 0.4, sharpnessAvailable: !unavailable,
            sharpnessBonusCp: unavailable ? 0 : 60 * (settings.sharpness ?? 0) * 0.4,
            drawProbability: unavailable ? undefined : 0.3, drawAversionAvailable: !unavailable,
            drawAversionPenaltyCp: unavailable ? 0 : 60 * (settings.drawAversion ?? 0) * 0.3 };
          const total = style.aggressionBonusCp + style.pawnStormBonusCp - style.kingCautionPenaltyCp + style.sacrificeBonusCp
            + style.tensionBonusCp + style.queenRetentionBonusCp + style.sharpnessBonusCp - style.drawAversionPenaltyCp;
          const cp = 20 - index * 10;
          return { move: toUci(move), san: move.san, rootScoreCp: cp, initialScoreCp: cp, adjustedScoreCp: cp + total,
            objectiveScore: utility(cp), expectedScore: utility(cp), expectedScoreCp: cp, bonusCp: total, riskCp: index * 10,
            policyCoverage: unavailable ? 0 : 1, replies: unavailable ? [] : replies,
            pv: [toUci(move), ...replies.slice(0, 1).map(reply => reply.move)],
            analyzed: !unavailable, status: unavailable ? 'objective-only' : 'evaluated', style,
            objectiveWdl: unavailable ? undefined : {win: 0.45, draw: 0.3, loss: 0.25}, selectionProbability: index ? 0.28 : 0.72 };
        });
        const selected = candidates[analysis ? 0 : 1];
        return { move: selected.move, san: selected.san, mode: 'trappy', policySource: window.__wildUnavailable ? 'stockfish' : 'maia',
          selected, candidates, rootBestMove: candidates[0].move, rootBestSan: candidates[0].san, rootBestScoreCp: 20,
          riskLimitCp: settings.maxRiskCp, styleApplied: true,
          selection: { method: analysis ? 'analysis' : 'sampled', temperatureCp: 30,
            ...(analysis ? {} : { randomDraw: 0.9 }), probabilities: candidates.map(candidate => ({ move: candidate.move, probability: candidate.selectionProbability })) } };
      }
      export class TrappyEngine {
        cancel() {} terminate() {}
        async analyzePosition(fen, settings) {
          window.__wildCalls ??= []; window.__wildCalls.push({ fen, settings: {...settings} });
          const board = new Chess(fen);
          if (board.isGameOver()) return { fen, terminal: 'draw' };
          return { fen, decision: decision(fen, settings, true) };
        }
        async chooseMove(fen, settings) { return decision(fen, settings, false); }
      }
    ` });
  });
}

try {
  await mkdir('artifacts/wild-controls', { recursive: true });
  for (const context of ['Analysis', 'Play']) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await mockEngine(page);
    await page.goto(`${appUrl}/?mode=${context === 'Play' ? 'play' : 'analysis'}&fen=${encodeURIComponent(terminal)}`);
    await page.getByRole('slider', { name: `${context} king attack`, exact: true }).waitFor();
    assert.equal(Object.keys(await values(page)).length, 12, `${context} exposes twelve controls`);
    for (const [, label, value] of preferences) {
      const before = await values(page);
      await setRange(page, `${context} ${label}`, value);
      const after = await values(page);
      assert.equal(after[`${context} ${label}`], String(value));
      for (const name of Object.keys(before).filter(name => name !== `${context} ${label}`)) assert.equal(after[name], before[name], `${label} must not change ${name}`);
    }
    const attack = page.getByRole('slider', { name: `${context} king attack`, exact: true });
    await attack.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await attack.inputValue(), '0.3', 'Style sliders support keyboard adjustment');
    await setRange(page, `${context} king attack`, 0.25);
    await page.getByRole('button', { name: context === 'Play' ? 'Save practice game' : 'Save analysis position', exact: true }).click();
    const entries = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).entries, storageKey);
    const saved = entries.find(entry => entry.kind === (context === 'Play' ? 'game' : 'analysis'));
    assert.ok(saved, 'Saved snapshot exists');
    for (const [key, , value] of preferences) assert.equal(saved.settings[key], value, `History stores ${key}`);
    if (context === 'Analysis') {
      await page.reload();
      await page.getByRole('slider', { name: 'Analysis trappiness', exact: true }).waitFor();
      for (const [, label, value] of preferences) assert.equal(await page.getByRole('slider', { name: `Analysis ${label}`, exact: true }).inputValue(), String(value), `Reloading the same FEN URL preserves saved ${label}`);
    }
    // Return through the home URL rather than starting a new imported-FEN analysis.
    await page.evaluate(() => { const url = new URL(location.href); url.searchParams.delete('fen'); history.replaceState(null, '', url); });
    await page.reload(); await openHistory(page);
    await page.locator(`[data-history-id="${saved.id}"]`).getByRole('button', { name: /^Resume / }).click();
    for (const [, label, value] of preferences) assert.equal(await page.getByRole('slider', { name: `${context} ${label}`, exact: true }).inputValue(), String(value), `Resume restores ${label}`);
    await page.setViewportSize({ width: 320, height: 768 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${context} controls fit 320px`);
    assert.equal(Object.keys(await values(page)).length, 12, 'All controls remain exposed on narrow screens');
    await page.screenshot({ path: `artifacts/wild-controls/${context.toLowerCase()}-mobile.png`, fullPage: true });
    await page.close();
  }

  const hud = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  hud.on('pageerror', error => errors.push(error.message));
  await mockEngine(hud);
  await hud.goto(`${appUrl}/?fen=${encodeURIComponent(initial)}`);
  await hud.getByTestId('engine-hud').waitFor();
  for (const [, label, value] of preferences) await setRange(hud, `Analysis ${label}`, value);
  await hud.getByRole('button', { name: 'Quick', exact: true }).click();
  await hud.waitForFunction(() => window.__wildCalls?.at(-1)?.settings.drawAversion === 0.95);
  await hud.getByTestId('style-internals').locator(':scope > summary').click();
  const table = hud.getByTestId('style-contributions');
  assert.equal(await table.locator('tbody tr').count(), 8, 'Every ranking contribution is inspectable');
  assert.match(await table.innerText(), /King attack[\s\S]*\+7\.5/);
  assert.match(await table.innerText(), /King caution[\s\S]*-9\.9/);
  assert.match(await table.innerText(), /Draw aversion[\s\S]*-17\.1/);
  assert.match(await table.innerText(), /1\.5000 pawns/);
  const selection = hud.getByTestId('move-selection');
  await selection.locator(':scope > summary').click();
  assert.match(await selection.innerText(), /Deterministic analysis recommendation/);
  assert.match(await selection.innerText(), /72\.0%/);
  assert.match(await selection.innerText(), /28\.0%/);
  assert.match(await selection.innerText(), /separate from Maia/);
  await hud.screenshot({ path: 'artifacts/wild-controls/hud-desktop.png', fullPage: true });
  await hud.setViewportSize({ width: 320, height: 768 });
  assert.equal(await hud.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Expanded style ledger and selection distribution fit 320px');
  await hud.evaluate(() => { window.__wildUnavailable = true; });
  await setRange(hud, 'Analysis sharpness', 0.8); // Invalidate the cached completed search.
  await hud.getByRole('button', { name: 'Quick', exact: true }).click();
  await hud.waitForFunction(() => document.querySelector('[data-testid="style-contributions"]')?.textContent.includes('Unavailable'));
  assert.match(await hud.getByTestId('style-internals').innerText(), /no usable human reply distribution/);
  assert.match(await hud.getByTestId('style-internals').innerText(), /WDL is unavailable/);

  const play = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  play.on('pageerror', error => errors.push(error.message));
  await mockEngine(play);
  await play.goto(`${appUrl}/?mode=play`);
  await setRange(play, 'Play variety', 0.5);
  await play.locator('.board-wrap [data-square="e2"]').click();
  await play.locator('.board-wrap [data-square="e4"]').click();
  await play.getByRole('button', { name: 'Analysis', exact: true }).click();
  const playedSelection = play.locator('.decision [data-testid="move-selection"]').first();
  await playedSelection.locator(':scope > summary').click();
  assert.match(await playedSelection.innerText(), /Sampled in Play/);
  assert.match(await playedSelection.innerText(), /0\.900000/);
  assert.match(await playedSelection.innerText(), /28\.0%/);
  assert.deepEqual(errors, []);
  console.log('Wild-control browser checks passed: twelve independent sliders in both modes, keyboard input, complete history roundtrip, 320px layout, all signed HUD contributions, unavailable policy/WDL states, deterministic analysis selection chances, and recorded Play sampling.');
} finally { await browser.close(); }
