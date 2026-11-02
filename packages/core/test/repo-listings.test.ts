import { count, eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import type { Db } from '../src/db/client';
import { upsertFromSource, markGone, findComparables, findRecentCrossSource, setFingerprint, setStatus, attachDupe } from '../src/db/repo/listings';
import { createMonitor } from '../src/db/repo/monitors';
import { fingerprints, listings, pricePoints } from '../src/db/schema';
import type { ListingInput, ListingStatus } from '../src/types';

const input = (over: Partial<ListingInput> = {}): ListingInput => ({
  source: 'olx', externalId: 'olx-1', url: 'https://olx.com.br/a/olx-1',
  title: 'iPhone 12 128gb Desbloqueado', description: 'usado, pouco uso',
  askingCents: 98_000, askingRaw: 'R$ 980', city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null, ...over,
});

const pricePointCount = (database: Db): number =>
  database.select({ n: count() }).from(pricePoints).get()!.n;

const row = (database: Db, id: number) =>
  database.select().from(listings).where(eq(listings.id, id)).get()!;

const fp = (database: Db, over: Partial<{ key: string; variant: string }> = {}): number =>
  database.insert(fingerprints).values({
    key: over.key ?? 'k', category: 'celular', brand: 'apple',
    model: 'iphone 12', variant: over.variant ?? '128gb-desb',
    grade: 'B', label: 'iPhone 12 128GB',
  }).returning({ id: fingerprints.id }).get().id;

const fpSemMarca = (database: Db, key: string, variant: string): number =>
  database.insert(fingerprints).values({
    key, category: 'celular', brand: null, model: null, variant, grade: 'B', label: `Celular ${variant}`,
  }).returning({ id: fingerprints.id }).get().id;

let db: Db;
beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
});

