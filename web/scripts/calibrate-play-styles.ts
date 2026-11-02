import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Chess } from 'chess.js';
import { DEFAULT_TRAPPY_SETTINGS, TrappyEngine, cpToExpectedScore, expectedScoreToCp } from '../src/engine/trappy';
import { scorePlayingStyle, styleBonusCp } from '../src/engine/playingStyle';
import { NodeUci } from '../benchmarks/node-uci';
import { NodeMaiaPolicy } from './maia-node';
import { TRAP_POSITIONS } from '../benchmarks/trap-positions';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourceHash = hash((await readFile('src/engine/trappy.ts', 'utf8')).replace(/\r\n/g, '\n'));
const fixture = (id: string) => TRAP_POSITIONS.find((row) => row.id === id)!.fen;
const italian = new Chess();
for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O', 'O-O']) italian.move(move);
const attack = italian.fen();
const exchange = 'r2q1rk1/ppp2ppp/2n1bn2/3p4/3P4/2NBPN2/PPP2PPP/R2Q1RK1 w - - 0 9';
const cases = [
  { key: 'trappiness', label: 'Trappiness', fen: fixture('legal-sound') },
  { key: 'aggression', label: 'King attack', fen: attack },
  { key: 'tension', label: 'Tension', fen: fixture('legal-premature') },
  { key: 'pawnStorm', label: 'Pawn storms', fen: '6k1/5ppp/8/8/8/8/6P1/K5R1 w - - 0 1' },
  { key: 'kingCaution', label: 'King caution', fen: attack },
  { key: 'sacrifice', label: 'Sacrifice appetite', fen: fixture('legal-sound') },
  { key: 'sharpness', label: 'Sharpness', fen: fixture('fishing-pole') },
  { key: 'queenRetention', label: 'Queen retention', fen: exchange },
  { key: 'drawAversion', label: 'Draw aversion', fen: '8/8/8/4k3/8/3K4/4P3/8 w - - 0 1' },
  { key: 'variety', label: 'Variety', fen: new Chess().fen() },
  { key: 'maxRiskCp', label: 'Risk tolerance', fen: fixture('legal-premature'), values: [0, 150, 300] },
  { key: 'winningRiskCp', label: 'Risk when winning', fen: '4k3/8/8/8/8/8/PPPP4/R3K3 w Q - 0 1', values: [0, 150, 300] },
] as const;
const budget = { ...DEFAULT_TRAPPY_SETTINGS, rootDepth: 8, trapDepth: 7, candidateCount: 4,
  replyCount: 3, opponentPlies: 1 as const, continuationCandidates: 1 };
const provenance = { engineSha256: sourceHash,
  styleSha256: hash((await readFile('src/engine/playingStyle.ts', 'utf8')).replace(/\r\n/g, '\n')),
  modelSha256: hash(await readFile('public/maia/maia3-5m.onnx')),
  stockfishSha256: hash(await readFile('node_modules/stockfish/bin/stockfish-18-lite-single.wasm')),
  corpusSha256: hash(JSON.stringify(cases)), seed: 20261101, randomDraw: .3141592653589793 };
const path = 'benchmarks/review/play-style-calibration.json';
let report: any = { version: 1, startedAt: new Date().toISOString(), provenance, budget,
  method: 'Actual Stockfish/Maia at explicit8/7 one-human-turn budget. End-to-end discovery may change the candidate pool; separately re-rank its union without new searches. Independent selector moves checked at depth14. A fixed random draw makes variety examples reproducible; it is not a style preset.', rows: [] };
try { const saved = JSON.parse(await readFile(path, 'utf8')); assert.deepEqual(saved.provenance, provenance); report = saved; }
catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const uci = new NodeUci(); const maia = new NodeMaiaPolicy();
const engine = new TrappyEngine(uci, maia, () => provenance.randomDraw);
const save = async () => { await writeFile(path, JSON.stringify(report, null, 2) + '\n'); };
const contribution = (key: string, candidate: any, fen: string, value: number) => {
  if (Math.abs(candidate.rootScoreCp) >= 90000) return 0;
  const knownDefense = candidate.replies?.reduce((best: any, reply: any) => !best || reply.scoreCp < best.scoreCp ? reply : best, undefined);
  const path = knownDefense ? [knownDefense.move, ...knownDefense.punishment] : candidate.pv?.slice(1) ?? [];
  const style = scorePlayingStyle(fen, candidate.move, path, { [key]: value });
  return styleBonusCp({ ...style, sharpnessBonusCp: key === 'sharpness' ? 60 * value * (candidate.style?.sharpness ?? 0) : 0,
    drawAversionPenaltyCp: key === 'drawAversion' ? 60 * value * (candidate.objectiveWdl?.draw ?? 0) : 0 });
};
const effectContribution = (key: string, candidate: any, fen: string, value: number) => key === 'trappiness'
  && Math.abs(candidate.rootScoreCp) < 90000 ? expectedScoreToCp(cpToExpectedScore(candidate.rootScoreCp)
    + value * (candidate.expectedScore - cpToExpectedScore(candidate.rootScoreCp))) - candidate.rootScoreCp
  : contribution(key, candidate, fen, value);
