import { loadConfig } from '@brique/core/config';
import { openDb, migrateDb, loadSettings, seedSettings, DEFAULT_SETTINGS } from '@brique/core/db/client-helpers';
import { nullAiPort } from '@brique/core/ai-port';
import { localAskingProvider } from '@brique/core/valuation/comparables';
import { startScheduler, type SchedulerDeps } from '@brique/core/scheduler';
import { listDue } from '@brique/core/db/repo/monitors';
import { listShortlistedRanked } from '@brique/core/db/repo/opportunities';
import { nullNotifier } from '@brique/core/notify-port';
import type { SourceAdapter } from '@brique/core/adapter-contract';
import type { SourceId } from '@brique/core/types';
import { createHttp, createHttpPost } from '@brique/scrapers/http';
import { createOlxAdapter } from '@brique/scrapers/olx/adapter';
import { createMeliAdapter } from '@brique/scrapers/meli/adapter';
import { printShortlist } from './cli';
import { createNtfy } from './notify-ntfy';

try { process.loadEnvFile(); } catch { /* em VPS o EnvironmentFile do systemd já trouxe tudo */ }

const cfg = loadConfig();
const { db } = openDb(cfg.sqlitePath);
migrateDb(db);
seedSettings(db, DEFAULT_SETTINGS);
const settings = loadSettings(db);

const http = createHttp({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  timeoutMs: 30_000,
  jitterMs: [1_500, 4_000],
  maxAttempts: 3,
});

const olx = createOlxAdapter({ http });
const meli = createMeliAdapter({ http, token: cfg.meliToken, unit: cfg.meliUnit });

const adapters: Partial<Record<SourceId, SourceAdapter>> = { olx };
if (meli.available) adapters.meli = meli;

// ntfy é o único transporte. Sem tópico o worker segue rodando e a entrega é
// registrada como failed — nunca como sucesso fingido.
const post = createHttpPost({ timeoutMs: 10_000, maxAttempts: 2 });
const notifierOn = cfg.ntfy.topic !== null;
const notify = notifierOn
  ? createNtfy({ post, baseUrl: cfg.ntfy.baseUrl, topic: cfg.ntfy.topic })
  : nullNotifier();

const deps: SchedulerDeps = {
  db, settings, adapters, ai: nullAiPort(), comparables: localAskingProvider,
  notify, alertChannel: notifierOn ? 'ntfy' : undefined, now: () => new Date(),
};

console.log(`worker ok · sqlite=${cfg.sqlitePath} · fontes=${Object.keys(adapters).join(', ')} · notifier=${notifierOn ? 'ntfy' : 'off'}`);
console.log(`monitores due agora: ${listDue(db, new Date()).length}`);

const handle = startScheduler(deps, 60_000, (summaries) => {
  const avaliados = summaries.reduce((n, s) => n + s.created + s.repriced, 0);
  const alertas = summaries.reduce((n, s) => n + s.alerts, 0);
  if (avaliados === 0 && alertas === 0) return;
  console.log(`ciclo: novos/reprecificados=${avaliados} alertas=${alertas}`);
  if (avaliados > 0) console.log(printShortlist(listShortlistedRanked(db, 10)));
});

const stop = () => { handle.stop(); console.log('parado.'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
