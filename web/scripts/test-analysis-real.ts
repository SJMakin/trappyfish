import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
import { TrappyEngine, DEFAULT_ANALYSIS_SETTINGS } from '../src/engine/trappy';
import { deriveCandidateLines, variationToPgn } from '../src/engine/analysisLines';
import { TRAP_POSITIONS } from '../benchmarks/trap-positions';
import { NodeUci } from '../benchmarks/node-uci';
import { NodeMaiaPolicy } from './maia-node';

const uci = new NodeUci();
const policy = new NodeMaiaPolicy();
const engine = new TrappyEngine(uci.asClient(), policy);
const quick = { ...DEFAULT_ANALYSIS_SETTINGS, rootDepth: 10, trapDepth: 8, candidateCount: 8,
  replyCount: 8, opponentPlies: 1 as const };
const rows: unknown[] = [];
try {
  for (const [id, settings, label] of [
    ['legal-sound', quick, 'quick'], ['legal-sound', DEFAULT_ANALYSIS_SETTINGS, 'deep'],
    ['elephant', quick, 'black-quick'],
  ] as const) {
    const fixture = TRAP_POSITIONS.find((value) => value.id === id)!;
    const board = new Chess(fixture.fen);
    const originalFen = board.fen();
    const start = Date.now();
    const result = await engine.analyzePosition(originalFen, settings, (progress) => {
      if (progress.stage !== 'replies') console.log(`${label}: ${progress.stage} ${progress.completed}/${progress.total}`);
    });
    assert.equal(board.fen(), originalFen, 'Analysis must preserve the uploaded position');
    assert.equal(result.fen, originalFen);
    assert.ok(result.decision && result.decision.policySource === 'maia', result.decision?.warning);
    const decision = result.decision;
    assert.ok(decision.candidates.length >= settings.candidateCount);
    assert.equal(decision.candidates[0].status, 'evaluated');
    for (const candidate of decision.candidates) {
      assert.ok(candidate.analyzed, `${candidate.san} must include human-reply analysis, including rejected moves`);
      assert.ok(candidate.expectedScore >= 0 && candidate.expectedScore <= 1);
      const lines = deriveCandidateLines(originalFen, candidate);
      assert.ok(lines.length, `${candidate.san} must include a replayable line`);
      for (const line of lines) {
        assert.ok(line.complete, `Invalid continuation: ${line.moves.join(' ')}`);
        const exported = variationToPgn(originalFen, line.moves);
        const imported = new Chess();
        imported.loadPgn(exported);
        assert.equal(imported.fen(), line.steps.at(-1)!.fen);
      }
    }
    if (id === 'legal-sound') {
      const bait = decision.candidates.find((candidate) => candidate.move === 'f3e5');
      assert.ok(bait, 'The queen-bait candidate must be discoverable');
      const mate = deriveCandidateLines(originalFen, bait).find((line) => line.moves[1] === 'h5d1');
      assert.ok(mate && mate.san.at(-1)?.endsWith('#'), 'The tempting queen capture must show its mating punishment');
      assert.ok(mate.targets.some((target) => target.type === 'bait' && target.piece === 'q' && target.square === 'd1'));
      assert.ok(mate.targets.some((target) => target.type === 'mate' && target.piece === 'k' && target.square === 'e7'));
    }
    const elapsedMs = Date.now() - start;
    rows.push({ label, originalFen, settings, elapsedMs, result });
    console.log(`${label}: ${decision.selected.san}, ${decision.candidates.length} scored moves, ${elapsedMs}ms`);
  }
  await mkdir('artifacts/analysis', { recursive: true });
  await writeFile('artifacts/analysis/real-analysis.json', JSON.stringify({ purpose: 'Real Maia/Stockfish position-analysis integration checks', rows }, null, 2));
  console.log('Real Quick/Deep position analysis passed: White/Black perspective, preserved roots, full candidate analysis, legal trap/defense lines, targets and PGN round-trips.');
} finally {
  uci.terminate();
  await policy.terminate();
}
