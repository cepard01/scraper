import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '@brique/core/config';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, loadSettings } from '@brique/core/db/client-helpers';
import { createHttpPost } from '@brique/scrapers/http';
import { createWorkerAi } from '../packages/worker/src/ai';

/** Gate manual: uma chamada real ao gateway do operador, sem imprimir segredos. */
export async function main(argv: string[] = process.argv): Promise<void> {
  try { process.loadEnvFile(); } catch { /* systemd já trouxe o ambiente */ }
  const cfg = loadConfig();
  if (cfg.omniRoute.apiKey === null) {
    console.error('OMNIROUTE_API_KEY ausente — smoke de IA não executado.');
    process.exitCode = 1;
    return;
  }

  const title = argv[2]?.trim() || 'iPhone 12 128GB Desbloqueado';
  const askingCents = Number(argv[3] ?? '250000');
  if (!Number.isInteger(askingCents) || askingCents <= 0) {
    console.error('preço inválido: use um valor inteiro em centavos.');
    process.exitCode = 1;
    return;
  }

  const { db } = openDb(cfg.sqlitePath);
  migrateDb(db);
  seedSettings(db, DEFAULT_SETTINGS);
  const settings = loadSettings(db);
  const post = createHttpPost({ timeoutMs: 20_000, maxAttempts: 2 });
  const { ai } = createWorkerAi({
    db, settings, post, omniRoute: cfg.omniRoute,
  });

  const externalId = `smoke-${Date.now()}`;
  const result = await ai.triage([{
    listingId: 1, externalId, title, askingCents,
    description: 'anúncio usado apenas no smoke', city: null,
  }]);
  const verdict = result.get(1);
  const calls = ai.calls;
  const hits = (ai as { cacheHits?: number }).cacheHits ?? 0;

  console.log(`título: ${title}`);
  console.log(`veredito: ${verdict?.verdict ?? 'sem-resposta'}`);
  if (verdict?.reasons.length) console.log(`motivos: ${verdict.reasons.join('; ')}`);
  console.log(`chamadas=${calls} cache-hits=${hits} pausado=${(ai as { paused?: boolean }).paused ?? 'n/d'}`);

  if (verdict?.verdict !== 'pass' && verdict?.verdict !== 'veto') {
    console.error('sem opinião do gateway verifique orçamento, circuito e resposta JSON.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
