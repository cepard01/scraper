import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, type Db } from '../src/db/client-helpers';
import { runMonitor } from '../src/pipeline';
import { localAskingProvider } from '../src/valuation/comparables';
import { createMonitor } from '../src/db/repo/monitors';
import { upsertFromSource } from '../src/db/repo/listings';
import { getOrCreateFingerprint } from '../src/db/repo/fingerprints';
import { dealAlerts, listings, opportunities, runs } from '../src/db/schema';
import type { AiTriagePort, TriageVerdict } from '../src/ai-port';
import type { AlertMessage, NotifyPort } from '../src/notify-port';
import type { SourceAdapter } from '../src/adapter-contract';
import type { ListingInput, MonitorParams, RawListing, SearchMonitor } from '../src/types';

const product = { category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true } as const;
const NOW = new Date('2026-10-05T12:00:00Z');

const li = (id: string, ask: number): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx/a/${id}`, title: 'iPhone 12 128GB Desbloqueado',
  description: 'usado pouco', askingCents: ask, askingRaw: `R$ ${ask / 100}`,
  city: 'Rio de Janeiro', uf: 'RJ', imageUrls: ['https://img/1.jpg'], sellerRef: null, publishedAt: null,
});

const monitor = (id: number, params: MonitorParams = {}): SearchMonitor => ({
  id, label: 'iphone-12-rj', source: 'olx', query: 'iphone 12', category: 'celular', params,
  intervalMinutes: 30, active: true, lastRunAt: null, lastYield: 0, mutedUntil: null,
});

const adapter = (items: ListingInput[]): SourceAdapter => ({
  id: 'olx', parserVersion: 'olx-rsc-2026-11',
  async health() { return { ok: true }; },
  async search() { return items.map((i) => ({ source: 'olx', externalId: i.externalId, url: i.url, fetchedAt: NOW, payload: i }) as RawListing); },
  async fetchOne() { throw new Error('nao usado'); },
  toListingInput(raw: RawListing) { return raw.payload as ListingInput; },
});

const notifier = () => {
  const calls: AlertMessage[] = [];
  const port: NotifyPort = { async send(m) { calls.push(m); return { ok: true }; } };
  return { port, calls };
};

/** Porte controlado: conta chamadas e cache hits para verificar os contadores do run. */
function aiWith(verdicts: Record<string, TriageVerdict>, hitsPerCall = 0): AiTriagePort & { seen: number[][] } {
  let calls = 0;
  let hits = 0;
  const seen: number[][] = [];
  return {
    seen,
    get calls() { return calls; },
    get cacheHits() { return hits; },
    async triage(items) {
      calls++;
      hits += hitsPerCall;
      seen.push(items.map((i) => i.listingId));
      return new Map(items.map((i) => [
        i.listingId,
        verdicts[i.externalId] ?? { verdict: 'unavailable' as const, reasons: ['ia-sem-opiniao'] },
      ]));
    },
  };
}

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); seedSettings(db, DEFAULT_SETTINGS); });

const seedComparables = () => {
  const fp = getOrCreateFingerprint(db, product);
  for (let i = 0; i < 15; i++) {
    upsertFromSource(db, li(`cmp-${i}`, 400_000 + i * 1_000), {
      parserVersion: 'olx-1', fingerprintId: fp.id, seenAt: new Date('2026-10-01T12:00:00Z'),
    });
  }
};

const settings = { ...DEFAULT_SETTINGS, floorMarginPct: 0.1, floorMarginCents: 10_000 };
const monitorId = () => createMonitor(db, {
  label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30,
});

const depsOf = (a: AiTriagePort, notify: NotifyPort) => ({
  db, settings, adapter: adapter([li('deal-1', 250_000)]), ai: a,
  comparables: localAskingProvider, notify, now: () => NOW,
});

const oppOf = () => db.select().from(opportunities).where(eq(opportunities.listingId,
  db.select({ id: listings.id }).from(listings).where(eq(listings.externalId, 'deal-1')).get()!.id)).get()!;

describe('pipeline: triagem IA no passo 8', () => {
  it('veto vira ignored, sem push, com veredito e motivos na oportunidade', async () => {
    seedComparables();
    const ai = aiWith({ 'deal-1': { verdict: 'veto', reasons: ['tela-trincada'] } });
    const { port, calls } = notifier();

    const summary = await runMonitor(depsOf(ai, port), monitor(monitorId(), { minSamples: 5 }));

    expect(summary.alerts).toBe(0);
    expect(calls).toHaveLength(0);
    expect(ai.seen).toEqual([[db.select({ id: listings.id }).from(listings).where(eq(listings.externalId, 'deal-1')).get()!.id]]);
    expect(oppOf()).toMatchObject({ aiVerdict: 'veto', aiReasons: ['tela-trincada'] });
    expect(db.select().from(listings).where(eq(listings.externalId, 'deal-1')).get()!.status).toBe('ignored');
    expect(db.select().from(dealAlerts).all()).toHaveLength(0);
  });

  it('pass mantém shortlisted e entrega sem marcador de auditoria', async () => {
    seedComparables();
    const ai = aiWith({ 'deal-1': { verdict: 'pass', reasons: [] } });
    const { port, calls } = notifier();

    const summary = await runMonitor(depsOf(ai, port), monitor(monitorId(), { minSamples: 5 }));

    expect(summary.alerts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(oppOf().aiVerdict).toBe('pass');
    const alert = db.select().from(dealAlerts).all()[0]!;
    expect(alert.status).toBe('sent');
    expect(alert.flags).toEqual([]);
  });

  it('unavailable alerta igual, mas marca sem-auditoria-ia', async () => {
    seedComparables();
    const ai = aiWith({ 'deal-1': { verdict: 'unavailable', reasons: [' ia indisponível '] } });
    const { port, calls } = notifier();

    const summary = await runMonitor(depsOf(ai, port), monitor(monitorId(), { minSamples: 5 }));

    expect(summary.alerts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(oppOf().aiVerdict).toBe('unavailable');
    expect(db.select().from(dealAlerts).all()[0]!.flags).toEqual(['sem-auditoria-ia']);
  });

  it('contadores do run refletem só chamadas e hits desta passada', async () => {
    seedComparables();
    const ai = aiWith({ 'deal-1': { verdict: 'pass', reasons: [] } }, 1);
    const { port } = notifier();

    const summary = await runMonitor(depsOf(ai, port), monitor(monitorId(), { minSamples: 5 }));

    expect(summary.aiCalls).toBe(1);
    expect(summary.aiCacheHits).toBe(1);
    const run = db.select().from(runs).all()[0]!;
    expect(run.aiCalls).toBe(1);
    expect(run.aiCacheHits).toBe(1);
  });

  it('item abaixo do floor não consulta IA', async () => {
    seedComparables();
    const ai = aiWith({});
    const { port } = notifier();
    const set = { ...depsOf(ai, port), settings: DEFAULT_SETTINGS };

    const summary = await runMonitor(set, monitor(monitorId(), { minSamples: 5 }));

    expect(ai.seen).toHaveLength(0);
    expect(summary.aiCalls).toBe(0);
    expect(summary.aiCacheHits).toBe(0);
  });

  it('IA que lança não derruba a passada: alerta segue sem auditoria', async () => {
    seedComparables();
    const ai: AiTriagePort = {
      calls: 0,
      async triage() { throw new Error('gateway caiu'); },
    };
    const { port, calls } = notifier();

    const summary = await runMonitor(depsOf(ai, port), monitor(monitorId(), { minSamples: 5 }));

    expect(summary.outcome).toBe('ok');
    expect(summary.alerts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(oppOf().aiVerdict).toBe('unavailable');
    expect(db.select().from(dealAlerts).all()[0]!.flags).toEqual(['sem-auditoria-ia']);
  });
});
