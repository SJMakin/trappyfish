import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { upstream } from './build-trap-library.mjs';
await mkdir('src/openings/source', { recursive: true });
for (const [remote, local, expected] of [
  ['data/traps.json', 'chess-coach-traps.json', upstream.sourceSha256],
  ['LICENSE', 'chess-coach-LICENSE.txt', upstream.licenseSha256],
]) {
  const response = await fetch(`https://raw.githubusercontent.com/jcabiles/chess-coach/${upstream.revision}/${remote}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, `Could not acquire pinned ${remote}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Pinned ${remote} failed its checksum`);
  await writeFile(`src/openings/source/${local}`, bytes);
}
console.log(`Acquired exact source data and MIT license at ${upstream.revision}. Run node scripts/build-trap-library.mjs to validate and derive studies.`);
