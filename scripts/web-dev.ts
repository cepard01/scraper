import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '@brique/core/config';

// O Next lê `.env` do próprio app; o Brique guarda o `.env` na raiz. Carregar aqui
// e passar por environment mantém uma única fonte de config e permite `pnpm web`.
try { process.loadEnvFile(); } catch { /* .env opcional: systemd/VPS pode injetar tudo */ }
const cfg = loadConfig();

const root = process.cwd();
const webDir = join(root, 'apps', 'web');
const requireFromWeb = createRequire(pathToFileURL(join(webDir, 'package.json')));
const nextBin: string = requireFromWeb.resolve('next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(cfg.webPort)], {
  cwd: webDir,
  env: { ...process.env, PORT: String(cfg.webPort) },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
