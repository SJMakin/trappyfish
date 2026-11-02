import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Chess, type Color } from 'chess.js';
import { TrappyEngine as BaselineEngine, DEFAULT_TRAPPY_SETTINGS as BASELINE_SETTINGS } from '../benchmarks/review/play-baseline/trappy';
import { TrappyEngine, DEFAULT_TRAPPY_SETTINGS, normalizePolicy, moveToUci, playUci } from '../src/engine/trappy';
import { NodeUci } from '../benchmarks/node-uci';
import { NodeMaiaPolicy } from './maia-node';
import openingStarts from '../benchmarks/review/play-data/opening-starts.json';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourceHash = async (path: string) => hash((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'));
const plies = 12;
const provenance = { engine: await sourceHash('src/engine/trappy.ts'), style: await sourceHash('src/engine/playingStyle.ts'),
  baseline: await sourceHash('benchmarks/review/play-baseline/trappy.ts'), book: await sourceHash('benchmarks/review/play-data/opening-starts.json'),
  model: hash(await readFile('public/maia/maia3-5m.onnx')), stockfish: hash(await readFile('node_modules/stockfish/bin/stockfish-18-lite-single.wasm')) };
const configurations = [{ id: 'baseline', settings: BASELINE_SETTINGS },
  { id: 'search', settings: { ...DEFAULT_TRAPPY_SETTINGS, continuationCandidates: 2 } }];
const path = 'benchmarks/review/play-paired-games.json';
let report: any = { version: 1, provenance, startedAt: new Date().toISOString(), configurations, plies,
  method: 'Eight12-ply bounded games: paired baseline/new, Maia1000/1500, both engine colours, fixed seeds20261101/20261102. Same inverse-CDF draws at each human turn within a pair. Four held-out Stockfish book starts; no trap book following. Actual cold-hash Stockfish oracle14 after every ply. Full12/10 selectors, no model fallback permitted.',
  caveat: 'Exploratory paired integration evidence, too short and too small to estimate a win rate, Elo, or population lure uptake. Opportunity means selector-nominated bait with an independently >=80cp losing first reply; a nominated second-turn setup is not a first-turn mistake.', games: [], summary: {} };
try { const saved = JSON.parse(await readFile(path, 'utf8')); assert.deepEqual(saved.provenance, provenance); report = saved; }
catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const uci = new NodeUci(); const maia = new NodeMaiaPolicy();
const baseline = new BaselineEngine(uci, maia); const engine = new TrappyEngine(uci, maia);
const random = (seed: number) => { let state = seed >>> 0; return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; }; };
const save = async () => { await writeFile(path, JSON.stringify(report, null, 2) + '\n'); };
const oracle = async (fen: string, color: Color) => {
  const board = new Chess(fen);
  const value = board.isGameOver() ? board.isCheckmate() ? -100000 : 0 : (await uci.analyzeFen(fen, 14, 1)).lines[0].score.cp;
  return value * (board.turn() === color ? 1 : -1);
};
try {
  await uci.init();
  for (const rating of [1000, 1500]) for (const color of ['w', 'b'] as const) for (const config of configurations) {
    const seed = color === 'w' ? 20261101 : 20261102;
    const id = `${rating}-${color}-${config.id}`;
    let game = report.games.find((row: any) => row.id === id);
    if (game?.finished) continue;
    const initialFen = openingStarts.positions[(rating === 1000 ? 0 : 2) + (color === 'w' ? 0 : 1)].fen;
    const board = new Chess(initialFen);
    const draw = random(seed);
    if (!game) {
      game = { id, configuration: config.id, rating, color, seed, initialFen, plies: [],
        initialOracleCp: await oracle(initialFen, color), finished: false };
      report.games.push(game);
    } else for (const ply of game.plies) { assert.ok(playUci(board, ply.move)); if (ply.actor === 'human-model') draw(); }
    for (let index = game.plies.length; index < plies && !board.isGameOver(); index++) {
      const began = Date.now(); const fen = board.fen(); const side = board.turn();
      const beforeCp = index ? game.plies[index - 1].oracleAfterCp : game.initialOracleCp;
      let row: any = { ply: index + 1, fen, side, oracleBeforeCp: beforeCp };
      if (side === color) {
        const settings = { ...config.settings, opponentRating: rating };
        const decision = config.id === 'baseline' ? await baseline.chooseMove(fen, settings, true)
          : await engine.chooseMove(fen, settings, true);
        assert.equal(decision.warning, undefined);
        assert.ok(decision.selected.riskCp <= (decision.riskLimitCp ?? settings.maxRiskCp));
        row = { ...row, actor: 'engine', move: decision.move, san: decision.san, riskCp: decision.selected.riskCp,
          expectedUtility: decision.selected.expectedScore, coverage: decision.selected.policyCoverage,
          nominatedBait: decision.selected.trap, diagnostics: decision.diagnostics,
          opportunities: 0, lureUptake: 0, punishment: 0 };
        if (decision.selected.trap && !decision.selected.trap.nextReply) {
          const after = new Chess(fen); playUci(after, decision.move);
          const best = await oracle(after.fen(), color);
          const tempted = new Chess(after.fen());
          if (playUci(tempted, decision.selected.trap.reply)) {
            row.verifiedLureGainCp = (await oracle(tempted.fen(), color)) - best;
            row.opportunities = row.verifiedLureGainCp >= 80 ? 1 : 0;
          }
        }
      } else {
        const legal = new Map(board.moves({ verbose: true }).map((move) => [moveToUci(move), move]));
        const distribution = normalizePolicy(await maia.predict(fen, rating, 2400), legal);
        const randomDraw = draw(); let cumulative = 0;
        const selected = distribution.find((entry) => { cumulative += entry.probability; return randomDraw < cumulative; }) ?? distribution[distribution.length - 1];
        row = { ...row, actor: 'human-model', move: selected.move, probability: selected.probability, randomDraw };
        const previous = game.plies[index - 1];
        if (previous?.actor === 'engine' && previous.opportunities && previous.nominatedBait?.reply === selected.move) previous.lureUptake = 1;
      }
      const played = playUci(board, row.move); assert.ok(played);
      row.san = played.san; row.fenAfter = board.fen(); row.oracleAfterCp = await oracle(board.fen(), color);
      row.concessionCp = row.actor === 'engine' ? Math.max(0, beforeCp - row.oracleAfterCp) : 0;
      row.elapsedMs = Date.now() - began;
      if (row.actor === 'engine') {
        const bait = game.plies[index - 2];
        if (bait?.actor === 'engine' && bait.lureUptake && row.oracleAfterCp >= beforeCp - 50) bait.punishment = 1;
      }
      game.plies.push(row); await save();
      console.log(`${id} ply${index + 1} ${row.actor} ${row.san}, oracle${row.oracleAfterCp}cp, ${row.elapsedMs}ms`);
    }
    game.finished = true; game.finalFen = board.fen(); game.pgn = board.pgn();
    game.stop = board.isGameOver() ? board.isCheckmate() ? 'checkmate' : 'draw' : '12-ply bound';
    await save();
  }
  for (const config of configurations) {
    const turns = report.games.filter((game: any) => game.configuration === config.id).flatMap((game: any) => game.plies).filter((ply: any) => ply.actor === 'engine');
    const latencies = turns.map((turn: any) => turn.diagnostics?.elapsedMs ?? turn.elapsedMs).sort((a: number, b: number) => a - b);
    const validationLatencies = turns.map((turn: any) => turn.elapsedMs).sort((a: number, b: number) => a - b);
    report.summary[config.id] = { games: report.games.filter((game: any) => game.configuration === config.id).length,
      engineTurns: turns.length, verifiedFirstReplyOpportunities: turns.reduce((sum: number, turn: any) => sum + turn.opportunities, 0),
      lureUptake: turns.reduce((sum: number, turn: any) => sum + turn.lureUptake, 0),
      punishmentMaintained: turns.reduce((sum: number, turn: any) => sum + turn.punishment, 0),
      averageConcessionCp: turns.reduce((sum: number, turn: any) => sum + turn.concessionCp, 0) / turns.length,
      medianDecisionLatencyMs: latencies[Math.floor(latencies.length / 2)], maxDecisionLatencyMs: latencies.at(-1),
      medianValidationInclusiveLatencyMs: validationLatencies[Math.floor(validationLatencies.length / 2)] };
  }
  report.finishedAt = new Date().toISOString(); await save();
  assert.equal(provenance.engine, await sourceHash('src/engine/trappy.ts'));
  console.log(JSON.stringify(report.summary));
} finally { uci.terminate(); await maia.terminate(); }
