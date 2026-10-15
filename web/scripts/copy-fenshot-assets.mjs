import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(project, 'public/fenshot');
await mkdir(resolve(destination, 'ort'), { recursive: true });
await copyFile(resolve(project, 'node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx'), resolve(destination, 'chess-tiles-v2.onnx'));
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(resolve(project, 'node_modules/onnxruntime-web/dist', file), resolve(destination, 'ort', file));
}
await copyFile(resolve(project, 'node_modules/@scoriiu/fenshot/LICENSE'), resolve(destination, 'FENSHOT-LICENSE'));
console.log('Copied local fenshot model and ONNX runtime assets.');
