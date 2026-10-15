import * as ort from 'onnxruntime-node';
import { fileURLToPath } from 'node:url';
import { encodeMaiaBoard, legalMaiaPolicy, maiaCacheKey, MaiaPolicyCache, maiaRating, MAIA_TOKEN_WIDTH } from '../src/engine/maiaEncoding';
import type { OpponentPolicyProvider, OpponentReply } from '../src/engine/maiaEncoding';

/** Node benchmark adapter sharing precisely the browser encoding and legal mask. */
export class NodeMaiaPolicy implements OpponentPolicyProvider {
  private session: Promise<ort.InferenceSession> | null = null;
  private cache = new MaiaPolicyCache();
  private queue = Promise.resolve();

  constructor(private readonly modelPath = fileURLToPath(new URL('../public/maia/maia3-5m.onnx', import.meta.url))) {}

  async predict(fen: string, opponentRating: number, engineRating: number): Promise<OpponentReply[]> {
    const key = maiaCacheKey(fen, opponentRating, engineRating);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const run = async () => {
      const cachedAfterWait = this.cache.get(key);
      if (cachedAfterWait) return cachedAfterWait;
      this.session ??= ort.InferenceSession.create(this.modelPath, { executionProviders: ['cpu'], intraOpNumThreads: 1 });
      const session = await this.session;
      const inputs = {
        tokens: new ort.Tensor('float32', encodeMaiaBoard(fen), [1, 64, MAIA_TOKEN_WIDTH]),
        self_elo: new ort.Tensor('int64', BigInt64Array.of(BigInt(maiaRating(opponentRating))), [1]),
        oppo_elo: new ort.Tensor('int64', BigInt64Array.of(BigInt(maiaRating(engineRating))), [1]),
      };
      let outputs: ort.InferenceSession.ReturnType | undefined;
      try {
        outputs = await session.run(inputs);
        const replies = legalMaiaPolicy(fen, outputs.logits_move.data as Float32Array);
        this.cache.set(key, replies);
        return replies;
      } finally {
        for (const tensor of Object.values(inputs)) tensor.dispose();
        if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
      }
    };
    const promise = this.queue.then(run, run);
    this.queue = promise.then(() => {}, () => {});
    return promise;
  }

  async terminate(): Promise<void> {
    await this.queue;
    if (this.session) await (await this.session).release();
    this.session = null;
    this.cache.clear();
  }
}
