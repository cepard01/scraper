import { loadConfig } from '@brique/core/config';
import type { SearchMonitor } from '@brique/core/types';
import { createHttp } from '../http';
import { createMeliAdapter } from './adapter';

const cfg = loadConfig();
const http = createHttp({ userAgent: 'brique-smoke', timeoutMs: 20_000 });
const adapter = createMeliAdapter({ http, token: cfg.meliToken, unit: cfg.meliUnit });

const monitor: SearchMonitor = {
  id: 0, label: 'smoke', source: 'meli', query: process.argv[2] ?? 'iphone 12 128gb',
  category: 'celular', params: { pages: 1 }, intervalMinutes: 30, active: true,
  lastRunAt: null, lastYield: 0, mutedUntil: null,
};

console.log('available', adapter.available, 'health', await adapter.health());
if (!adapter.available) {
  console.log('parando aqui de proposito: sem token o search nao faz nenhuma chamada e nao queima cota (spec 8.2). Preencha MELI_ACCESS_TOKEN no .env e rode de novo.');
  process.exit(0);
}

const raws = await adapter.search(monitor, new Date(Date.now() - 86_400_000));
const inputs = raws.map((r) => adapter.toListingInput(r));
const ok = inputs.filter((i) => 'askingCents' in i);
console.log(`raws ${raws.length} | parseados ${ok.length} | rejeitados ${inputs.length - ok.length}`);
console.table(ok.slice(0, 10).map((i) => ({ id: i.externalId, titulo: i.title.slice(0, 42), ask: i.askingCents / 100, uf: i.uf })));
console.log('rejeicoes', inputs.filter((i) => !('askingCents' in i)).slice(0, 5));

// fetchOne so recebe o externalId: se a URL montada em auth.ts nao servir, ou se o corpo
// responder outro item, esta linha e a unica que descobre antes do Task 16
if (ok.length > 0) {
  try {
    const pedido = ok[0]!.externalId;
    const um = await adapter.fetchOne(pedido);
    if (um.externalId !== pedido) throw new Error('devolveu outro anuncio (' + um.externalId + ')');
    console.log('fetchOne ok', pedido, '->', um.url);
  } catch (e) {
    console.log('fetchOne FALHOU', ok[0]!.externalId, (e as Error).message);
  }
}
