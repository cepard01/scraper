import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, type Db } from '../src/db/client-helpers';
import { runMonitor } from '../src/pipeline';
import { nullAiPort } from '../src/ai-port';
import { localAskingProvider } from '../src/valuation/comparables';
import { createMonitor } from '../src/db/repo/monitors';
import { upsertFromSource } from '../src/db/repo/listings';
import { getOrCreateFingerprint } from '../src/db/repo/fingerprints';
import { listShortlistedRanked } from '../src/db/repo/opportunities';
import { opportunities, listings } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import type { ListingInput, RawListing, SearchMonitor, SourceId } from '../src/types';
import type { SourceAdapter } from '../src/adapter-contract';

const product = { category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true } as const;

const li = (id: string, ask: number, title = 'iPhone 12 128GB Desbloqueado'): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx/a/${id}`, title, description: 'usado pouco',
  askingCents: ask, askingRaw: `R$ ${ask / 100}`, city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null,
});

const NOW = new Date('2026-10-05T12:00:00Z');

const monitorRow = (id: number, query = 'iphone 12'): SearchMonitor => ({
  id, label: query, source: 'olx', query, category: 'celular', params: {},
  intervalMinutes: 30, active: true, lastRunAt: null, lastYield: 0, mutedUntil: null,
});

function fakeAdapter(items: ListingInput[]): SourceAdapter {
  return {
    id: 'olx',
    parserVersion: 'olx-1',
    async health() { return { ok: true }; },
    async search() { return items.map((i) => ({ source: 'olx', externalId: i.externalId, url: i.url, fetchedAt: NOW, payload: i }) as RawListing); },
    async fetchOne() { throw new Error('nao usado'); },
    toListingInput(raw: RawListing) { return raw.payload as ListingInput; },
  };
}

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); seedSettings(db, DEFAULT_SETTINGS); });

const seedComparables = (count: number, base: number) => {
  const fp = getOrCreateFingerprint(db, product);
  const seenAt = new Date('2026-10-01T12:00:00Z');
  for (let i = 0; i < count; i++) {
    upsertFromSource(db, li(`cmp-${i}`, base + i * 1_000), { parserVersion: 'olx-1', fingerprintId: fp.id, seenAt });
  }
  return fp.id;
};

describe('runMonitor', () => {
  it('deal boa passa no gate, liga a valuation e nao chama IA', async () => {
    seedComparables(10, 170_000);
    const monitorId = createMonitor(db, { label: 'iphone 12', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const ai = nullAiPort();

    const summary = await runMonitor(
      { db, settings: DEFAULT_SETTINGS, adapter: fakeAdapter([li('deal-1', 85_000)]), ai, comparables: localAskingProvider, now: () => NOW },
      monitorRow(monitorId),
    );

    expect(summary.created).toBe(1);
    expect(summary.aiCalls).toBe(0);
    expect(ai.calls).toBe(0);

    const ranked = listShortlistedRanked(db, 10);
    expect(ranked.map((r) => r.externalId)).toContain('deal-1');
    expect(ranked[0]!.confidence).toBe('high');
    expect(ranked[0]!.sampleSize).toBe(8);

    const opp = db.select().from(opportunities).where(eq(opportunities.gatePassed, true)).all();
    expect(opp).toHaveLength(1);
    expect(opp[0]!.valuationId).not.toBeNull();
  });

  it('segunda passada do mesmo feed nao reavalia nem regera oportunidade', async () => {
    seedComparables(10, 170_000);
    const monitorId = createMonitor(db, { label: 'iphone 12', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const deps = { db, settings: DEFAULT_SETTINGS, adapter: fakeAdapter([li('deal-2', 85_000), li('watch-1', 175_000)]), ai: nullAiPort(), comparables: localAskingProvider, now: () => NOW };
    const monitor = monitorRow(monitorId);

    const first = await runMonitor(deps, monitor);
    const second = await runMonitor(deps, monitor);

    expect(first.created).toBe(2);
    expect(first.unchanged).toBe(0);
    expect(second.created).toBe(0);
    expect(second.repriced).toBe(0);
    expect(second.unchanged).toBe(2);

    const opps = db.select().from(opportunities).all();
    expect(opps).toHaveLength(2);
    expect(opps.filter((o) => o.gatePassed)).toHaveLength(1);
  });

  it('preco gratuito vira rejeicao contabilizada, nao um descarte mudo', async () => {
    seedComparables(5, 170_000);
    const monitorId = createMonitor(db, { label: 'm', source: 'olx', query: 'q', category: 'celular', params: {}, intervalMinutes: 30 });
    const adapter = fakeAdapter([li('bad-1', 0)]);
    adapter.toListingInput = () => ({ rejected: true, reason: 'zero', rawTitle: 'iPhone 12' });
    const summary = await runMonitor(
      { db, settings: DEFAULT_SETTINGS, adapter, ai: nullAiPort(), comparables: localAskingProvider, now: () => NOW },
      monitorRow(monitorId, 'q'),
    );
    expect(summary.rejected.zero).toBe(1);
    expect(summary.created).toBe(0);
  });

  it('queda de preco realerta: repriced + nova opportunity com score', async () => {
    seedComparables(10, 170_000);
    const monitorId = createMonitor(db, { label: 'm', source: 'olx', query: 'q', category: 'celular', params: {}, intervalMinutes: 30 });
    const base = { db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, now: () => NOW };
    const monitor = monitorRow(monitorId, 'q');

    await runMonitor({ ...base, adapter: fakeAdapter([li('drop-1', 160_000)]) }, monitor);
    const summary = await runMonitor({ ...base, adapter: fakeAdapter([li('drop-1', 85_000)]) }, monitor);
    expect(summary.repriced).toBe(1);
    expect(listShortlistedRanked(db, 10).some((r) => r.externalId === 'drop-1')).toBe(true);
  });
});

// R102: os seis pontos que a Task 16 enumera como "não cosméticos" estavam todos sem verificador
// (bateria16: P1..P5, P10, P11 VIVEU). Cada `it` abaixo trava um deles pelo defeito que a decisão
// evita, e cada um foi medido contra o mutante correspondente.
describe('runMonitor: autoridade da passada', () => {
  const statusOf = (externalId: string): string =>
    db.select({ status: listings.status }).from(listings).where(eq(listings.externalId, externalId)).get()!.status;
  const rowOf = (externalId: string) =>
    db.select().from(listings).where(eq(listings.externalId, externalId)).get()!;

  const liSrc = (source: SourceId, id: string, ask: number): ListingInput =>
    ({ ...li(id, ask), source, url: 'https://x/' + source + '/' + id });

  const crossAdapter = (items: ListingInput[]): SourceAdapter => ({
    id: 'olx',
    parserVersion: 'olx-1',
    async health() { return { ok: true }; },
    async search() { return items.map((i) => ({ source: i.source, externalId: i.externalId, url: i.url, fetchedAt: NOW, payload: i }) as RawListing); },
    async fetchOne() { throw new Error('nao usado'); },
    toListingInput(raw: RawListing) { return raw.payload as ListingInput; },
  });

  const depsOf = (adapter: SourceAdapter, now: () => Date = () => NOW) =>
    ({ db, settings: DEFAULT_SETTINGS, adapter, ai: nullAiPort(), comparables: localAskingProvider, now });

  it('um preço ilegível nesta passada não aposenta o anúncio visto na anterior', async () => {
    const monitorId = createMonitor(db, { label: 'q1', source: 'olx', query: 'q1', category: 'celular', params: {}, intervalMinutes: 30 });
    await runMonitor(depsOf(fakeAdapter([li('blind-1', 98_000)])), monitorRow(monitorId, 'q1'));

    const cego: SourceAdapter = {
      ...fakeAdapter([li('blind-1', 98_000)]),
      toListingInput: () => ({ rejected: true, reason: 'ilegivel', rawTitle: 'blind-1' }),
    };
    const summary = await runMonitor(depsOf(cego), monitorRow(monitorId, 'q1'));

    expect(summary.rejected.ilegivel).toBe(1);
    expect(summary.fetched).toBe(1);
    expect(statusOf('blind-1')).not.toBe('gone');
  });

  it('feed vazio é uma passada sem autoridade, não o fim do mercado', async () => {
    const monitorId = createMonitor(db, { label: 'q2', source: 'olx', query: 'q2', category: 'celular', params: {}, intervalMinutes: 30 });
    await runMonitor(depsOf(fakeAdapter([li('vazio-1', 98_000)])), monitorRow(monitorId, 'q2'));
    const summary = await runMonitor(depsOf(fakeAdapter([])), monitorRow(monitorId, 'q2'));

    expect(summary.fetched).toBe(0);
    expect(summary.outcome).toBe('ok');
    expect(statusOf('vazio-1')).not.toBe('gone');
  });

  it('o seenIds é do monitor, não da fonte: o vizinho do outro monitor fica vivo', async () => {
    const a = createMonitor(db, { label: 'qa', source: 'olx', query: 'qa', category: 'celular', params: {}, intervalMinutes: 30 });
    const b = createMonitor(db, { label: 'qb', source: 'olx', query: 'qb', category: 'celular', params: {}, intervalMinutes: 30 });
    await runMonitor(depsOf(fakeAdapter([li('vizinho-a', 98_000)])), monitorRow(a, 'qa'));
    await runMonitor(depsOf(fakeAdapter([li('vizinho-b', 98_000)])), monitorRow(b, 'qb'));
    await runMonitor(depsOf(fakeAdapter([li('vizinho-a', 96_000)])), monitorRow(a, 'qa'));

    expect(statusOf('vizinho-b')).not.toBe('gone');
    expect(statusOf('vizinho-a')).toBe('repriced');
  });

  it('deadline corta a passada e ela perde o direito de declarar expiração', async () => {
    const monitorId = createMonitor(db, { label: 'q3', source: 'olx', query: 'q3', category: 'celular', params: {}, intervalMinutes: 30 });
    const feed = [li('cortado-1', 98_000), li('cortado-2', 98_000)];
    await runMonitor(depsOf(fakeAdapter(feed)), monitorRow(monitorId, 'q3'));

    let tick = 0;
    const summary = await runMonitor(
      { ...depsOf(fakeAdapter(feed)), now: () => new Date(NOW.getTime() + (tick++ * 200)), deadlineMs: 300 },
      monitorRow(monitorId, 'q3'),
    );

    expect(summary.outcome).toBe('partial');
    expect(summary.unchanged).toBe(1);
    expect(statusOf('cortado-2')).not.toBe('gone');
  });

  it('oportunidade reprovada carrega a valuation que explica o bloqueio', async () => {
    seedComparables(10, 170_000);
    const monitorId = createMonitor(db, { label: 'q4', source: 'olx', query: 'q4', category: 'celular', params: {}, intervalMinutes: 30 });
    await runMonitor(depsOf(fakeAdapter([li('caro-1', 150_000)])), monitorRow(monitorId, 'q4'));

    const reprova = db.select().from(opportunities).where(eq(opportunities.gatePassed, false)).all();
    expect(reprova).toHaveLength(1);
    expect(reprova[0]!.valuationId).not.toBeNull();
  });

  it('o mesmo anúncio nas duas fontes vira uma duplicata ignorada, sem segunda oportunidade', async () => {
    const monitorId = createMonitor(db, { label: 'q5', source: 'olx', query: 'q5', category: 'celular', params: {}, intervalMinutes: 30 });
    const summary = await runMonitor(
      depsOf(crossAdapter([liSrc('olx', 'par-1', 98_000), liSrc('meli', 'par-2', 97_000)])),
      monitorRow(monitorId, 'q5'),
    );

    expect(summary.created).toBe(2);
    const original = rowOf('par-1');
    const duplicata = rowOf('par-2');
    expect(duplicata.dupeOf).toBe(original.id);
    expect(duplicata.status).toBe('ignored');
    expect(original.dupeOf).toBeNull();
    expect(db.select().from(opportunities).where(eq(opportunities.listingId, duplicata.id)).all()).toHaveLength(0);
  });
});
