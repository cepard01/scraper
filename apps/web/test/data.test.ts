import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb, type Db } from '@brique/core/db/client';
import { DEFAULT_SETTINGS, seedSettings } from '@brique/core/db/client-helpers';
import { getOrCreateFingerprint } from '@brique/core/db/repo/fingerprints';
import { upsertFromSource } from '@brique/core/db/repo/listings';
import { insertOpportunity } from '@brique/core/db/repo/opportunities';
import { insertDealAlert } from '@brique/core/db/repo/alerts';
import { createMonitor } from '@brique/core/db/repo/monitors';
import { insertPurchase, recordSale } from '@brique/core/db/repo/giro';
import {
  comparableRefs, opportunities, pricePoints, runs, valuations,
} from '@brique/core/db/schema';
import type { ListingInput } from '@brique/core/types';
import { getDeals, getHome, getInventory, getListingDetail, getPnl } from '../src/data';

const T0 = new Date('2026-10-01T12:00:00Z');
const T1 = new Date('2026-10-10T12:00:00Z');
const T2 = new Date('2026-10-11T12:00:00Z');
const NOW = new Date('2026-11-26T12:00:00Z');

const li = (id: string, ask: number): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx.com.br/a/${id}`, title: `iPhone 12 ${id}`,
  description: 'usado', askingCents: ask, askingRaw: `R$ ${ask / 100}`,
  city: 'Curitiba', uf: 'PR', imageUrls: [], sellerRef: null, publishedAt: null,
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
});

function seed() {
  seedSettings(db, DEFAULT_SETTINGS);
  const fp = getOrCreateFingerprint(db, {
    category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado',
    grade: 'B', matched: true,
  });
  const a = upsertFromSource(db, li('A', 250_000), {
    parserVersion: 'olx-rsc-2026-11', fingerprintId: fp.id, seenAt: T1,
  });
  const b = upsertFromSource(db, li('B', 280_000), {
    parserVersion: 'olx-rsc-2026-11', fingerprintId: fp.id, seenAt: T1,
  });
  // upsertFromSource já grava o preço inicial: 3 pontos contando este.
  db.insert(pricePoints).values([
    { listingId: a.id, askingCents: 260_000, observedAt: T0 },
    { listingId: a.id, askingCents: 240_000, observedAt: T2 },
  ]).run();
  const valuationId = db.insert(valuations).values({
    fingerprintId: fp.id, sampleSize: 9, medianCents: 300_000, p25Cents: 280_000,
    p75Cents: 320_000, fairGrossCents: 270_000, delta: 0.9, liquidityDays: 10,
    liquiditySource: 'market', confidence: 'high', variantAgnostic: false, computedAt: T1,
  }).returning({ id: valuations.id }).get().id;
  db.insert(comparableRefs).values({ valuationId, listingId: b.id, askingCents: 280_000, role: 'kept' }).run();

  const opportunityId = insertOpportunity(db, a.id, {
    askingCents: 250_000, fairGrossCents: 270_000, netRealizableCents: 220_000, costsInCents: 30_000,
    marginCents: 20_000, marginPct: 0.08, expectedPerDayCents: 2_000, liquidityDays: 10,
    score: 0.72, breakdown: { profitFactor: 1, liquidityFactor: 0.5, confidenceFactor: 1, freshnessFactor: 0.75 },
  }, { valuationId, gatePassed: true, gateReason: 'ok', createdAt: T1 });
  db.update(opportunities).set({ aiVerdict: 'pass', aiReasons: ['sem indício de golpe'] })
    .where(eq(opportunities.id, opportunityId)).run();
  insertDealAlert(db, {
    opportunityId, listingId: a.id, channel: 'ntfy', alertedAtCents: 250_000,
    status: 'sent', createdAt: T1,
  });

  const monitorId = createMonitor(db, {
    label: 'iphone', source: 'olx', query: 'iphone 12', category: 'celular',
    params: {}, intervalMinutes: 30,
  });
  db.insert(runs).values({ monitorId, startedAt: T1, outcome: 'ok', created: 2 }).run();

  const soldId = insertPurchase(db, {
    label: 'iPhone 12 A', category: 'celular', paidCents: 100_000, boughtAt: T0, listingId: a.id,
  });
  recordSale(db, { purchaseId: soldId, soldCents: 150_000, platform: 'meli', soldAt: T1 }, DEFAULT_SETTINGS);
  const staleId = insertPurchase(db, {
    label: 'iPhone velho', category: 'celular', paidCents: 50_000, boughtAt: new Date('2026-01-01T12:00:00Z'),
  });
  return { a, b, fp, opportunityId, valuationId, soldId, staleId };
}

describe('queries das rotas', () => {
  it('/deals cruza score, IA, alerta e série de preço', () => {
    const { a } = seed();
    const deals = getDeals(db);
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      listingId: a.id, sampleSize: 9, confidence: 'high', aiVerdict: 'pass',
      alertStatus: 'sent', priceCount: 3, lastPriceCents: 240_000, favorite: false,
    });
    expect(deals[0]!.aiReasons).toEqual(['sem indício de golpe']);
  });

  it('/listing/[id] traz fingerprint, comparáveis, série e compra', () => {
    const { a, b } = seed();
    const detail = getListingDetail(db, a.id)!;
    expect(detail.category).toBe('celular');
    expect(detail.fingerprintLabel).toContain('iPhone 12');
    expect(detail.comparables).toHaveLength(1);
    expect(detail.comparables[0]!.listingId).toBe(b.id);
    expect(detail.priceSeries).toHaveLength(3);
    expect(detail.purchase).toMatchObject({ status: 'sold', paidCents: 100_000 });
    expect(getListingDetail(db, 9999)).toBeNull();
  });

  it('/ usa P&L do core e saúde de fonte sem recalcular margem', () => {
    seed();
    const home = getHome(db, 'America/Sao_Paulo');
    expect(home.summary.realizedCents).toBe(26_000); // 150.000 - 16% - 100.000
    expect(home.summary.inventoryValueCents).toBe(50_000);
    expect(home.health).toMatchObject([{ source: 'olx', degraded: false }]);
    expect(home.top).toHaveLength(1);
  });

  it('/inventory e /pnl herdam stale e itens realizados do core', () => {
    const { staleId } = seed();
    const inventory = getInventory(db, NOW, DEFAULT_SETTINGS);
    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({ stale: true, referenceCents: null });
    expect(inventory[0]!.purchase.id).toBe(staleId);

    const pnl = getPnl(db, 'America/Sao_Paulo', NOW, DEFAULT_SETTINGS);
    expect(pnl.items).toHaveLength(1);
    expect(pnl.items[0]!.marginCents).toBe(26_000);
    expect(pnl.stale).toHaveLength(1);
    expect(pnl.categories[0]!.category).toBe('celular');
  });
});
