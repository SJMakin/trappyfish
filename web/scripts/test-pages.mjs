import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pagesBasePath } from './pages-path.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = pagesBasePath();
const url = `http://127.0.0.1:5180${base}`;
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'preview', '--host', '127.0.0.1', '--port', '5180', '--strictPort', '--base', base], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
let serverError;
server.on('error', (error) => { serverError = error; });
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });
try {
  const deadline = Date.now() + 30000;
  while (true) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error(`Preview exited: ${output}`);
    try { if ((await fetch(url)).ok) break; } catch { /* Wait for the local preview to start. */ }
    if (Date.now() > deadline) throw new Error(`Preview did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const test = spawn(process.execPath, [fileURLToPath(new URL('./test-analysis-built.mjs', import.meta.url))], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, TRAPPY_TEST_URL: url },
  });
  const code = await new Promise((resolve, reject) => { test.on('error', reject); test.on('exit', resolve); });
  if (code !== 0) throw new Error(`Pages browser check failed (${code}).`);
} finally {
  server.kill();
}
