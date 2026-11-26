import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, type Db } from '../src/db/client-helpers';
import { runMonitor } from '../src/pipeline';
import { nullAiPort } from '../src/ai-port';
import { localAskingProvider } from '../src/valuation/comparables';
import { createMonitor } from '../src/db/repo/monitors';
import { upsertFromSource } from '../src/db/repo/listings';
import { getOrCreateFingerprint } from '../src/db/repo/fingerprints';
import { dealAlerts, opportunities, valuations, listings } from '../src/db/schema';
import type { AlertMessage, NotifyPort } from '../src/notify-port';
import type { ListingInput, MonitorParams, RawListing, SearchMonitor } from '../src/types';
import type { SourceAdapter } from '../src/adapter-contract';

const product = { category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true } as const;
const NOW = new Date('2026-10-05T12:00:00Z');

const li = (id: string, ask: number, title = 'iPhone 12 128GB Desbloqueado'): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx/a/${id}`, title, description: 'usado pouco',
  askingCents: ask, askingRaw: `R$ ${ask / 100}`, city: 'Rio de Janeiro', uf: 'RJ',
  imageUrls: ['https://img/1.jpg'], sellerRef: null, publishedAt: null,
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

const notifier = (result: { ok: boolean; error?: string } = { ok: true }) => {
  const calls: AlertMessage[] = [];
  const port: NotifyPort = { async send(m) { calls.push(m); return result; } };
  return { port, calls };
};

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); seedSettings(db, DEFAULT_SETTINGS); });

const seedComparables = (count: number, base: number) => {
  const fp = getOrCreateFingerprint(db, product);
  for (let i = 0; i < count; i++) {
    upsertFromSource(db, li(`cmp-${i}`, base + i * 1_000), {
      parserVersion: 'olx-1', fingerprintId: fp.id, seenAt: new Date('2026-10-01T12:00:00Z'),
    });
  }
};

// Floor baixo para que o teste isole o alerta de oferta do gate de revenda.
const settings = { ...DEFAULT_SETTINGS, floorMarginPct: 0.1, floorMarginCents: 10_000 };

const depsOf = (a: SourceAdapter, notify: NotifyPort) => ({
  db, settings, adapter: a, ai: nullAiPort(),
  comparables: localAskingProvider, notify, now: () => NOW,
});

describe('requireWords no pipeline', () => {
  it('título fuzzy é rejeitado antes do upsert, da valuation e do alerta', async () => {
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const { port, calls } = notifier();
    const summary = await runMonitor(
      depsOf(adapter([li('fuzzy-1', 85_000, 'iPhone 14 128GB')]), port),
      monitor(monitorId, { requireWords: ['iphone 12'] }),
    );

    expect(summary.rejected).toEqual({ 'require-words': 1 });
    expect(summary.created).toBe(0);
    expect(db.select().from(listings).all()).toHaveLength(0);
    expect(db.select().from(valuations).all()).toHaveLength(0);
    expect(db.select().from(opportunities).all()).toHaveLength(0);
    expect(db.select().from(dealAlerts).all()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('sem requireWords o título legítimo segue', async () => {
    seedComparables(15, 400_000);
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const summary = await runMonitor(
      depsOf(adapter([li('ok-1', 85_000)]), notifier().port),
      monitor(monitorId, { requireWords: ['iphone 12'] }),
    );
    expect(summary.created).toBe(1);
  });
});

describe('alerta de negócio no pipeline', () => {
  it('mediana confiável entrega uma mensagem e não reenvia na passada igual', async () => {
    seedComparables(15, 400_000);
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const { port, calls } = notifier();
    const deps = depsOf(adapter([li('deal-1', 250_000)]), port);
    const m = monitor(monitorId, { minSamples: 5 });

    const first = await runMonitor(deps, m);
    const second = await runMonitor(deps, m);

    expect(first.alerts).toBe(1);
    expect(second.alerts).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toContain('iPhone 12 128GB Desbloqueado');
    expect(calls[0]!.body).toContain('mediana de');
    expect(calls[0]!.body).toContain('iphone-12-rj');
    const sent = db.select().from(dealAlerts).where(eq(dealAlerts.status, 'sent')).all();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channel).toBe('ntfy');
    expect(sent[0]!.alertedAtCents).toBe(250_000);
  });

  it('cold start usa o teto manual mesmo com gate por amostra insuficiente', async () => {
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const { port, calls } = notifier();
    const summary = await runMonitor(
      depsOf(adapter([li('cold-1', 200_000)]), port),
      monitor(monitorId, { manualCeilingCents: 450_000, minSamples: 15 }),
    );

    expect(summary.alerts).toBe(1);
    expect(calls[0]!.body).toContain('teto manual (cold start)');
    expect(calls[0]!.body).toContain('R$ 4.500,00');
    expect(db.select().from(opportunities).all()[0]!.gateReason).toBe('amostra-insuficiente');
  });

  it('sem teto e sem amostra não alerta', async () => {
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const { port, calls } = notifier();
    await runMonitor(depsOf(adapter([li('cold-2', 100_000)]), port), monitor(monitorId));
    expect(calls).toHaveLength(0);
    expect(db.select().from(dealAlerts).all()).toHaveLength(0);
  });

  it('queda nova reabre o alerta; preço igual ou maior não', async () => {
    seedComparables(15, 400_000);
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const deps = depsOf(adapter([li('drop-1', 250_000)]), notifier().port);
    const m = monitor(monitorId, { minSamples: 5 });
    await runMonitor(deps, m);
    await runMonitor({ ...deps, adapter: adapter([li('drop-1', 150_000)]) }, m);
    await runMonitor({ ...deps, adapter: adapter([li('drop-1', 150_000)]) }, m);
    await runMonitor({ ...deps, adapter: adapter([li('drop-1', 260_000)]) }, m);

    const rows = db.select().from(dealAlerts).all();
    expect(rows.filter((r) => r.status === 'sent').map((r) => r.alertedAtCents)).toEqual([250_000, 150_000]);
    expect(rows.filter((r) => r.status === 'suppressed').map((r) => r.reason)).toEqual(['sem-nova-cruzada']);
  });

  it('falha de entrega vira deal_alert failed sem derrubar a passada', async () => {
    seedComparables(15, 400_000);
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const summary = await runMonitor(
      depsOf(adapter([li('deal-2', 250_000)]), notifier({ ok: false, error: 'http 500' }).port),
      monitor(monitorId, { minSamples: 5 }),
    );

    expect(summary.outcome).toBe('ok');
    expect(summary.alerts).toBe(0);
    expect(summary.created).toBe(1);
    const failed = db.select().from(dealAlerts).all();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ status: 'failed', reason: 'http 500' });
  });

  it('gate financeiro reprovado não entrega: a oferta fica suppressed com o motivo', async () => {
    seedComparables(15, 400_000);
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const { port, calls } = notifier();
    const deps = { ...depsOf(adapter([li('caro-1', 250_000)]), port), settings: DEFAULT_SETTINGS };

    const summary = await runMonitor(deps, monitor(monitorId, { minSamples: 5 }));

    expect(summary.alerts).toBe(0);
    expect(calls).toHaveLength(0);
    expect(db.select().from(dealAlerts).all()[0]).toMatchObject({
      status: 'suppressed', reason: 'abaixo-do-floor', alertedAtCents: 250_000,
    });
  });

  it('notifier que lança não derruba a passada', async () => {
    seedComparables(15, 400_000);
    const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const boom: NotifyPort = { async send() { throw new Error('webhook caiu'); } };
    const summary = await runMonitor(
      depsOf(adapter([li('deal-3', 250_000)]), boom),
      monitor(monitorId, { minSamples: 5 }),
    );
    expect(summary.outcome).toBe('ok');
    expect(db.select().from(dealAlerts).all()[0]!.reason).toBe('webhook caiu');
  });
});
