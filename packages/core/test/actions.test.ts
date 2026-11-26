import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb, type Db } from '../src/db/client';
import { DEFAULT_SETTINGS, loadSettings, seedSettings } from '../src/db/seed-settings';
import { listings } from '../src/db/schema';
import { upsertFromSource } from '../src/db/repo/listings';
import { insertOpportunity } from '../src/db/repo/opportunities';
import { insertDealAlert, listDealAlertsForListing } from '../src/db/repo/alerts';
import { listMonitors } from '../src/db/repo/monitors';
import { actions, withBusyRetry } from '../src/repo/actions';
import type { ListingInput } from '../src/types';

const AT = new Date('2026-11-26T12:00:00Z');

const listingInput = (id: string): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx.com.br/a/${id}`, title: `iPhone ${id}`,
  description: '', askingCents: 200_000, askingRaw: 'R$ 2.000,00', city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null,
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
  seedSettings(db, DEFAULT_SETTINGS);
});

function makeListing(id = 'A') {
  const { id: listingId } = upsertFromSource(db, listingInput(id), {
    parserVersion: 'olx-rsc-2026-11', seenAt: AT,
  });
  const opportunityId = insertOpportunity(db, listingId, {
    askingCents: 200_000, fairGrossCents: null, netRealizableCents: null, costsInCents: 0,
    marginCents: null, marginPct: null, expectedPerDayCents: null, liquidityDays: 10,
    score: 0.5, breakdown: { profitFactor: 1, liquidityFactor: 1, confidenceFactor: 1, freshnessFactor: 1 },
  }, { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: AT });
  insertDealAlert(db, { opportunityId, listingId, channel: 'ntfy', alertedAtCents: 200_000, status: 'sent', createdAt: AT });
  return listingId;
}

describe('withBusyRetry', () => {
  it('espera o SQLITE_BUSY e tenta de novo', () => {
    let calls = 0;
    const result = withBusyRetry(() => {
      calls++;
      if (calls < 3) throw new Error('database is locked');
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toBe(3);
  });

  it('não engole erro que não é de lock', () => {
    expect(() => withBusyRetry(() => { throw new Error('settings inválidos: floor'); }))
      .toThrowError(/settings inválidos/);
  });
});

describe('actions', () => {
  it('markBought muda o status e assume o último alerta', () => {
    const id = makeListing();
    expect(actions.markBought(db, { listingId: id, at: AT })).toEqual({ ok: true });
    const alert = listDealAlertsForListing(db, id)[0]!;
    expect(db.select().from(listings).where(eq(listings.id, id)).get()!.status).toBe('bought');
    expect(alert.action).toBe('taken');
    expect(alert.ackAt).toEqual(AT);
  });

  it('markIgnored encerra o anúncio e registra ignored', () => {
    const id = makeListing('B');
    expect(actions.markIgnored(db, { listingId: id, at: AT })).toEqual({ ok: true });
    expect(db.select().from(listings).where(eq(listings.id, id)).get()!.status).toBe('ignored');
    expect(listDealAlertsForListing(db, id)[0]!.action).toBe('ignored');
  });

  it('markFavorite alterna sem mexer no status nem no score', () => {
    const id = makeListing('C');
    expect(actions.markFavorite(db, { listingId: id, favorite: true })).toEqual({ ok: true });
    expect(db.select().from(listings).where(eq(listings.id, id)).get()!.favorite).toBe(true);
    expect(db.select().from(listings).where(eq(listings.id, id)).get()!.status).toBe('new');
    expect(actions.markFavorite(db, { listingId: id, favorite: false })).toEqual({ ok: true });
    expect(db.select().from(listings).where(eq(listings.id, id)).get()!.favorite).toBe(false);
  });

  it('ação em anúncio inexistente devolve erro sem lançar', () => {
    expect(actions.markBought(db, { listingId: 999 })).toEqual({ ok: false, error: 'anúncio 999 não encontrado' });
  });

  it('CRUD de monitor respeita o piso de 15 min e o active', () => {
    const created = actions.createMonitor(db, {
      label: 'iphone', source: 'olx', query: 'iphone 12', category: 'celular',
      params: {}, intervalMinutes: 20,
    });
    expect(created.ok).toBe(true);
    const id = (created as { ok: true; id: number }).id!;
    expect(actions.updateMonitor(db, id, { intervalMinutes: 30, label: 'iphone 12' })).toEqual({ ok: true });
    expect(actions.setActiveMonitor(db, id, false)).toEqual({ ok: true });
    expect(listMonitors(db)[0]).toMatchObject({ label: 'iphone 12', intervalMinutes: 30, active: false });

    expect(actions.updateMonitor(db, id, { intervalMinutes: 14 }))
      .toEqual({ ok: false, error: 'monitor "iphone 12" com intervalMinutes=14; mínimo 15' });
    expect(actions.createMonitor(db, {
      label: 'curto', source: 'olx', query: 'x', category: null, params: {}, intervalMinutes: 14,
    })).toEqual({ ok: false, error: 'monitor "curto" com intervalMinutes=14; mínimo 15' });
  });

  it('recordPurchase/recordSale delegam ao giro e setSettings valida antes de gravar', () => {
    const bought = actions.recordPurchase(db, {
      label: 'iPhone 12', category: 'celular', paidCents: 98_000, boughtAt: new Date('2026-10-01T12:00:00Z'),
    });
    const purchaseId = (bought as { ok: true; id: number }).id!;
    const sold = actions.recordSale(db, {
      purchaseId, soldCents: 165_000, platform: 'meli', soldAt: new Date('2026-10-09T12:00:00Z'),
    }, loadSettings(db));
    expect(sold.ok).toBe(true);
    expect(actions.setSettings(db, { floorMarginPct: 0.4 })).toEqual({ ok: true });
    expect(loadSettings(db).floorMarginPct).toBe(0.4);
    expect(actions.setSettings(db, { floorMarginPct: -1 }))
      .toEqual({ ok: false, error: 'settings inválidos: floorMarginPct' });
    expect(loadSettings(db).floorMarginPct).toBe(0.4);
  });
});
