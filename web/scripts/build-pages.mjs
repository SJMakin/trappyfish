import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pagesBasePath } from './pages-path.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'build', '--base', pagesBasePath()], {
  cwd: root, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
