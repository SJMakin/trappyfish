import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { chromium } from '@playwright/test';
import { encodeMaiaBoard, legalMaiaPolicy, maiaMoveIndex, MAIA_TOKEN_WIDTH } from '../src/engine/maiaEncoding';
import { NodeMaiaPolicy } from './maia-node';

const root = fileURLToPath(new URL('../', import.meta.url));
const startFen = new Chess().fen();
const blackFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const promotionFen = '1r5k/P1P5/8/8/8/8/8/4K3 w - - 0 1';

assert.equal(maiaMoveIndex('e2e4'), 796);
assert.equal(maiaMoveIndex('e7e5', true), 796);
assert.equal(maiaMoveIndex('a7b8q'), 4100);
assert.equal(maiaMoveIndex('c7b8q'), 4164);
assert.equal(maiaMoveIndex('h7h8n'), 4351);
assert.equal(maiaMoveIndex('a2b1q', true), 4100);

const tokenFixture = encodeMaiaBoard('7k/1P6/8/8/8/8/3K4/8 w - - 0 1');
assert.equal(tokenFixture.length, 6144);
// Independently known square/channel locations: b7 white pawn, d2 white king,
// h8 black king. Every history slot is padded with this same three-piece board.
assert.equal(tokenFixture.reduce((sum, value) => sum + value, 0), 24);
for (let history = 0; history < 8; history++) {
  assert.equal(tokenFixture[49 * MAIA_TOKEN_WIDTH + history * 12], 1);
  assert.equal(tokenFixture[11 * MAIA_TOKEN_WIDTH + history * 12 + 5], 1);
  assert.equal(tokenFixture[63 * MAIA_TOKEN_WIDTH + history * 12 + 11], 1);
}
assert.deepEqual(tokenFixture, encodeMaiaBoard('8/3k4/8/8/8/8/1p6/7K b - - 0 1'));

const promotionLogits = new Float32Array(4352).fill(-20);
promotionLogits[4100] = 3;
promotionLogits[4164] = 1;
const promotionPolicy = legalMaiaPolicy(promotionFen, promotionLogits);
assert.equal(promotionPolicy[0].move, 'a7b8q');
const firstQueen = promotionPolicy.find((reply) => reply.move === 'a7b8q')!;
const secondQueen = promotionPolicy.find((reply) => reply.move === 'c7b8q')!;
assert.ok(Math.abs(firstQueen.probability / secondQueen.probability - Math.exp(2)) < 1e-8);
assert.throws(() => legalMaiaPolicy(startFen, new Float32Array(4352).fill(NaN)), /non-finite/);

const checksum = createHash('sha256').update(await readFile(`${root}/public/maia/maia3-5m.onnx`)).digest('hex');
assert.equal(checksum, 'f7bd01b3e41dceb5e93eb9f4c61e9c4db8b35411effd1d8c984b006cd74bb804');

const maia = new NodeMaiaPolicy();
const references: { fen: string; rating: number; replies: Awaited<ReturnType<NodeMaiaPolicy['predict']>> }[] = [];
try {
  for (const [fen, rating] of [[startFen, 800], [startFen, 2200], [blackFen, 1500], [promotionFen, 1500]] as const) {
    const replies = await maia.predict(fen, rating, 1500);
    const legal = new Set(new Chess(fen).moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`));
    assert.equal(replies.length, legal.size);
    assert.ok(replies.every((reply) => legal.has(reply.move) && Number.isFinite(reply.probability) && reply.probability >= 0));
    assert.ok(Math.abs(replies.reduce((sum, reply) => sum + reply.probability, 0) - 1) < 1e-12);
    references.push({ fen, rating, replies });
  }
  assert.notDeepEqual(references[0].replies, references[1].replies);
  const cached = await maia.predict(startFen, 800, 1500);
  cached[0].probability = -1;
  assert.deepEqual(await maia.predict(startFen, 800, 1500), references[0].replies);
  const fool = new Chess();
  for (const move of ['f3', 'e5', 'g4', 'Qh4#']) fool.move(move);
  assert.deepEqual(await maia.predict(fool.fen(), 1500, 1500), []);
  await assert.rejects(maia.predict(startFen, NaN, 1500), /finite/);
} finally {
  await maia.terminate();
}
console.log('Maia encoding, promotion vocabulary, model checksum, legal masks, rating conditioning, cache integrity, and terminal positions passed.');

if (!process.argv.includes('--node-only')) {
  const port = 5184;
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'pipe' });
  let serverOutput = '';
  server.stdout?.on('data', (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on('data', (chunk) => { serverOutput += String(chunk); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(origin)).ok) break; } catch {}
      if (server.exitCode !== null) throw new Error(`Vite exited: ${serverOutput}`);
      if (attempt === 99) throw new Error(`Vite did not start: ${serverOutput}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || undefined });
    } catch (error) {
      // A system Edge installation can exercise the same Chromium WASM worker
      // when this workstation has no matching Playwright browser download.
      if (process.platform !== 'win32' || process.env.PLAYWRIGHT_BROWSER_PATH
        || !(error instanceof Error) || !error.message.includes("Executable doesn't exist")) throw error;
      browser = await chromium.launch({ headless: true, channel: 'msedge' });
    }
    const page = await browser.newPage();
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>Maia inference smoke test</body></html>' }));
    await page.goto(origin);
    const responses = await page.evaluate(async (positions) => {
      const modulePath = '/src/engine/maia.ts';
      const { MaiaClient } = await import(modulePath);
      const policy = new MaiaClient();
      const result = [];
      try {
        for (const position of positions) {
          result.push(await policy.predict(position.fen, position.rating, 1500));
        }
        const cached = await policy.predict(positions[0].fen, positions[0].rating, 1500);
        cached[0].probability = -1;
        result.push(await policy.predict(positions[0].fen, positions[0].rating, 1500));
      } finally { policy.terminate(); }
      return result;
    }, references.map(({ fen, rating }) => ({ fen, rating })));
    for (let index = 0; index < references.length; index++) {
      const expected = new Map(references[index].replies.map((reply) => [reply.move, reply.probability]));
      assert.equal(responses[index].length, expected.size);
      for (const reply of responses[index]) {
        assert.ok(Math.abs(reply.probability - expected.get(reply.move)!) < 1e-4, `Browser/Node Maia policy mismatch: ${reply.move}`);
      }
    }
    assert.deepEqual(responses[0], responses[responses.length - 1]);
    console.log('Real browser WASM worker loaded the model and matched Node policy on White, Black, ratings, and promotions (tolerance 1e-4).');
  } finally {
    await browser?.close();
    server.kill();
  }
}
