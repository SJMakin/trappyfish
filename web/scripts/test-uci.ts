import assert from 'node:assert/strict';
import { UciClient, parseInfoLine } from '../src/engine/uci';

type Handler = (event: any) => void;
class FakeWorker {
  static instances: FakeWorker[] = [];
  static complete = true;
  handlers = new Map<string, Handler[]>();
  commands: string[] = [];
  terminated = false;
  constructor(readonly path: string) { FakeWorker.instances.push(this); }
  addEventListener(name: string, handler: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }
  emit(name: string, event: any) { for (const handler of this.handlers.get(name) ?? []) handler(event); }
  postMessage(command: string) {
    this.commands.push(command);
    // Synchronous responses catch listeners registered after command dispatch.
    if (command === 'uci') this.emit('message', { data: 'uciok' });
    if (command === 'isready') this.emit('message', { data: 'readyok' });
    if (command.startsWith('go ') && FakeWorker.complete) {
      this.emit('message', { data: 'info depth 6 multipv 1 score cp 32 pv e2e4 e7e5\ninfo depth 6 multipv 2 score cp 21 pv d2d4 d7d5' });
      this.emit('message', { data: 'info depth 7 multipv 1 score cp 45 lowerbound pv e2e4 e7e5' });
      this.emit('message', { data: 'info depth 7 multipv 1 score cp 34 pv e2e4 e7e5' });
      this.emit('message', { data: 'bestmove e2e4 ponder e7e5' });
    }
  }
  terminate() { this.terminated = true; }
}
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

assert.equal(parseInfoLine('info depth 8 score cp 43 lowerbound pv e2e4'), null);
assert.equal(parseInfoLine('info depth 8 score cp 43 upperbound pv e2e4'), null);
assert.equal(parseInfoLine('info depth 8 score mate -2 pv a1a2')!.score.cp, -99_800);
assert.equal(parseInfoLine('info depth 8 score mate 1 pv a1a2')!.score.cp, 99_900);
assert.equal(parseInfoLine('info string hello'), null);
assert.deepEqual(parseInfoLine('info depth 8 score cp 43 wdl 200 700 100 pv e2e4')!.wdl,
  { win: 0.2, draw: 0.7, loss: 0.1 });
assert.deepEqual(parseInfoLine('info depth 8 score cp -43 wdl 0 0 1000 nodes 10 pv e2e4')!.wdl,
  { win: 0, draw: 0, loss: 1 });
for (const invalid of ['-1 901 100', '100 800 99', '100.5 800 99.5', '1e2 800 100', '100 800',
  '100 800 100 50', '100 1000 100', 'NaN 800 100', '100 800 100 wdl 200 700 100']) {
  assert.equal(parseInfoLine(`info depth 8 score cp 43 wdl ${invalid} pv e2e4`)!.wdl, undefined,
    `Malformed WDL must stay unavailable: ${invalid}`);
}
assert.equal(parseInfoLine('info depth 8 score cp 43 pv e2e4')!.wdl, undefined);
assert.equal(parseInfoLine('info depth 8 score cp 43 pv e2e4 wdl 100 800 100')!.wdl, undefined);
const counters = parseInfoLine('info depth 18 seldepth 31 multipv 2 score cp -43 nodes 1234567 nps 987654 hashfull 12 tbhits 7 time 1250 pv e2e4 e7e5')!;
assert.deepEqual({ nodes: counters.nodes, nps: counters.nps, timeMs: counters.timeMs,
  seldepth: counters.seldepth, hashfull: counters.hashfull, tbhits: counters.tbhits },
{ nodes: 1234567, nps: 987654, timeMs: 1250, seldepth: 31, hashfull: 12, tbhits: 7 });
const noCounters = parseInfoLine('info depth 8 score cp 43 pv e2e4')!;
assert.equal(noCounters.nodes, undefined, 'Unreported engine counters must stay absent');
assert.equal(noCounters.timeMs, undefined);
assert.equal(parseInfoLine('info depth 8 score cp 43 nodes 0 nps 0 hashfull 0 tbhits 0 time 0 pv e2e4')!.nodes, 0);

const engine = new UciClient('/stockfish/trappyfish-lite-single.js');
const result = await engine.analyzeFen(fen, 7, 2);
assert.equal(result.bestMove, 'e2e4');
assert.equal(result.ponder, 'e7e5');
assert.equal(result.lines.length, 2, 'retain the last complete MultiPV iteration');
assert.equal(result.lines[0].depth, 6);
const first = FakeWorker.instances[0];
assert.ok(first.commands.includes('setoption name Trappyfish value false'));
assert.ok(first.commands.includes('setoption name UCI_ShowWDL value true'));
assert.ok(first.commands.includes('setoption name Clear Hash'));
await assert.rejects(engine.analyzeFen(fen + '\nquit', 7), /Invalid/);
await assert.rejects(engine.analyzeFen(fen, 7, 1, ['e2e4\nquit']), /Invalid/);

FakeWorker.complete = false;
const active = engine.analyzeFen(fen, 7);
const queued = engine.analyzeFen(fen, 7);
const settled = Promise.allSettled([active, queued]);
await new Promise((resolve) => setTimeout(resolve, 0));
engine.cancel();
const cancellation = await settled;
assert.ok(cancellation.every((row) => row.status === 'rejected' && /cancelled/.test(String(row.reason))));
assert.ok(first.terminated);

FakeWorker.complete = true;
assert.equal((await engine.analyzeFen(fen, 7)).bestMove, 'e2e4');
assert.equal(FakeWorker.instances.length, 2, 'cancelled work must start a fresh worker');
FakeWorker.complete = false;
const crashed = engine.analyzeFen(fen, 7);
const crashedCheck = assert.rejects(crashed, /failed to load/);
await new Promise((resolve) => setTimeout(resolve, 0));
FakeWorker.instances.at(-1)!.emit('error', { message: 'test crash' });
await crashedCheck;
FakeWorker.complete = true;
assert.equal((await engine.analyzeFen(fen, 7)).bestMove, 'e2e4');
engine.terminate();
console.log('UCI perspective parsing, complete MultiPV, objective custom-binary mode, cancellation, queue recovery, and worker failure tests passed.');
