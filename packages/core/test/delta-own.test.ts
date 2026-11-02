import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import type { Db } from '../src/db/client';
import { DEFAULT_SETTINGS } from '../src/db/seed-settings';
import { getOrCreateFingerprint } from '../src/db/repo/fingerprints';
import { upsertFromSource, setStatus } from '../src/db/repo/listings';
import { insertPurchase, recordSale } from '../src/db/repo/giro';
import { insertValuation, latestValuationFor } from '../src/db/repo/valuations';
import { MEASURED_MIN_SALES, deltaFor, measuredPairs } from '../src/valuation/delta';
import { liquidityFor } from '../src/valuation/liquidity';
import { valueFingerprint } from '../src/valuation/valuation';
import { localAskingProvider } from '../src/valuation/comparables';
import type { Category, ListingInput, ParsedProduct, Settings } from '../src/types';

const DAY = 86_400_000;
const NOW = new Date('2026-11-01T12:00:00Z');

const product: ParsedProduct = {
  category: 'celular', brand: 'apple', model: 'iphone 12',
  variant: '128gb-desbloqueado', grade: 'B', matched: true,
};

const listing = (id: string, ask: number): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx/a/${id}`, title: 'iPhone 12 128GB',
  description: 'usado', askingCents: ask, askingRaw: String(ask), city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null,
});

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
const measured = (over: Partial<Settings> = {}): Settings => settings({ deltaMode: 'measured', ...over });

let db: Db;
beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
});

interface FlipOpts {
  category?: Category;
  fingerprintId?: number | null;
  refMedianCents?: number | null;
  ratio?: number;
  days?: number;
}

const flip = (i: number, opts: FlipOpts = {}) => {
  const ref = opts.refMedianCents === undefined ? 100_000 : opts.refMedianCents;
  const sold = Math.round((ref ?? 100_000) * (opts.ratio ?? 0.9));
  const id = insertPurchase(db, {
    label: `flip ${i}`,
    category: opts.category ?? 'celular',
    paidCents: 50_000,
    boughtAt: new Date(NOW.getTime() - (opts.days ?? 10) * DAY),
    fingerprintId: opts.fingerprintId ?? null,
    refMedianCents: ref,
  });
  recordSale(db, { purchaseId: id, soldCents: sold, platform: 'olx', soldAt: NOW }, settings());
  return id;
};

const flips = (n: number, opts: FlipOpts = {}) => {
  for (let i = 0; i < n; i++) flip(i, opts);
};

const seedComparables = (fingerprintId: number, asks: number[]) => {
  const seenAt = new Date(NOW.getTime() - DAY);
  asks.forEach((ask, i) => {
    upsertFromSource(db, listing(`cmp-${fingerprintId}-${i}`, ask), {
      parserVersion: 'test', fingerprintId, seenAt,
    });
  });
};

const seedGone = (fingerprintId: number, i: number, spanDays: number) => {
  const l = listing(`gone-${fingerprintId}-${i}`, 100_000);
  const { id } = upsertFromSource(db, l, {
    parserVersion: 'test', fingerprintId, seenAt: new Date(NOW.getTime() - spanDays * DAY),
  });
  upsertFromSource(db, l, { parserVersion: 'test', fingerprintId, seenAt: NOW });
  setStatus(db, id, 'gone');
};

describe('delta medido', () => {
  it('deltaMode fixed ignora vendas existentes', () => {
    flips(MEASURED_MIN_SALES + 5);
    expect(deltaFor(db, 'celular', settings({ delta: 0.85, deltaMode: 'fixed' })))
      .toEqual({ delta: 0.85, mode: 'fixed', samples: 0 });
  });

  it('19 vendas continuam em fixed com samples=19', () => {
    flips(19);
    flips(5, { category: 'notebook' });
    insertPurchase(db, {
      label: 'parado sem venda', category: 'celular', paidCents: 50_000,
      boughtAt: NOW, refMedianCents: 100_000,
    });
    expect(deltaFor(db, 'celular', measured({ delta: 0.85 })))
      .toEqual({ delta: 0.85, mode: 'fixed', samples: 19 });
  });

  it('20 vendas viram measured e mudam fairGross', () => {
    flips(MEASURED_MIN_SALES);
    const fp = getOrCreateFingerprint(db, product);
    seedComparables(fp.id, [100_000, 100_000, 100_000, 100_000, 100_000]);

    expect(deltaFor(db, 'celular', measured())).toEqual({ delta: 0.9, mode: 'measured', samples: 20 });

    const res = valueFingerprint(db, fp.id, {
      settings: measured(), now: NOW, provider: localAskingProvider, category: 'celular',
    });
    expect(res.valuation.delta).toBe(0.9);
    expect(res.valuation.fairGrossCents).toBe(90_000);
  });

  it('compra sem refMedianCents não entra na mediana do delta', () => {
    flips(19);
    flip(99, { refMedianCents: null });

    expect(measuredPairs(db, 'celular')).toHaveLength(19);
    expect(deltaFor(db, 'celular', measured({ delta: 0.85 })))
      .toEqual({ delta: 0.85, mode: 'fixed', samples: 19 });
  });

  it('referência zero nao entra como denominador', () => {
    flips(19);
    flip(99, { refMedianCents: 0 });

    expect(measuredPairs(db, 'celular')).toHaveLength(19);
    expect(deltaFor(db, 'celular', measured())).toEqual({ delta: 0.85, mode: 'fixed', samples: 19 });
  });
});

describe('liquidez own', () => {
  it('own liquidez com 3 vendas do mesmo fingerprint vence o market', () => {
    const fp = getOrCreateFingerprint(db, product);
    flip(0, { fingerprintId: fp.id, days: 4 });
    flip(1, { fingerprintId: fp.id, days: 3 });
    flip(2, { fingerprintId: fp.id, days: 2 });
    for (let i = 0; i < 5; i++) seedGone(fp.id, i, 20);

    expect(liquidityFor(db, fp.id, 'celular', settings(), NOW)).toEqual({ days: 3, source: 'own' });
  });

  it('own com 2 vendas cai para market sem mudar liquiditySource para own', () => {
    const fp = getOrCreateFingerprint(db, product);
    flip(0, { fingerprintId: fp.id, days: 2 });
    flip(1, { fingerprintId: fp.id, days: 2 });
    for (let i = 0; i < 5; i++) seedGone(fp.id, i, 20);

    expect(liquidityFor(db, fp.id, 'celular', settings(), NOW)).toEqual({ days: 20, source: 'market' });
  });

  it('vendas de outro fingerprint nao alimentam o own', () => {
    const fp = getOrCreateFingerprint(db, product);
    const outro = getOrCreateFingerprint(db, { ...product, variant: '256gb-desbloqueado' });
    flip(0, { fingerprintId: fp.id, days: 2 });
    flip(1, { fingerprintId: outro.id, days: 2 });
    flip(2, { fingerprintId: outro.id, days: 2 });

    expect(liquidityFor(db, fp.id, 'celular', settings(), NOW))
      .toEqual({ days: 10, source: 'category-default' });
  });
});

describe('transição de delta', () => {
  it('valuation.delta gravado é o valor aplicado, não o settings atual', () => {
    flips(MEASURED_MIN_SALES);
    const fp = getOrCreateFingerprint(db, product);
    seedComparables(fp.id, [100_000, 100_000, 100_000, 100_000, 100_000]);

    const antes = valueFingerprint(db, fp.id, {
      settings: measured(), now: NOW, provider: localAskingProvider, category: 'celular',
    });
    insertValuation(db, fp.id, antes.valuation, antes.comparables);

    const depois = valueFingerprint(db, fp.id, {
      settings: settings({ delta: 0.7, deltaMode: 'fixed' }),
      now: NOW, provider: localAskingProvider, category: 'celular',
    });
    expect(depois.valuation.delta).toBe(0.7);
    expect(depois.valuation.fairGrossCents).toBe(70_000);

    const gravada = latestValuationFor(db, fp.id)!;
    expect(gravada.delta).toBe(0.9);
    expect(gravada.fairGrossCents).toBe(90_000);
  });
});
