import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'http://127.0.0.1:5174';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; let failure;
server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
server.on('error', error => { failure = error; });
try {
  const deadline = Date.now() + 30_000;
  while (true) {
    if (failure) throw failure;
    if (server.exitCode !== null) throw new Error(`Play test server exited: ${output}`);
    try { if ((await fetch(url)).ok) break; } catch { /* Wait for the owned server. */ }
    if (Date.now() > deadline) throw new Error(`Play test server did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  for (const script of ['test-play-experience.mjs', 'test-openings-browser.mjs', 'test-trap-browser.mjs', 'test-local-books-browser.mjs', 'test-plan-privacy.mjs']) {
    const test = spawn(process.execPath, [`scripts/${script}`], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TRAPPY_TEST_URL: url } });
    const code = await new Promise((resolve, reject) => { test.on('error', reject); test.on('exit', resolve); });
    if (code !== 0) throw new Error(`${script} failed (${code}).`);
  }
} finally { server.kill(); }