try {
  await uci.init();
  for (const example of cases) {
    const levels = 'values' in example ? example.values : [0, .5, 1];
    for (const value of levels) {
      if (report.rows.some((row: any) => row.key === example.key && row.value === value)) continue;
      const settings = { ...budget, [example.key]: value };
      const began = Date.now(); const decision = await engine.chooseMove(example.fen, settings, true);
      assert.equal(decision.warning, undefined);
      assert.ok(decision.selected.riskCp <= (decision.riskLimitCp ?? settings.maxRiskCp));
      const root = (await uci.analyzeFen(example.fen, 14, 1)).lines[0].score.cp;
      const forced = (await uci.analyzeFen(example.fen, 14, 1, [decision.move])).lines[0].score.cp;
      report.rows.push({ ...example, value, settings, elapsedMs: Date.now() - began, decision,
        independent: { depth: 14, rootCp: root, forcedCp: forced, riskCp: Math.max(0, root - forced) } });
      await save(); console.log(`${example.key}=${value}: ${decision.san}, oracle risk${Math.max(0, root - forced)}cp`);
    }
  }
  const examples = cases.map((example) => {
    const rows = report.rows.filter((row: any) => row.key === example.key);
    const pool = new Map<string, any>();
    for (const row of rows) for (const candidate of row.decision.candidates) {
      const previous = pool.get(candidate.move);
      if (!previous || candidate.analyzed && !previous.analyzed || candidate.style?.sharpnessAvailable) pool.set(candidate.move, candidate);
    }
    const fixedPool = rows.map((row: any) => {
      const best = Math.max(...[...pool.values()].map((candidate) => candidate.rootScoreCp));
      const limit = best >= 500 ? Math.min(row.settings.maxRiskCp, row.settings.winningRiskCp ?? 40) : row.settings.maxRiskCp;
      const candidates = [...pool.values()].filter((candidate) => best - candidate.rootScoreCp <= limit).map((candidate) => {
        const base = cpToExpectedScore(candidate.rootScoreCp);
        const utility = base + row.settings.trappiness * ((candidate.expectedScore ?? base) - base);
        return { move: candidate.move, san: candidate.san, rankingCp: Math.abs(candidate.rootScoreCp) >= 90000 ? candidate.rootScoreCp
          : expectedScoreToCp(utility) + contribution(example.key, candidate, example.fen, row.value) };
      }).sort((a, b) => b.rankingCp - a.rankingCp || a.move.localeCompare(b.move));
      const temperature = 100 * (row.settings.variety ?? 0);
      const weights = candidates.map((candidate) => temperature ? Math.exp((candidate.rankingCp - candidates[0].rankingCp) / temperature) : candidate === candidates[0] ? 1 : 0);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let draw = provenance.randomDraw;
      let selected = candidates[0];
      for (let index = 0; index < candidates.length; index++) { draw -= weights[index] / total; if (draw < 0) { selected = candidates[index]; break; } }
      return { value: row.value, selectedMove: selected.move, selectedSan: selected.san,
        candidates: candidates.map((candidate, index) => ({ ...candidate, probability: weights[index] / total })) };
    });
    const levels = rows.map((row: any) => ({ value: row.value, move: row.decision.move, san: row.decision.san,
      riskCp: row.decision.selected.riskCp, oracleRiskCp: row.independent.riskCp,
      contributionCp: effectContribution(example.key, row.decision.selected, example.fen, row.value),
      candidateCount: row.decision.candidates.length, probability: row.decision.selected.selectionProbability }));
    const effectCandidate = [...pool.values()].filter((candidate) => candidate.analyzed).sort((a, b) => Math.abs(effectContribution(example.key, b, example.fen, 1))
      - Math.abs(effectContribution(example.key, a, example.fen, 1)) || a.move.localeCompare(b.move))[0];
    const effectExample = effectCandidate ? { move: effectCandidate.move, san: effectCandidate.san,
      contributions: [0, .5, 1].map((value) => ({ value, cp: effectContribution(example.key, effectCandidate, example.fen, value) })) } : undefined;
    return { key: example.key, label: example.label, fen: example.fen, levels, fixedPool, effectExample,
      noDifference: new Set(levels.map((level: any) => level.move)).size === 1,
      note: new Set(levels.map((level: any) => level.move)).size === 1
        ? 'The chosen move did not change in this position. A preference changes ranking, not a promise to choose a particular move.'
        : 'Observed moves from fresh searches. Pool membership and defense estimates may also change between settings.' };
  });
  const riskPool = report.rows.find((row: any) => row.key === 'maxRiskCp' && row.value === 300).decision.candidates
    .filter((candidate: any) => candidate.analyzed);
  const poolBest = Math.max(...riskPool.map((candidate: any) => candidate.rootScoreCp));
  report.interactionMethod = 'Fixed pool from the independently measured300cp-risk example; only analyzed candidates.27 explicit trappiness/risk/variety combinations, three fixed LCG seeds after16 warmup iterations (1664525*s+1013904223 modulo2^32). Distinct from three fresh end-to-end interaction runs below.';
  report.fixedPoolInteractions = [];
  for (const trappiness of [0, .5, 1]) for (const maxRiskCp of [0, 100, 300]) for (const variety of [0, .5, 1]) {
    const eligible = riskPool.filter((candidate: any) => poolBest - candidate.rootScoreCp <= maxRiskCp).map((candidate: any) => {
      const base = cpToExpectedScore(candidate.rootScoreCp);
      return { move: candidate.move, san: candidate.san,
        rankingCp: expectedScoreToCp(base + trappiness * (candidate.expectedScore - base)) };
    }).sort((a: any, b: any) => b.rankingCp - a.rankingCp || a.move.localeCompare(b.move));
    const weights = eligible.map((candidate: any, index: number) => variety ? Math.exp((candidate.rankingCp - eligible[0].rankingCp) / (100 * variety)) : index ? 0 : 1);
    const total = weights.reduce((sum: number, value: number) => sum + value, 0);
    const samples = [20261101, 20261102, 20261103].map((seed) => {
      let state = seed >>> 0;
      for (let iteration = 0; iteration < 16; iteration++) state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      const randomDraw = state / 0x100000000;
      let draw = randomDraw; let chosen = eligible[eligible.length - 1];
      for (let index = 0; index < eligible.length; index++) { draw -= weights[index] / total; if (draw < 0) { chosen = eligible[index]; break; } }
      return { seed, randomDraw, move: chosen.move, san: chosen.san };
    });
    report.fixedPoolInteractions.push({ trappiness, maxRiskCp, variety, samples,
      probabilities: eligible.map((candidate: any, index: number) => ({ ...candidate, probability: weights[index] / total })) });
  }
  report.endToEndInteractions ??= [];
  for (const [trappiness, maxRiskCp] of [[0, 0], [.5, 100], [1, 300]]) {
    if (report.endToEndInteractions.some((row: any) => row.settings.trappiness === trappiness && row.settings.maxRiskCp === maxRiskCp)) continue;
    const settings = { ...budget, trappiness, maxRiskCp, variety: .5 };
    const fen = fixture('legal-premature'); const began = Date.now();
    const decision = await engine.chooseMove(fen, settings, true); assert.equal(decision.warning, undefined);
    assert.ok(decision.selected.riskCp <= (decision.riskLimitCp ?? settings.maxRiskCp));
    report.endToEndInteractions.push({ fen, settings, elapsedMs: Date.now() - began, decision }); await save();
  }
  report.examples = examples; report.finishedAt = new Date().toISOString(); await save();
  await mkdir('src/play', { recursive: true });
  await writeFile('src/play/styleExamples.json', JSON.stringify({ provenance, budget,
    method: report.method, examples: examples.map(({ fixedPool, ...example }: any) => ({ ...example,
      fixedPool: fixedPool.map((level: any) => ({ value: level.value, san: level.selectedSan, move: level.selectedMove })) })) }, null, 2) + '\n');
  assert.equal(sourceHash, hash((await readFile('src/engine/trappy.ts', 'utf8')).replace(/\r\n/g, '\n')));
} finally { uci.terminate(); await maia.terminate(); }
