import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const revision = '0c6bdaccfcb3b09cdbe94b0f81e948cb2a356015';
const base = `https://raw.githubusercontent.com/niklasf/python-chess/${revision}`;
const source = async path => {
  const response = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, `Could not fetch pinned ${path}`);
  return Buffer.from(await response.arrayBuffer());
};
const [python, license] = await Promise.all([source('chess/polyglot.py'), source('LICENSE.txt')]);
const table = python.toString('utf8').match(/POLYGLOT_RANDOM_ARRAY = \[([\s\S]*?)\]/)?.[1].match(/0x[0-9A-Fa-f]+/g);
assert.equal(table?.length, 781, 'Polyglot requires exactly 781 64-bit random constants');
const lines = [];
for (let index = 0; index < table.length; index += 4) lines.push(`  ${table.slice(index, index + 4).map(value => `${value}n`).join(', ')},`);
await mkdir('src/openings/source', { recursive: true });
await writeFile('src/openings/polyglotRandom.ts', `// SPDX-License-Identifier: GPL-3.0-or-later\n// Canonical Polyglot Zobrist constants from python-chess by Niklas Fiekas and contributors.\n// Pinned source: https://github.com/niklasf/python-chess/blob/${revision}/chess/polyglot.py\n// Extracted table only; regenerate with node scripts/update-polyglot-constants.mjs.\nexport const POLYGLOT_RANDOM_ARRAY: readonly bigint[] = [\n${lines.join('\n')}\n];\n`);
await writeFile('src/openings/source/python-chess-polyglot.py', python);
await writeFile('src/openings/source/python-chess-LICENSE.txt', license);
await writeFile('src/openings/source/python-chess-NOTICE.txt', `Polyglot hashing constants\n\nThe canonical 781-entry table is adapted from python-chess by Niklas Fiekas and contributors.\npython-chess is licensed under the GNU GPL version 3 or any later version at your option.\nPinned source: https://github.com/niklasf/python-chess/blob/${revision}/chess/polyglot.py\nCorresponding original source is retained as python-chess-polyglot.py; the full license is in python-chess-LICENSE.txt.\nThe TypeScript reader and hashing implementation are project adaptations.\n`);
await writeFile('src/openings/polyglotProvenance.json', `${JSON.stringify({
  repository: 'https://github.com/niklasf/python-chess', revision, license: 'GPL-3.0-or-later',
  sourceUrl: `https://github.com/niklasf/python-chess/blob/${revision}/chess/polyglot.py`,
  sourceSha256: createHash('sha256').update(python).digest('hex'),
  licenseSha256: createHash('sha256').update(license).digest('hex'),
  testVectorsUrl: `https://github.com/niklasf/python-chess/blob/${revision}/test.py`,
  formatUrl: 'https://python-chess.readthedocs.io/en/latest/polyglot.html', constants: table.length,
}, null, 2)}\n`);
console.log(`Pinned ${table.length} Polyglot constants and GPL notice at ${revision}.`);
