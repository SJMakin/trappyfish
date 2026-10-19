import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { TrappyEngine, DEFAULT_ANALYSIS_SETTINGS, playUci, moveToUci,
  type AnalysisEngine, type AnalysisProgress, type OpponentPolicyProvider } from '../src/engine/trappy';
import { parseInfoLine, type AnalysisLine, type AnalysisResult } from '../src/engine/uci';

const start = new Chess();
const after = (fen: string, move: string) => {
  const board = new Chess(fen); assert.ok(playUci(board, move)); return board;
};
const e4 = after(start.fen(), 'e2e4');
const d4 = after(start.fen(), 'd2d4');
const settings = { ...DEFAULT_ANALYSIS_SETTINGS, rootDepth: 5, trapDepth: 4,
  candidateCount: 2, opponentPlies: 1 as const, replyCoverage: 1, replyCount: 2 };
const line = (move: string, cp: number, depth: number, nodes?: number, time?: number, multipv = 1): AnalysisLine =>
  parseInfoLine(`info depth ${depth} seldepth ${depth + 3} multipv ${multipv} score cp ${cp}`
    + (nodes === undefined ? '' : ` nodes ${nodes} nps ${nodes * 100} hashfull ${nodes / 100}`)
    + (time === undefined ? '' : ` time ${time}`) + ` pv ${move}`)!;
const result = (lines: AnalysisLine[], depths?: Map<number, AnalysisLine[]>): AnalysisResult => ({
  bestMove: lines[0].firstMove, lines, linesByDepth: depths ?? new Map([[lines[0].depth, lines]]),
});
const rootLines = [line('e2e4', 40, 4, 90, 8), line('d2d4', 20, 4, 100, 10, 2)];
const root = result(rootLines, new Map([
  [2, [line('e2e4', 20, 2, 10, 2)]],
  [4, rootLines],
  [5, [line('d2d4', 35, 5, 150, 15)]],
]));
const policy: OpponentPolicyProvider = { predict: async (fen) => {
  if (fen === start.fen()) return [{ move: 'e2e4', probability: 0.5 }, { move: 'd2d4', probability: 0.5 }];
  if (fen === e4.fen()) return [{ move: 'e7e5', probability: 0.6 }, { move: 'c7c5', probability: 0.4 }];
  assert.equal(fen, d4.fen()); return [{ move: 'd7d5', probability: 1 }];
} };
let calls = 0;
const uci: AnalysisEngine = { analyzeFen: async (fen, _depth, _multipv, moves = []) => {
  calls++;
  if (fen === start.fen()) return root;
  if (fen === e4.fen()) return result([moves.length
    ? line('c7c5', -300, 3, 300, 30) : line('e7e5', -10, 3, 200, 20)]);
  assert.equal(fen, d4.fen()); return result([line('d7d5', -20, 3, 400, 40)]);
} };
const progress: AnalysisProgress[] = [];
const record = await new TrappyEngine(uci, policy).analyzePosition(start.fen(), settings, (value) => progress.push(value));
const decision = record.decision!;
const diagnostics = decision.diagnostics!;
assert.equal(calls, 4);
assert.equal(diagnostics.stockfishCalls, 4);
assert.equal(diagnostics.policyCalls, 3);
assert.equal(diagnostics.nodes, 150 + 200 + 300 + 400,
  'Count each invocation once; MultiPV and depth counters are cumulative');
assert.equal(diagnostics.searchTimeMs, 15 + 20 + 30 + 40);
assert.equal(diagnostics.maxDepth, 5, 'Include the partial deepest root iteration retained in linesByDepth');
assert.equal(diagnostics.maxSelDepth, 8);
assert.equal(diagnostics.latestNps, 40000);
assert.equal(diagnostics.hashfull, 4);
assert.ok(diagnostics.elapsedMs >= diagnostics.policyTimeMs && diagnostics.policyTimeMs >= 0);
assert.deepEqual(diagnostics.rootTrace, [
  { depth: 2, move: 'e2e4', scoreCp: 20, nodes: 10, timeMs: 2 },
  { depth: 4, move: 'e2e4', scoreCp: 40, nodes: 90, timeMs: 8 },
  { depth: 5, move: 'd2d4', scoreCp: 35, nodes: 150, timeMs: 15 },
]);
const candidate = decision.candidates.find((entry) => entry.move === 'e2e4')!;
assert.equal(candidate.initialScoreCp, 40);
assert.equal(candidate.rootDepth, 4);
assert.equal(candidate.rootScoreCp, 10, 'Defense verification must preserve the original root score separately');
assert.ok(progress.every((entry) => entry.diagnostics));
assert.ok(progress.some((entry) => entry.stage === 'root' && entry.diagnostics?.stockfishCalls === 1),
  'Expose the started call while initial search is running');
