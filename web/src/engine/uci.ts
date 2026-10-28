export type EngineScore = { type: 'cp' | 'mate'; raw: number; cp: number };
/** Stockfish's WDL model, in the side-to-move perspective of the searched FEN. */
export type Wdl = { win: number; draw: number; loss: number };
export type AnalysisLine = {
  depth: number; multipv: number; score: EngineScore; pv: string[]; firstMove: string; raw: string;
  nodes?: number; nps?: number; timeMs?: number; seldepth?: number; hashfull?: number; tbhits?: number;
  wdl?: Wdl;
};
export type AnalysisResult = {
  bestMove: string; ponder?: string; lines: AnalysisLine[]; linesByDepth: Map<number, AnalysisLine[]>;
};
export interface AnalysisEngine {
  analyzeFen(fen: string, depth: number, multipv?: number, searchMoves?: string[]): Promise<AnalysisResult>;
  cancel?(): void;
  terminate?(): void;
}
type LineListener = (line: string) => void;
const STOCKFISH_ENGINE_PATH = `${import.meta.env?.BASE_URL ?? '/'}stockfish/stockfish-18-lite-single.js`;
const MATE_SCORE_CP = 100_000;

/** Stockfish supplies objective scores; human reply weighting lives in the host. */
export class UciClient implements AnalysisEngine {
  private worker: Worker | null = null;
  private listeners = new Set<LineListener>();
  private pending = new Set<(error: Error) => void>();
  private initPromise: Promise<void> | null = null;
  private queue = Promise.resolve();
  private generation = 0;

  constructor(private readonly enginePath = STOCKFISH_ENGINE_PATH) {}

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    const generation = this.generation;
    const worker = new Worker(this.enginePath);
    this.worker = worker;
    worker.addEventListener('message', (event) => {
      if (worker !== this.worker) return;
      for (const line of String(event.data ?? '').split(/\r?\n/)) {
        if (line.trim()) for (const listener of [...this.listeners]) listener(line.trim());
      }
    });
    worker.addEventListener('error', (event) => {
      if (worker === this.worker) this.fail(new Error('Stockfish failed to load: ' + (event.message || this.enginePath)));
    });
    worker.addEventListener('messageerror', () => {
      if (worker === this.worker) this.fail(new Error('Stockfish returned an unreadable message.'));
    });
    this.initPromise = (async () => {
      const handshake = this.waitFor((line) => line === 'uciok', 30_000);
      this.post('uci');
      await handshake;
      this.assertGeneration(generation);
      this.post('setoption name UCI_ShowWDL value true');
      // Older custom binaries must also produce objective scores when explicitly selected.
      if (this.enginePath.includes('trappyfish')) this.post('setoption name Trappyfish value false');
      await this.isReady();
      this.assertGeneration(generation);
    })();
    return this.initPromise;
  }

  async analyzeFen(fen: string, depth: number, multipv = 1, searchMoves: string[] = []): Promise<AnalysisResult> {
    if (!Number.isInteger(depth) || depth < 1 || depth > 30) throw new Error('Invalid Stockfish depth.');
    if (!Number.isInteger(multipv) || multipv < 1) throw new Error('Invalid Stockfish line count.');
    if (/[\r\n]/.test(fen) || searchMoves.some((move) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) {
      throw new Error('Invalid Stockfish position or move.');
    }
    const generation = this.generation;
    return this.enqueue(async () => {
      this.assertGeneration(generation);
      await this.init();
      this.assertGeneration(generation);
      this.post('setoption name MultiPV value ' + multipv);
      this.post('setoption name Clear Hash');
      await this.isReady();
      this.assertGeneration(generation);
      this.post('position fen ' + fen);
      return new Promise<AnalysisResult>((resolve, reject) => {
        const linesByDepth = new Map<number, Map<number, AnalysisLine>>();
        const cleanup = () => {
          clearTimeout(timeout);
          this.listeners.delete(onLine);
          this.pending.delete(onError);
        };
        const onError = (error: Error) => { cleanup(); reject(error); };
        const timeout = setTimeout(() => this.fail(new Error('Stockfish timed out at depth ' + depth + '.')),
          Math.max(30_000, depth * multipv * 5_000));
        const onLine: LineListener = (line) => {
          const parsed = parseInfoLine(line);
          if (parsed) {
            const depthLines = linesByDepth.get(parsed.depth) ?? new Map<number, AnalysisLine>();
            depthLines.set(parsed.multipv, parsed);
            linesByDepth.set(parsed.depth, depthLines);
          } else if (line.startsWith('bestmove ')) {
            const parts = line.split(/\s+/);
            const ponderIndex = parts.indexOf('ponder');
            cleanup();
            resolve({ bestMove: parts[1] ?? '', ponder: ponderIndex >= 0 ? parts[ponderIndex + 1] : undefined,
              lines: latestLines(linesByDepth), linesByDepth: freezeDepthMap(linesByDepth) });
          }
        };
        this.listeners.add(onLine);
        this.pending.add(onError);
        this.post('go depth ' + depth + (searchMoves.length ? ' searchmoves ' + searchMoves.join(' ') : ''));
      });
    });
  }

  cancel(): void { this.fail(new Error('Engine search cancelled.')); }
  terminate(): void { this.cancel(); }

  private fail(error: Error): void {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    for (const reject of [...this.pending]) reject(error);
    this.pending.clear();
    this.listeners.clear();
    this.queue = Promise.resolve();
  }
  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new Error('Engine search cancelled.');
  }
  private async isReady(): Promise<void> {
    const ready = this.waitFor((line) => line === 'readyok', 15_000);
    this.post('isready');
    await ready;
  }
  private waitFor(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.listeners.delete(onLine);
        this.pending.delete(onError);
      };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const timeout = setTimeout(() => this.fail(new Error('Timed out waiting for Stockfish.')), timeoutMs);
      const onLine: LineListener = (line) => {
        if (predicate(line)) { cleanup(); resolve(line); }
      };
      this.listeners.add(onLine);
      this.pending.add(onError);
    });
  }
  private post(command: string): void { this.worker?.postMessage(command); }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

