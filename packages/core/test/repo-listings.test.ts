import { count, eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import type { Db } from '../src/db/client';
import { upsertFromSource, markGone, findComparables, setFingerprint } from '../src/db/repo/listings';
import { fingerprints, listings, pricePoints } from '../src/db/schema';
import type { ListingInput } from '../src/types';

const input = (over: Partial<ListingInput> = {}): ListingInput => ({
  source: 'olx', externalId: 'olx-1', url: 'https://olx.com.br/a/olx-1',
  title: 'iPhone 12 128gb Desbloqueado', description: 'usado, pouco uso',
  askingCents: 98_000, askingRaw: 'R$ 980', city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null, ...over,
});

const pricePointCount = (database: Db): number =>
  database.select({ n: count() }).from(pricePoints).get()!.n;

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
    const row = db.select().from(listings).where(eq(listings.id, b.id)).get()!;
    expect(row.status).toBe('new');
    expect(row.firstSeenAt.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(row.lastSeenAt.toISOString()).toBe('2026-10-03T12:00:00.000Z');
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

  it('comparáveis exigem fingerprint e janela de 90 dias', () => {
    const { id: fpId } = db.insert(fingerprints).values({
      key: 'k', category: 'celular', brand: 'apple', model: 'iphone 12',
      variant: '128gb-desb', grade: 'B', label: 'iPhone 12 128GB',
    }).returning({ id: fingerprints.id }).get();
    const a = upsertFromSource(db, input(), { parserVersion: 'olx-1', seenAt: new Date('2026-10-01T12:00:00Z') });
    setFingerprint(db, a.id, fpId, 'B');
    const old = upsertFromSource(db, input({ externalId: 'olx-old', askingCents: 70_000 }), { parserVersion: 'olx-1', seenAt: new Date('2025-12-01T12:00:00Z') });
    setFingerprint(db, old.id, fpId, 'B');
    const comps = findComparables(db, fpId, { windowDays: 90, variantAgnostic: false, now: new Date('2026-10-05T12:00:00Z') });
    expect(comps.map((c) => c.askingCents)).toEqual([98_000]);
  });

  it('excludeListingId tira o item avaliado da própria amostra', () => {
    const { id: fpId } = db.insert(fingerprints).values({
      key: 'k2', category: 'celular', brand: 'apple', model: 'iphone 12',
      variant: '128gb-desb', grade: 'B', label: 'iPhone 12 128GB',
    }).returning({ id: fingerprints.id }).get();
    const deal = upsertFromSource(db, input({ askingCents: 60_000 }), { parserVersion: 'olx-1', fingerprintId: fpId, grade: 'B', seenAt: new Date('2026-10-05T12:00:00Z') });
    upsertFromSource(db, input({ externalId: 'olx-ref', askingCents: 150_000 }), { parserVersion: 'olx-1', fingerprintId: fpId, grade: 'B', seenAt: new Date('2026-10-05T12:00:00Z') });

    const all = findComparables(db, fpId, { windowDays: 90, variantAgnostic: false, now: new Date('2026-10-06T12:00:00Z') });
    expect(all.map((c) => c.askingCents).sort((x, y) => x - y)).toEqual([60_000, 150_000]);

    const semODeal = findComparables(db, fpId, {
      windowDays: 90, variantAgnostic: false, now: new Date('2026-10-06T12:00:00Z'), excludeListingId: deal.id,
    });
    expect(semODeal.map((c) => c.askingCents)).toEqual([150_000]);
  });
});
