import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Chess } from 'chess.js';
import { TrappyEngine as BaselineEngine, DEFAULT_TRAPPY_SETTINGS as BASELINE_SETTINGS } from '../benchmarks/review/play-baseline/trappy';
import { TrappyEngine, DEFAULT_TRAPPY_SETTINGS, playUci, moveToUci, cpToExpectedScore, type MoveDecision } from '../src/engine/trappy';
import { PLAY_CORPUS, type PlayCase } from '../benchmarks/play-corpus';
import { NodeUci } from '../benchmarks/node-uci';
import { NodeMaiaPolicy } from './maia-node';
import { matchingBookMoves } from '../src/openings/library';

const arg = (name: string, fallback: string) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1] ?? fallback; };
const output = resolve(arg('--output', 'benchmarks/review/play-calibration.json'));
const only = arg('--cases', '').split(',').filter(Boolean);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourceHash = async (path: string) => hash((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'));
const provenance = {
  engine: await sourceHash('src/engine/trappy.ts'), style: await sourceHash('src/engine/playingStyle.ts'),
  baseline: await sourceHash('benchmarks/review/play-baseline/trappy.ts'), lock: await sourceHash('package-lock.json'),
  model: hash(await readFile('public/maia/maia3-5m.onnx')), stockfish: hash(await readFile('node_modules/stockfish/bin/stockfish-18-lite-single.wasm')),
  catalogue: await sourceHash('src/openings/catalogue.json'), puzzles: await sourceHash('src/openings/puzzleSourceRows.json'),
  curatedRepertoire: await sourceHash('src/openings/trapRepertoire.ts'),
  book: await sourceHash('benchmarks/review/play-data/opening-starts.json'), corpus: hash(JSON.stringify(PLAY_CORPUS)),
};
const settings = { ...DEFAULT_TRAPPY_SETTINGS, continuationCandidates: 2 };
const configurations = [
  { id: 'baseline', settings: BASELINE_SETTINGS, book: false },
  { id: 'search', settings, book: false }, { id: 'book-assisted', settings, book: true },
];
let report: any = { version: 1, startedAt: new Date().toISOString(), provenance, configurations,
  method: 'Actual cold-hash Stockfish 18 lite and Maia3. Selector 12/10, independent oracle 16/15. Fixed corpus, no fixture-specific engine logic.',
  preparationDefinition: 'Selected own setup moves match the fixture path to a selected safe bait; supplied human continuation loses at most100cp per move under depth16 oracle; tempting reply permits >=80cp gain and the named first punishment is independently within50cp of best. Famous dubious baits are rejected, not successes.',
  limitation: 'A narrow fixed-corpus behavioral calibration, not a rating or general trap-rate estimate. Book-assisted and search-only preparation are reported separately.',
  corpus: PLAY_CORPUS, rows: [], roots: {}, oracle: {}, preparations: [], punishments: [], gates: {} };
try {
  if (!process.argv.includes('--fresh')) {
    const saved = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(saved.provenance, provenance, 'Calibration source/data changed: use a new output or --fresh.');
    report = saved;
  }
} catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const uci = new NodeUci();
report.preparationDefinition = 'Selected own setup moves reach the fixture bait within the applicable independent-oracle risk caps. Supplied human setup moves lose at most 100cp per move at depth 16; the tempting reply permits at least 80cp gain and the named first punishment is within 50cp of best. Baits outside the explicit risk budget are rejected, and permitted concessions are reported.';
const maia = new NodeMaiaPolicy();
const engine = new TrappyEngine(uci, maia);
const baseline = new BaselineEngine(uci, maia);
const save = async () => { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
function slim(decision: MoveDecision) {
  return { move: decision.move, san: decision.san, warning: decision.warning, provenance: decision.provenance,
    rootBestMove: decision.rootBestMove, rootBestScoreCp: decision.rootBestScoreCp, riskLimitCp: decision.riskLimitCp,
    selected: decision.selected, selection: decision.selection, diagnostics: decision.diagnostics,
    candidates: decision.candidates.map((row) => ({ move: row.move, san: row.san, objectiveCp: row.rootScoreCp,
      riskCp: row.riskCp, adjustedCp: row.adjustedScoreCp, expectedScore: row.expectedScore,
      policyCoverage: row.policyCoverage, mistakeProbability: row.mistakeProbability,
      analyzed: row.analyzed, style: row.style, trap: row.trap, pv: row.pv, objectiveWdl: row.objectiveWdl })) };
}
async function root(fen: string) {
  if (report.roots[fen] !== undefined) return report.roots[fen] as number;
  const board = new Chess(fen);
  const value = board.isGameOver() ? board.isCheckmate() ? -100000 : 0 : (await uci.analyzeFen(fen, 16, 1)).lines[0].score.cp;
  report.roots[fen] = value; return value;
}
async function oracle(fen: string, move: string) {
  const key = `${fen}|${move}`;
  if (report.oracle[key]) return report.oracle[key];
  const before = await root(fen);
  const board = new Chess(fen);
  assert.ok(playUci(board, move), `Illegal oracle move ${move}`);
  let scoreCp: number;
  let pv: string[];
  if (board.isGameOver()) { scoreCp = board.isCheckmate() ? 100000 : 0; pv = [move]; }
  else {
    const forced = (await uci.analyzeFen(fen, 16, 1, [move])).lines[0];
    const defense = (await uci.analyzeFen(board.fen(), 15, 1)).lines[0];
    scoreCp = Math.min(forced.score.cp, -defense.score.cp); pv = [move, ...defense.pv];
  }
  const result = { rootCp: before, scoreCp, riskCp: Math.max(0, before - scoreCp), pv };
  report.oracle[key] = result; return result;
}
async function execute(fixture: PlayCase, config: typeof configurations[number]) {
  const previous = report.rows.find((row: any) => row.id === fixture.id && row.configuration === config.id);
  if (previous) return previous;
  if (config.book && !fixture.bookMove) return;
  const began = Date.now();
  const bookIds: Record<string, string> = { 'legal-sound': 'trap-legal', blackburne: 'trap-blackburne',
    'fishing-pole': 'trap-fishing-pole', englund: 'trap-englund', elephant: 'trap-elephant' };
  const setup = new Chess();
  const history = (fixture.setup ?? []).map((san) => moveToUci(setup.move(san)));
  const bookMoves = config.book ? matchingBookMoves(history, [bookIds[fixture.family!]]) : undefined;
  if (config.book) assert.ok(bookMoves?.includes(fixture.bookMove!), 'Book-assisted evidence must use the actual selectable repertoire.');
  const choice = config.id === 'baseline' ? await baseline.chooseMove(fixture.fen, config.settings, true)
    : await engine.chooseMove(fixture.fen, config.settings, true, { bookMoves });
  assert.equal(choice.warning, undefined, `Model fallback ${fixture.id}/${config.id}: ${choice.warning}`);
  assert.ok(choice.selected.riskCp <= config.settings.maxRiskCp + 1e-8);
  const elapsedMs = Date.now() - began;
  const independent = await oracle(fixture.fen, choice.move);
  const row = { id: fixture.id, configuration: config.id, elapsedMs, decision: slim(choice), independent };
  report.rows.push(row); await save();
  console.log(`${fixture.id}/${config.id}: ${choice.san}, defensive risk${independent.riskCp}cp, ${elapsedMs}ms`);
  return row;
}
async function verifyPreparations() {
  for (const fixture of PLAY_CORPUS.filter((row) => row.role === 'preparation')) {
    const bait = PLAY_CORPUS.find((row) => row.id === fixture.family)!;
    const board = new Chess(fixture.fen);
    const path: { fen: string; move: string; human: boolean; riskCp?: number }[] = [];
    for (let index = 0; index < fixture.remaining!.length; index++) {
      const fen = board.fen();
      const move = moveToUci(board.move(fixture.remaining![index]));
      const human = index % 2 === 1;
      path.push({ fen, move, human, ...(human ? { riskCp: (await oracle(fen, move)).riskCp } : {}) });
    }
    const baitOracle = await oracle(bait.fen, bait.expectedMove!);
    const after = new Chess(bait.fen);
    playUci(after, bait.expectedMove!);
    const afterBaitFen = after.fen();
    const tempting = moveToUci(after.move(bait.temptingReply!));
    const temptingOracle = await oracle(afterBaitFen, tempting);
    const punishmentMove = moveToUci(new Chess(after.fen()).move(bait.punishment![0]));
    const punishment = await oracle(after.fen(), punishmentMove);
    const gainCp = -temptingOracle.scoreCp - baitOracle.scoreCp;
    for (const config of configurations) {
      const decisions = path.filter((step) => !step.human).map((step) => report.rows.find((row: any) =>
        row.configuration === config.id && PLAY_CORPUS.find((test) => test.id === row.id)?.fen === step.fen));
      const baitDecision = report.rows.find((row: any) => row.id === bait.id && row.configuration === config.id);
      const complete = decisions.every(Boolean) && Boolean(baitDecision);
      const selectedPath = complete && decisions.every((row, index) => row.decision.move === path.filter((step) => !step.human)[index].move);
      const safePreparation = complete && decisions.every((row) => row.independent.riskCp <=
        (row.independent.rootCp >= 500 ? Math.min(config.settings.maxRiskCp, config.settings.winningRiskCp ?? 40) : config.settings.maxRiskCp));
      const nonBlundering = path.filter((step) => step.human).every((step) => step.riskCp! <= 100);
      const safeBait = baitOracle.riskCp <= (baitOracle.rootCp >= 500 ? Math.min(config.settings.maxRiskCp, config.settings.winningRiskCp ?? 40) : config.settings.maxRiskCp);
      const selectedBait = baitDecision?.decision.move === bait.expectedMove;
      const verifiedPunishment = gainCp >= 80 && punishment.riskCp <= 50;
      const result = { id: fixture.id, configuration: config.id, complete, selectedPath, safePreparation, nonBlundering, safeBait,
        selectedBait, verifiedPunishment, gainCp, baitRiskCp: baitOracle.riskCp, path,
        success: complete && selectedPath && safePreparation && nonBlundering && safeBait && selectedBait && verifiedPunishment };
      report.preparations = report.preparations.filter((row: any) => row.id !== fixture.id || row.configuration !== config.id);
      report.preparations.push(result);
    }
    await save();
  }
}
async function verifyPunishments() {
  for (const fixture of PLAY_CORPUS.filter((row) => row.role === 'bait')) {
    const board = new Chess(fixture.fen);
    playUci(board, fixture.expectedMove!); board.move(fixture.temptingReply!);
    for (const config of configurations.filter((config) => !config.book)) {
      if (report.punishments.some((row: any) => row.id === fixture.id && row.configuration === config.id)) continue;
      const began = Date.now();
      const choice = config.id === 'baseline' ? await baseline.chooseMove(board.fen(), config.settings, true)
        : await engine.chooseMove(board.fen(), config.settings, true);
      assert.equal(choice.warning, undefined);
      const independent = await oracle(board.fen(), choice.move);
      report.punishments.push({ id: fixture.id, configuration: config.id, fen: board.fen(), elapsedMs: Date.now() - began,
        decision: slim(choice), independent }); await save();
      console.log(`punishment/${fixture.id}/${config.id}: ${choice.san}, independent risk${independent.riskCp}cp`);
    }
  }
}
function gates() {
  const old = PLAY_CORPUS.slice(0, 8);
  const soundness = old.every((fixture) => {
    const before = report.rows.find((row: any) => row.id === fixture.id && row.configuration === 'baseline');
    const after = report.rows.find((row: any) => row.id === fixture.id && row.configuration === 'search');
    return before && after && after.independent.riskCp <= Math.max(settings.maxRiskCp, before.independent.riskCp);
  });
  const punishments = report.punishments.length === 10 && report.punishments.filter((row: any) => row.configuration === 'search').every((row: any) => {
    const before = report.punishments.find((prior: any) => prior.id === row.id && prior.configuration === 'baseline');
    return row.independent.riskCp <= Math.max(50, before.independent.riskCp)
      && (before.independent.scoreCp < 90000 || row.independent.scoreCp >= 90000);
  });
  const gains = (configuration: string) => report.preparations.filter((row: any) => row.configuration === configuration && row.success
    && !report.preparations.find((prior: any) => prior.id === row.id && prior.configuration === 'baseline')?.success).map((row: any) => row.id);
  const heldOutTactics = PLAY_CORPUS.filter((fixture) => fixture.id.startsWith('held-out-')).map((fixture) => {
    const before = report.rows.find((row: any) => row.id === fixture.id && row.configuration === 'baseline');
    const after = report.rows.find((row: any) => row.id === fixture.id && row.configuration === 'search');
    return { id: fixture.id, baselineRiskCp: before?.independent.riskCp, searchRiskCp: after?.independent.riskCp,
      preserves: Boolean(before && after && after.independent.riskCp <= Math.max(50, before.independent.riskCp)
        && (before.independent.scoreCp < 90000 || after.independent.scoreCp >= 90000)) };
  });
  const independentRiskAudit = report.rows.filter((row: any) => row.configuration !== 'baseline').map((row: any) => {
    const limitCp = row.independent.rootCp >= 500 ? Math.min(settings.maxRiskCp, settings.winningRiskCp ?? 40) : settings.maxRiskCp;
    const before = report.rows.find((prior: any) => prior.id === row.id && prior.configuration === 'baseline');
    return { id: row.id, configuration: row.configuration, limitCp, oracleRiskCp: row.independent.riskCp,
      baselineOracleRiskCp: before?.independent.riskCp,
      outsideOracleLimit: row.independent.riskCp > limitCp,
      newViolation: row.independent.riskCp > limitCp && (!before || row.independent.riskCp > before.independent.riskCp) };
  });
  report.gates = { complete: PLAY_CORPUS.length === 30 && report.rows.filter((row: any) => row.configuration === 'baseline').length === 30
    && report.rows.filter((row: any) => row.configuration === 'search').length === 30
    && report.rows.filter((row: any) => row.configuration === 'book-assisted').length === PLAY_CORPUS.filter((fixture) => fixture.bookMove).length,
    existingSoundness: soundness, suppliedMistakePunishment: punishments,
    heldOutTacticalPreservation: heldOutTactics.every((row) => row.preserves), heldOutTactics,
    independentRiskAudit, independentRiskOutliers: independentRiskAudit.filter((row: any) => row.outsideOracleLimit),
    noNewIndependentRiskViolations: independentRiskAudit.every((row: any) => !row.newViolation),
    newSearchPreparation: gains('search'), newBookPreparation: gains('book-assisted'),
    atLeastTwoNewPreparations: new Set([...gains('search'), ...gains('book-assisted')]).size >= 2 };
  report.gates.release = report.gates.complete && soundness && punishments && report.gates.heldOutTacticalPreservation
    && report.gates.noNewIndependentRiskViolations && report.gates.atLeastTwoNewPreparations;
}
try {
  assert.equal(PLAY_CORPUS.length, 30);
  await uci.init();
  for (const fixture of PLAY_CORPUS.filter((row) => !only.length || only.includes(row.id))) {
    for (const config of configurations) await execute(fixture, config);
  }
  if (!only.length) { await verifyPreparations(); await verifyPunishments(); }
  gates(); report.finishedAt = new Date().toISOString(); await save();
  assert.equal(provenance.engine, await sourceHash('src/engine/trappy.ts'), 'Engine changed during calibration.');
  console.log(JSON.stringify(report.gates));
  if (!only.length && !report.gates.release) process.exitCode = 1;
} finally { uci.terminate(); await maia.terminate(); }
