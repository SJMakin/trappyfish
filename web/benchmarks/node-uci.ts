import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { parseInfoLine, type AnalysisLine, type AnalysisResult, type UciClient } from '../src/engine/uci';

/** The same Stockfish 18 lite WASM as the app, driven over a real UCI subprocess. */
export class NodeUci {
  private process: ChildProcessWithoutNullStreams;
  private listeners = new Set<(line: string) => void>();
  private queue = Promise.resolve();
  private ready: Promise<void>;
  analyses = 0;

  constructor() {
    this.process = spawn(process.execPath, [resolve('node_modules/stockfish/bin/stockfish-18-lite-single.js')], { windowsHide: true });
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      for (const listener of this.listeners) listener(line.trim());
    });
    this.process.stderr.on('data', (chunk) => process.stderr.write(chunk));
    this.ready = (async () => {
      await this.commandUntil('uci', (line) => line === 'uciok');
      this.post('setoption name Hash value 32');
      this.post('setoption name UCI_ShowWDL value false');
      await this.commandUntil('isready', (line) => line === 'readyok');
    })();
  }

  asClient(): UciClient { return this as unknown as UciClient; }

  async analyzeFen(fen: string, depth: number, multipv = 1, searchMoves: string[] = []): Promise<AnalysisResult> {
    const task = this.queue.then(async () => {
      await this.ready;
      this.analyses++;
      // Clearing the transposition table makes forced outcomes independent of algorithm/search order.
      this.post('setoption name Clear Hash');
      this.post(`setoption name MultiPV value ${multipv}`);
      await this.commandUntil('isready', (line) => line === 'readyok');
      this.post(`position fen ${fen}`);
      const linesByDepth = new Map<number, Map<number, AnalysisLine>>();
      let bestMove = '';
      let ponder: string | undefined;
      await this.commandUntil(`go depth ${depth}${searchMoves.length ? ` searchmoves ${searchMoves.join(' ')}` : ''}`, (line) => {
        const parsed = parseInfoLine(line);
        if (parsed) {
          const atDepth = linesByDepth.get(parsed.depth) ?? new Map<number, AnalysisLine>();
          atDepth.set(parsed.multipv, parsed);
          linesByDepth.set(parsed.depth, atDepth);
        }
        if (!line.startsWith('bestmove ')) return false;
        const tokens = line.split(/\s+/);
        bestMove = tokens[1] ?? '';
        const ponderAt = tokens.indexOf('ponder');
        if (ponderAt >= 0) ponder = tokens[ponderAt + 1];
        return true;
      }, 120_000);
      const frozen = new Map([...linesByDepth].map(([d, lines]) => [d, [...lines.values()].sort((a,b) => a.multipv-b.multipv)]));
      const lastDepth = Math.max(...frozen.keys());
      return { bestMove, ponder, lines: frozen.get(lastDepth) ?? [], linesByDepth: frozen };
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  terminate(): void {
    this.post('quit');
    this.process.kill();
  }

  private post(command: string) { this.process.stdin.write(`${command}\n`); }

  private commandUntil(command: string, predicate: (line: string) => boolean, timeoutMs = 20_000): Promise<void> {
    return new Promise((resolveTask, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`UCI timeout: ${command}`)); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(listener); };
      const listener = (line: string) => { if (predicate(line)) { cleanup(); resolveTask(); } };
      this.listeners.add(listener);
      this.post(command);
    });
  }
}