describe('upsertFromSource', () => {
  it('cria como new e reaproveita como unchanged', () => {
    const first = upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    expect(first.transition).toBe('new');
    const again = upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T13:00:00Z') });
    expect(again.transition).toBe('unchanged');
    expect(again.id).toBe(first.id);
  });

  it('marca repriced e grava pricePoint quando o preço muda', () => {
    upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    const second = upsertFromSource(db, input({ askingCents: 88_000 }), { parserVersion: 'olx-1', seenAt: new Date('2026-10-02T12:00:00Z') });
    expect(second.transition).toBe('repriced');
    expect(pricePointCount(db)).toBe(2);
    expect(row(db, second.id).askingCents).toBe(88_000);
  });

  it('não regrava pricePoint para preço igual', () => {
    upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-05T12:00:00Z') });
    expect(pricePointCount(db)).toBe(1);
  });

  it('não reativa item gone silenciosamente: volta como new com firstSeen preservado', () => {
    const a = upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    markGone(db, 'olx', [], new Date('2026-10-02T12:00:00Z'));
    const b = upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-03T12:00:00Z') });
    expect(b.id).toBe(a.id);
    expect(b.transition).toBe('new');
    const r = row(db, b.id);
    expect(r.status).toBe('new');
    expect(r.firstSeenAt.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(r.lastSeenAt.toISOString()).toBe('2026-10-03T12:00:00.000Z');
  });

  it('passada sem city/uf/imagens não apaga o que já foi visto, e atualiza o parser', () => {
    const first = upsertFromSource(db, input({ imageUrls: ['https://img/1.jpg'], sellerRef: 'lojista-7' }), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    const again = upsertFromSource(db, input({ city: null, uf: null, imageUrls: [], sellerRef: null }), { parserVersion: 'olx-2', seenAt: new Date('2026-10-02T12:00:00Z') });
    const r = row(db, again.id);
    expect(again.id).toBe(first.id);
    expect(r.city).toBe('Curitiba');
    expect(r.uf).toBe('PR');
    expect(r.imageUrls).toEqual(['https://img/1.jpg']);
    expect(r.sellerRef).toBe('lojista-7');
    expect(r.parserVersion).toBe('olx-2');
  });

  it('status de ciclo de vida sobrevive à passada que só reconfirmou o item', () => {
    for (const status of ['shortlisted', 'ignored', 'bought'] as ListingStatus[]) {
      const a = upsertFromSource(db, input({ externalId: `olx-${status}` }), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
      setStatus(db, a.id, status);
      const reprice = upsertFromSource(db, input({ externalId: `olx-${status}`, askingCents: 88_000 }), { parserVersion: 'olx-1', seenAt: new Date('2026-10-02T12:00:00Z') });
      const steady = upsertFromSource(db, input({ externalId: `olx-${status}`, askingCents: 88_000 }), { parserVersion: 'olx-1', seenAt: new Date('2026-10-03T12:00:00Z') });
      expect(reprice.transition).toBe('repriced');
      expect(steady.transition).toBe('unchanged');
      expect(row(db, a.id).askingCents).toBe(88_000);
      expect(row(db, a.id).status).toBe(status);
    }
  });
});

describe('markGone / findComparables', () => {
  it('marca gone apenas os itens daquele source ausentes na passada', () => {
    upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    upsertFromSource(db, input({ source: 'meli', externalId: 'MLB-9', url: 'https://mlb/9', askingCents: 120_000 }),
      { parserVersion: 'meli-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    const gone = markGone(db, 'meli', [], new Date('2026-10-02T12:00:00Z'));
    expect(gone).toBe(1);
  });

  it('um monitor não declara gone o inventário do outro monitor do mesmo source', () => {
    const iphone = createMonitor(db, { label: 'iphone', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const galaxy = createMonitor(db, { label: 'galaxy', source: 'olx', query: 'galaxy a54', category: 'celular', params: {}, intervalMinutes: 30 });
    const ip = upsertFromSource(db, input({ externalId: 'olx-ip' }), { parserVersion: 'olx-1', monitorId: iphone, seenAt: new Date('2026-10-01T12:00:00Z') });
    const gx = upsertFromSource(db, input({ externalId: 'olx-gx', title: 'Galaxy A54 128gb' }), { parserVersion: 'olx-1', monitorId: galaxy, seenAt: new Date('2026-10-01T12:00:00Z') });

    expect(markGone(db, 'olx', ['olx-gx'], new Date('2026-10-02T12:00:00Z'), galaxy)).toBe(0);
    expect(row(db, ip.id).status).toBe('new');

    expect(markGone(db, 'olx', [], new Date('2026-10-02T12:00:00Z'), galaxy)).toBe(1);
    expect(row(db, gx.id).status).toBe('gone');
    expect(row(db, ip.id).status).toBe('new');
  });

  it('item comprado não vira gone por sumir do feed', () => {
    const a = upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    setStatus(db, a.id, 'bought');
    expect(markGone(db, 'olx', [], new Date('2026-10-02T12:00:00Z'))).toBe(0);
    expect(row(db, a.id).status).toBe('bought');
  });

  it('comparáveis exigem fingerprint e janela de 90 dias', () => {
    const fpId = fp(db);
    const a = upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    setFingerprint(db, a.id, fpId, 'B');
    const old = upsertFromSource(db, input({ externalId: 'olx-old', askingCents: 70_000 }), { parserVersion: 'olx-1', seenAt: new Date('2025-12-01T12:00:00Z') });
    setFingerprint(db, old.id, fpId, 'B');
    const comps = findComparables(db, fpId, { windowDays: 90, variantAgnostic: false, now: new Date('2026-10-05T12:00:00Z') });
    expect(comps.map((c) => c.askingCents)).toEqual([98_000]);
  });

  it('comparáveis incluem gone, excluem dupe e excluem bought', () => {
    const fpId = fp(db, { key: 'k-fam' });
    const agora = new Date('2026-10-06T12:00:00Z');
    const vivo = upsertFromSource(db, input({ externalId: 'olx-vivo', askingCents: 100_000 }), { parserVersion: 'olx-1', fingerprintId: fpId, grade: 'B', seenAt: agora });
    const sumiu = upsertFromSource(db, input({ externalId: 'olx-sumiu', askingCents: 90_000 }), { parserVersion: 'olx-1', fingerprintId: fpId, grade: 'B', seenAt: agora });
    const gêmeo = upsertFromSource(db, input({ externalId: 'olx-gemeo', askingCents: 50_000 }), { parserVersion: 'olx-1', fingerprintId: fpId, grade: 'B', seenAt: agora });
    const comprado = upsertFromSource(db, input({ externalId: 'olx-comprado', askingCents: 150_000 }), { parserVersion: 'olx-1', fingerprintId: fpId, grade: 'B', seenAt: agora });
    setStatus(db, sumiu.id, 'gone');
    attachDupe(db, gêmeo.id, vivo.id);
    setStatus(db, comprado.id, 'bought');

    const comps = findComparables(db, fpId, { windowDays: 90, variantAgnostic: false, now: agora });
    expect(comps.map((c) => c.askingCents).sort((x, y) => x - y)).toEqual([90_000, 100_000]);
  });

  it('excludeListingId tira o item avaliado da própria amostra', () => {
    const fpId = fp(db, { key: 'k2' });
    const deal = upsertFromSource(db, input({ askingCents: 60_000 }), { parserVersion: 'olx-1', fingerprintId: fpId, grade: 'B', seenAt: new Date('2026-10-05T12:00:00Z') });
    upsertFromSource(db, input({ externalId: 'olx-ref', askingCents: 150_000 }), { parserVersion: 'olx-1', fingerprintId: fpId, grade: 'B', seenAt: new Date('2026-10-05T12:00:00Z') });

    const all = findComparables(db, fpId, { windowDays: 90, variantAgnostic: false, now: new Date('2026-10-06T12:00:00Z') });
    expect(all.map((c) => c.askingCents).sort((x, y) => x - y)).toEqual([60_000, 150_000]);

    const semODeal = findComparables(db, fpId, {
      windowDays: 90, variantAgnostic: false, now: new Date('2026-10-06T12:00:00Z'), excludeListingId: deal.id,
    });
    expect(semODeal.map((c) => c.askingCents)).toEqual([150_000]);
  });

  it('variantAgnostic soma as variantes do mesmo modelo', () => {
    const desb = fp(db, { key: 'va-1', variant: '128gb-desb' });
    const bloq = fp(db, { key: 'va-2', variant: '128gb-bloq' });
    upsertFromSource(db, input({ externalId: 'olx-desb', askingCents: 98_000 }), { parserVersion: 'olx-1', fingerprintId: desb, grade: 'B', seenAt: new Date('2026-10-05T12:00:00Z') });
    upsertFromSource(db, input({ externalId: 'olx-bloq', askingCents: 88_000 }), { parserVersion: 'olx-1', fingerprintId: bloq, grade: 'B', seenAt: new Date('2026-10-05T12:00:00Z') });
    const agora = new Date('2026-10-06T12:00:00Z');

    expect(findComparables(db, desb, { windowDays: 90, variantAgnostic: false, now: agora }).map((c) => c.askingCents))
      .toEqual([98_000]);
    expect(findComparables(db, desb, { windowDays: 90, variantAgnostic: true, now: agora }).map((c) => c.askingCents).sort((x, y) => x - y))
      .toEqual([88_000, 98_000]);
  });

  it('fingerprints sem marca nem modelo não viram comparáveis entre si', () => {
    const generico128 = fpSemMarca(db, 'gen-128', '128gb');
    const generico64 = fpSemMarca(db, 'gen-64', '64gb');
    upsertFromSource(db, input({ externalId: 'olx-g128', askingCents: 98_000 }), { parserVersion: 'olx-1', fingerprintId: generico128, grade: 'B', seenAt: new Date('2026-10-05T12:00:00Z') });
    upsertFromSource(db, input({ externalId: 'olx-g64', askingCents: 40_000 }), { parserVersion: 'olx-1', fingerprintId: generico64, grade: 'B', seenAt: new Date('2026-10-05T12:00:00Z') });

    const comps = findComparables(db, generico128, { windowDays: 90, variantAgnostic: true, now: new Date('2026-10-06T12:00:00Z') });
    expect(comps.map((c) => c.askingCents)).toEqual([98_000]);
  });
});

describe('findRecentCrossSource', () => {
  const desde = new Date('2026-10-04T00:00:00Z');
  const seed = (over: Partial<ListingInput>, fingerprintId: number, seenAt: string): number =>
    upsertFromSource(db, input(over), { parserVersion: 'p-1', fingerprintId, grade: 'B', seenAt: new Date(seenAt) }).id;

  it('só vem da outra fonte, dentro da janela e de um fingerprint monitorado', () => {
    const alvo = fp(db, { key: 'k-alvo' });
    const outro = fp(db, { key: 'k-outro' });
    const bom = seed({ source: 'meli', externalId: 'm-bom', title: 'iPhone 12 128gb Desbloqueado', askingCents: 97_000 }, alvo, '2026-10-05T12:00:00Z');
    seed({ source: 'olx', externalId: 'o-mesma-fonte' }, alvo, '2026-10-05T12:00:00Z');
    seed({ source: 'meli', externalId: 'm-fora-do-fp' }, outro, '2026-10-05T12:00:00Z');
    seed({ source: 'meli', externalId: 'm-fora-da-janela' }, alvo, '2026-10-01T12:00:00Z');

    expect(findRecentCrossSource(db, 'olx', desde, [alvo])).toEqual([
      { listingId: bom, title: 'iPhone 12 128gb Desbloqueado', askingCents: 97_000 },
    ]);
  });

  it('quem já foi marcado como duplicata não volta como candidato', () => {
    const alvo = fp(db, { key: 'k-dupe' });
    const a = seed({ source: 'meli', externalId: 'm-a' }, alvo, '2026-10-05T12:00:00Z');
    const b = seed({ source: 'meli', externalId: 'm-b' }, alvo, '2026-10-05T12:00:00Z');
    attachDupe(db, b, a);

    expect(findRecentCrossSource(db, 'olx', desde, [alvo]).map((r) => r.listingId)).toEqual([a]);
  });

  it('sem fingerprint monitorado a consulta devolve vazio, não um IN () no SQL', () => {
    const alvo = fp(db, { key: 'k-vazio' });
    seed({ source: 'meli', externalId: 'm-so-fp' }, alvo, '2026-10-05T12:00:00Z');

    expect(findRecentCrossSource(db, 'olx', desde, [])).toEqual([]);
  });
});