assert.equal(progress[0].diagnostics!.stockfishCalls, 0, 'Prior progress snapshots must remain immutable');
assert.equal(progress.at(-1)!.diagnostics!.stockfishCalls, 4);
const traceSnapshot = progress.find((entry) => entry.diagnostics?.rootTrace?.length)?.diagnostics?.rootTrace;
traceSnapshot![0].scoreCp = 12345;
assert.equal(diagnostics.rootTrace![0].scoreCp, 20, 'Snapshots must not share mutable trace points');

// Engines without telemetry still work, and no node/time estimates are fabricated.
const bareEngine: AnalysisEngine = { analyzeFen: async () => result([line('e2e4', 30, 4)]) };
const standard = await new TrappyEngine(bareEngine, policy).chooseMove(start.fen(), settings, false);
assert.equal(standard.diagnostics!.nodes, undefined);
assert.equal(standard.diagnostics!.searchTimeMs, undefined);
assert.equal(standard.diagnostics!.stockfishCalls, 1);
assert.equal(standard.diagnostics!.policyCalls, 0);

// Failed Maia work is included in explicit objective fallback diagnostics.
const failedPolicy: OpponentPolicyProvider = { predict: async () => { throw new Error('Model unavailable'); } };
const fallback = await new TrappyEngine(uci, failedPolicy).analyzePosition(start.fen(), settings);
assert.match(fallback.decision!.warning!, /Model unavailable/);
assert.equal(fallback.decision!.diagnostics!.stockfishCalls, 1);
assert.equal(fallback.decision!.diagnostics!.policyCalls, 1);
assert.equal(fallback.decision!.diagnostics!.nodes, 150);

// Style fallback retries retain both the discarded root work and the second search.
let retryCalls = 0;
const retryEngine: AnalysisEngine = { analyzeFen: async (fen, depth, _multipv, moves = []) => {
  retryCalls++;
  if (fen === start.fen()) return result((moves.length ? moves : ['e2e4'])
    .map((move, index) => line(move, 20, depth, 100, 10, index + 1)));
  return result([line(moveToUci(new Chess(fen).moves({ verbose: true })[0]), -20, depth, 100, 10)]);
} };
const styleFallback = await new TrappyEngine(retryEngine, failedPolicy).analyzePosition(start.fen(), { ...settings, aggression: 0.2 });
assert.match(styleFallback.decision!.warning!, /Model unavailable/);
assert.equal(styleFallback.decision!.diagnostics!.stockfishCalls, retryCalls);
assert.equal(styleFallback.decision!.diagnostics!.nodes, retryCalls * 100);
assert.equal(styleFallback.decision!.diagnostics!.policyCalls, 1);

// A late cancelled invocation must not emit progress or leak counters into a replacement run.
let completeOld!: (value: AnalysisResult) => void;
let waitFirst = true;
const deferred: AnalysisEngine = { analyzeFen: () => {
  if (!waitFirst) return Promise.resolve(result([line('e2e4', 30, 4, 200, 20)]));
  waitFirst = false; return new Promise((resolve) => { completeOld = resolve; });
} };
const cancellable = new TrappyEngine(deferred, policy);
const oldProgress: AnalysisProgress[] = [];
const oldRun = cancellable.chooseMove(start.fen(), settings, false, { onProgress: (entry) => oldProgress.push(entry) });
const cancelled = assert.rejects(oldRun, /cancelled/);
cancellable.cancel();
const oldProgressCount = oldProgress.length;
const replacement = await cancellable.chooseMove(start.fen(), settings, false);
completeOld(result([line('e2e4', 30, 4, 999, 99)]));
await cancelled;
assert.equal(oldProgress.length, oldProgressCount);
assert.equal(replacement.diagnostics!.stockfishCalls, 1);
assert.equal(replacement.diagnostics!.nodes, 200);
console.log('Search telemetry parsing, cumulative counters, root convergence, progress isolation, fallback, and cancellation tests passed.');
