import { MaiaPolicyCache, maiaCacheKey, maiaRating } from './maiaEncoding';
import type { OpponentPolicyProvider, OpponentReply } from './maiaEncoding';

export type { OpponentPolicyProvider, OpponentReply } from './maiaEncoding';

type Pending = {
  resolve: (replies: OpponentReply[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Genuine Maia-3 inference in its own worker; failures never become synthetic
 * human probabilities. The first prediction lazily loads the local model.
 */
export class MaiaClient implements OpponentPolicyProvider {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private cache = new MaiaPolicyCache();
  private inflight = new Map<string, Promise<OpponentReply[]>>();
  private nextId = 1;

  constructor(private readonly workerFactory = () => new Worker(new URL('./maia.worker.ts', import.meta.url), { type: 'module' })) {}

  async predict(fen: string, opponentRating: number, engineRating: number): Promise<OpponentReply[]> {
    const key = maiaCacheKey(fen, opponentRating, engineRating);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const existing = this.inflight.get(key);
    if (existing) return (await existing).map((reply) => ({ ...reply }));
    const promise = this.request(fen, maiaRating(opponentRating), maiaRating(engineRating));
    this.inflight.set(key, promise);
    try {
      const replies = await promise;
      this.cache.set(key, replies);
      return replies.map((reply) => ({ ...reply }));
    } finally {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    }
  }

  terminate(): void {
    this.failAll(new Error('Maia analysis was stopped.'));
    this.cache.clear();
  }

  private request(fen: string, opponentRating: number, engineRating: number): Promise<OpponentReply[]> {
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.worker.onmessage = (event: MessageEvent<{ id: number; replies?: OpponentReply[]; error?: string }>) => {
        const pending = this.pending.get(event.data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(event.data.id);
        if (event.data.error) pending.reject(new Error(event.data.error));
        else if (event.data.replies) pending.resolve(event.data.replies);
        else pending.reject(new Error('Maia returned an invalid worker response.'));
      };
      this.worker.onerror = (event) => this.failAll(new Error(`Maia worker failed: ${event.message || 'could not initialize the model'}`));
      this.worker.onmessageerror = () => this.failAll(new Error('Could not read the Maia worker response.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.failAll(new Error('Maia inference timed out. Please reload and try again.')), 90_000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, fen, opponentRating, engineRating });
    });
  }

  private failAll(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.inflight.clear();
  }
}