export function parseInfoLine(line: string): AnalysisLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ') || /\b(lowerbound|upperbound)\b/.test(line)) return null;
  const depthMatch = line.match(/\bdepth\s+(\d+)/);
  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  if (!depthMatch || !scoreMatch || !pvMatch) return null;
  const pv = pvMatch[1].trim().split(/\s+/).filter(Boolean);
  if (!pv.length) return null;
  const type = scoreMatch[1] as EngineScore['type'];
  const raw = Number(scoreMatch[2]);
  const cp = type === 'cp' ? raw : Math.sign(raw || 1) * (MATE_SCORE_CP - Math.min(Math.abs(raw), 99) * 100);
  return { depth: Number(depthMatch[1]), multipv: Number(line.match(/\bmultipv\s+(\d+)/)?.[1] ?? 1),
    score: { type, raw, cp }, pv, firstMove: pv[0], raw: line,
    nodes: infoInteger(line, 'nodes'), nps: infoInteger(line, 'nps'), timeMs: infoInteger(line, 'time'),
    seldepth: infoInteger(line, 'seldepth'), hashfull: infoInteger(line, 'hashfull'), tbhits: infoInteger(line, 'tbhits'),
    wdl: parseWdl(line) };
}

function parseWdl(line: string): Wdl | undefined {
  // UCI reports integer per-mille counts summing to 1000. Reject partial,
  // negative, fractional or malformed triples rather than inventing a model.
  const metadata = line.slice(0, line.indexOf(' pv '));
  if ((metadata.match(/\bwdl\b/g) ?? []).length !== 1) return undefined;
  const match = metadata.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)(?=\s+(?:[a-z]|$)|$)/);
  if (!match) return undefined;
  const [win, draw, loss] = match.slice(1).map(Number);
  if (![win, draw, loss].every(Number.isSafeInteger) || win + draw + loss !== 1000) return undefined;
  return { win: win / 1000, draw: draw / 1000, loss: loss / 1000 };
}

function infoInteger(line: string, token: string): number | undefined {
  const match = line.match(new RegExp(`\\b${token}\\s+(\\d+)\\b`));
  return match ? Number(match[1]) : undefined;
}

function latestLines(linesByDepth: Map<number, Map<number, AnalysisLine>>): AnalysisLine[] {
  let complete: AnalysisLine[] = [];
  for (const depth of [...linesByDepth.keys()].sort((a, b) => a - b)) {
    const lines = [...linesByDepth.get(depth)!.values()].sort((a, b) => a.multipv - b.multipv);
    if (lines.length >= complete.length) complete = lines;
  }
  return complete;
}
function freezeDepthMap(linesByDepth: Map<number, Map<number, AnalysisLine>>): Map<number, AnalysisLine[]> {
  return new Map([...linesByDepth].map(([depth, lines]) =>
    [depth, [...lines.values()].sort((a, b) => a.multipv - b.multipv)]));
}
