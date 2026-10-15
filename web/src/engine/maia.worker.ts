import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { encodeMaiaBoard, legalMaiaPolicy, maiaRating, MAIA_TOKEN_WIDTH } from './maiaEncoding';

// One WASM thread works without cross-origin isolation and keeps the UI thread free.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };

let session: Promise<ort.InferenceSession> | null = null;
let queue = Promise.resolve();
const modelUrl = `${import.meta.env.BASE_URL}maia/maia3-5m.onnx`;

function loadSession(): Promise<ort.InferenceSession> {
  if (!session) {
    session = ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      .catch((error) => {
        session = null;
        throw new Error(`Could not load the Maia-3 model. ${String(error)}`);
      });
  }
  return session;
}

type Request = { id: number; fen: string; opponentRating: number; engineRating: number };

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  const run = async () => {
    const inputs: Record<string, ort.Tensor> = {};
    let outputs: ort.InferenceSession.ReturnType | undefined;
    try {
      // The mover is the modeled opponent; self_elo must be that player's rating.
      inputs.tokens = new ort.Tensor('float32', encodeMaiaBoard(request.fen), [1, 64, MAIA_TOKEN_WIDTH]);
      inputs.self_elo = new ort.Tensor('int64', BigInt64Array.of(BigInt(maiaRating(request.opponentRating))), [1]);
      inputs.oppo_elo = new ort.Tensor('int64', BigInt64Array.of(BigInt(maiaRating(request.engineRating))), [1]);
      outputs = await (await loadSession()).run(inputs);
      const logits = outputs.logits_move;
      if (!logits || logits.type !== 'float32') throw new Error('Maia returned an unexpected policy tensor.');
      const replies = legalMaiaPolicy(request.fen, logits.data as Float32Array);
      self.postMessage({ id: request.id, replies });
    } catch (error) {
      self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      for (const tensor of Object.values(inputs)) tensor.dispose();
      if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
    }
  };
  queue = queue.then(run, run);
};
