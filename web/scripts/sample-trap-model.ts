import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { allTrapStudies } from '../src/openings/trapLibrary';
import { NodeMaiaPolicy } from './maia-node';

const path = 'src/openings/trapModelSamples.json';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const modelSha256 = sha(await readFile('public/maia/maia3-5m.onnx'));
type ModelSample = { id: string; fen: string; mistake: string; opponentRating: number; engineRating: number;
  modelProbability: number | null; status: 'available' | 'unavailable'; inferredAt: string; reason?: string };
let cached: ModelSample[] = [];
try {
  const old = JSON.parse(await readFile(path, 'utf8'));
  if (old.modelSha256 === modelSha256 && !process.argv.includes('--fresh')) cached = old.positions;
} catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const report = { version: 1, createdAt: new Date().toISOString(), model: 'Maia-3 5m', modelSha256,
  sourceSha256: sha(JSON.stringify(allTrapStudies)), engineRating: 2400, humanRatings: [1000, 1400],
  method: 'Actual local Maia-3 inference using the same board encoding, legal mask and rating conditioning as the app. Each value is a conditional modeled probability for the named reply at the post-bait FEN, with fixed human-model rating 1000 or 1400 and opponent rating 2400. These are not observed human frequencies, measured lure rates, or automatic estimates for the current game controls. No games are simulated.',
  positions: [] as ModelSample[] };
let policy: NodeMaiaPolicy | undefined;
const save = async () => writeFile(path, JSON.stringify(report, null, 2) + '\n');
try {
  for (const study of allTrapStudies) for (const opponentRating of report.humanRatings) {
    const existing = cached.find(row => row.id === study.id && row.fen === study.afterBaitFen && row.mistake === study.temptingReplyUci
      && row.opponentRating === opponentRating && row.engineRating === report.engineRating && row.status === 'available'
      && typeof row.modelProbability === 'number' && row.modelProbability >= 0 && row.modelProbability <= 1);
    if (existing) { report.positions.push(existing); continue; }
    const base = { id: study.id, fen: study.afterBaitFen, mistake: study.temptingReplyUci,
      opponentRating, engineRating: report.engineRating, inferredAt: new Date().toISOString() };
    try {
      policy ??= new NodeMaiaPolicy();
      const distribution = await policy.predict(study.afterBaitFen, opponentRating, report.engineRating);
      assert.ok(Math.abs(distribution.reduce((sum, row) => sum + row.probability, 0) - 1) <= 1e-6, 'Legal policy must sum to one');
      const selected = distribution.find(row => row.move === study.temptingReplyUci);
      assert.ok(selected, 'Named legal reply is missing from the model vocabulary');
      assert.ok(Number.isFinite(selected.probability) && selected.probability >= 0 && selected.probability <= 1);
      report.positions.push({ ...base, modelProbability: selected.probability, status: 'available' });
      console.log(`${study.id} / Maia ${opponentRating}: ${(selected.probability * 100).toFixed(1)}% MODEL ESTIMATE`);
    } catch (error) { report.positions.push({ ...base, modelProbability: null, status: 'unavailable', reason: error instanceof Error ? error.message : String(error) }); }
    await save();
  }
  assert.equal(report.positions.length, allTrapStudies.length * report.humanRatings.length);
  assert.ok(report.positions.every(row => row.status === 'available'), 'Every fixed model reference must use actual inference');
  await save();
} finally { await policy?.terminate(); }
