import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PLAY_CORPUS } from '../benchmarks/play-corpus';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourceHash = async (path: string) => digest((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'));
const positions = JSON.parse(await readFile('benchmarks/review/play-calibration.json', 'utf8'));
const styles = JSON.parse(await readFile('benchmarks/review/play-style-calibration.json', 'utf8'));
const games = JSON.parse(await readFile('benchmarks/review/play-paired-games.json', 'utf8'));
const examples = JSON.parse(await readFile('src/play/styleExamples.json', 'utf8'));
const baseline = JSON.parse((await readFile('benchmarks/review/play-baseline/manifest.json', 'utf8')).replace(/^\uFEFF/, ''));
for (const file of baseline.files) assert.equal(await sourceHash(`benchmarks/review/play-baseline/${file.name}`), file.sha256, `Frozen baseline changed: ${file.name}`);
for (const [key, path] of Object.entries({ engine: 'src/engine/trappy.ts', style: 'src/engine/playingStyle.ts',
  baseline: 'benchmarks/review/play-baseline/trappy.ts', lock: 'package-lock.json', catalogue: 'src/openings/catalogue.json',
  puzzles: 'src/openings/puzzleSourceRows.json', curatedRepertoire: 'src/openings/trapRepertoire.ts',
  book: 'benchmarks/review/play-data/opening-starts.json' })) assert.equal(await sourceHash(path), positions.provenance[key], `Calibration stale: ${path}`);
assert.equal(digest(JSON.stringify(PLAY_CORPUS)), positions.provenance.corpus);
assert.equal(styles.provenance.engineSha256, positions.provenance.engine);
assert.equal(styles.provenance.styleSha256, positions.provenance.style);
assert.equal(games.provenance.engine, positions.provenance.engine);
assert.equal(games.provenance.style, positions.provenance.style);
const projectedExamples = styles.examples.map((example: any) => ({ ...example,
  fixedPool: example.fixedPool.map((level: any) => ({ value: level.value, san: level.selectedSan, move: level.selectedMove })) }));
for (let index = 0; index < projectedExamples.length; index++) assert.deepEqual(examples.examples[index], projectedExamples[index], `UI example must come from measured report: ${projectedExamples[index].key}`);
assert.equal(positions.gates.release, true, 'The full Play behavioral release gate must pass');
assert.equal(positions.corpus.length, 30);
const gains = [...new Set([...positions.gates.newSearchPreparation, ...positions.gates.newBookPreparation])];
assert.ok(gains.length >= 2);
for (const id of gains) assert.ok(positions.preparations.some((row: any) => row.id === id && row.configuration !== 'baseline'
  && row.success && row.safePreparation && row.nonBlundering && row.safeBait && row.verifiedPunishment), `Preparation gain lacks safety evidence: ${id}`);
assert.equal(games.games.length, 8); assert.ok(games.games.every((game: any) => game.finished));
assert.equal(styles.examples.length, 12); assert.ok(styles.examples.every((example: any) => example.levels.length === 3 && example.fixedPool.length === 3));
console.log(`Play release evidence verified: source hashes, 30 cases, ${gains.length} preparation gains, 12 control examples and 8 paired games.`);
