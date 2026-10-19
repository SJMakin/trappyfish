import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
import { NodeUci } from '../benchmarks/node-uci';
import { NodeMaiaPolicy } from './maia-node';
import { DEFAULT_TRAPPY_SETTINGS, TrappyEngine, playUci, type TrappySettings } from '../src/engine/trappy';
import { TRAP_POSITIONS } from '../benchmarks/trap-positions';

const uci = new NodeUci(); const maia = new NodeMaiaPolicy();
const engine = new TrappyEngine(uci.asClient(), maia);
const board = new Chess();
for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) board.move(san);
const attackingBoard = new Chess();
for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O', 'O-O']) attackingBoard.move(san);
const rows: unknown[] = [];
const base: TrappySettings = { ...DEFAULT_TRAPPY_SETTINGS, rootDepth: 8, trapDepth: 7,
  candidateCount: 4, replyCount: 3, opponentPlies: 1 };
try {
  for (const [name, fen, preferences] of [
    ['attack-without-maia', attackingBoard.fen(), { trappiness: 0, aggression: 1, tension: 0 }],
    ['tension-without-maia', board.fen(), { trappiness: 0, aggression: 0, tension: 1 }],
    ['combined-with-maia', TRAP_POSITIONS.find((fixture) => fixture.id === 'legal-sound')!.fen,
      { trappiness: 1, aggression: 0.8, tension: 0.7 }],
  ] as const) {
    const settings = { ...base, ...preferences }; const start = Date.now();
    const decision = await engine.chooseMove(fen, settings, true);
    assert.equal(decision.warning, undefined, decision.warning);
    assert.equal(decision.policySource, settings.trappiness ? 'maia' : 'stockfish');
    assert.equal(decision.styleApplied, true);
    assert.ok(playUci(new Chess(fen), decision.move));
    assert.ok(decision.selected.riskCp <= decision.riskLimitCp!);
    assert.ok(decision.riskLimitCp! <= settings.maxRiskCp);
    assert.ok(decision.selected.style);
    for (const candidate of decision.candidates.filter((entry) => entry.style)) {
      assert.ok(candidate.style!.aggressionBonusCp <= settings.aggression * 60 + 1e-8);
      assert.ok(candidate.style!.tensionBonusCp <= settings.tension * 40 + 1e-8);
    }
    if (settings.trappiness) assert.ok(decision.selected.policyCoverage > 0);
    else assert.equal(decision.selected.policyCoverage, 0);
    const elapsedMs = Date.now() - start;
    rows.push({ name, fen, settings, elapsedMs, decision });
    console.log(`PASS ${name}: ${decision.san}, risk ${decision.selected.riskCp}/${decision.riskLimitCp}cp, ${elapsedMs}ms`);
  }
  await mkdir('artifacts/analysis', { recursive: true });
  await writeFile('artifacts/analysis/playing-style-real.json', JSON.stringify({
    purpose: 'Real Stockfish/Maia style integration; not a strength or style calibration benchmark.', rows,
  }, null, 2));
} finally { engine.terminate(); }
