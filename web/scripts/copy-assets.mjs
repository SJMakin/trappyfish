import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'public/stockfish');
await mkdir(destination, { recursive: true });
for (const file of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
  await copyFile(resolve(root, 'node_modules/stockfish/bin', file), resolve(destination, file));
}
await import('./copy-fenshot-assets.mjs');
console.log('Prepared objective Stockfish and screenshot recognition assets.');
