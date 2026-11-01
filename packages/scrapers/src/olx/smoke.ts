import { createHttp } from '../http';
import { createOlxAdapter } from './adapter';

const http = createHttp({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36', timeoutMs: 30_000, jitterMs: [1500, 4000] });
const adapter = createOlxAdapter({ http });

const monitor = {
  id: 0, label: 'smoke', source: 'olx' as const, query: process.argv[2] ?? 'iphone 12',
  category: 'celular' as const, params: { pages: 2 }, intervalMinutes: 30, active: true,
  lastRunAt: null, lastYield: 0,
};

const health = await adapter.health();
console.log('health', health);
const raws = await adapter.search(monitor, new Date(Date.now() - 86_400_000));
console.log('raws', raws.length);
const inputs = raws.map((r) => adapter.toListingInput(r));
const ok = inputs.filter((i) => 'askingCents' in i);
const rej = inputs.filter((i) => !('askingCents' in i));
console.log(`parseados ${ok.length} | rejeitados ${rej.length}`);
console.table(ok.slice(0, 10).map((i) => ({ id: i.externalId, titulo: i.title.slice(0, 40), ask: i.askingCents / 100, cidade: i.city })));
console.log('rejeicoes', rej.slice(0, 5));
