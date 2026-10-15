import { inferScreenshotTurn, screenshotFen } from './position';
import type { Recognizer } from '@scoriiu/fenshot';

let recognizerPromise: Promise<{ recognizer: Recognizer; resolveOrientation: typeof import('@scoriiu/fenshot').resolveOrientation }> | null = null;

function loadRecognizer() {
  if (!recognizerPromise) {
    recognizerPromise = import('@scoriiu/fenshot').then(({ createRecognizer, resolveOrientation }) => {
      const base = new URL(`${import.meta.env.BASE_URL}fenshot/`, window.location.origin);
      return {
        recognizer: createRecognizer({
          modelUrl: new URL('chess-tiles-v2.onnx', base).href,
          wasmPaths: {
            mjs: new URL('ort/ort-wasm-simd-threaded.mjs', base).href,
            wasm: new URL('ort/ort-wasm-simd-threaded.wasm', base).href,
          },
        }),
        resolveOrientation,
      };
    }).catch((error) => {
      recognizerPromise = null;
      throw error;
    });
  }
  return recognizerPromise;
}

export async function recognizeScreenshot(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file or paste a screenshot.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a screenshot smaller than 25 MB.');
  const { recognizer, resolveOrientation } = await loadRecognizer();
  const result = await recognizer.recognize(file);
  if (!result) throw new Error('No chessboard found. Try a clear screenshot with the whole board visible.');
  const { placement, orientation } = resolveOrientation(result.placement);
  const { turn, source: turnSource } = inferScreenshotTurn(placement, orientation);
  return {
    fen: screenshotFen(placement, turn),
    turnSource,
    reliable: result.reliable,
    minConfidence: result.minConfidence,
    meanConfidence: result.meanConfidence,
    orientation,
  };
}
