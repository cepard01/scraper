import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { migrateDb, openDb } from '../src/db/client';
import type { Db } from '../src/db/client';
import { DEFAULT_SETTINGS } from '../src/db/seed-settings';
import { closePurchase, insertPurchase, recordSale } from '../src/db/repo/giro';
import type { NewPurchase } from '../src/db/repo/giro';
import { categoryStats, inventoryValue, monthKey, pnlSummary, realizedFor, stalePurchases } from '../src/pnl';

const D = (iso: string) => new Date(iso);
const TZ = 'America/Sao_Paulo';

const base: NewPurchase = {
  label: 'iPhone 12 128GB', category: 'celular', paidCents: 80_000, boughtAt: D('2026-10-01T12:00:00Z'),
};

let db: Db;
beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
});

const buy = (over: Partial<NewPurchase> = {}): number => insertPurchase(db, { ...base, ...over });
const sell = (purchaseId: number, over: Record<string, unknown> = {}) =>
  recordSale(db, { purchaseId, soldCents: 100_000, platform: 'olx', soldAt: D('2026-10-11T12:00:00Z'), ...over }, DEFAULT_SETTINGS);

describe('core/pnl', () => {
  it('lucro realizado de um flip conhecido bate ao centavo', () => {
    const id = buy();
    sell(id);

    const r = realizedFor(db, id)!;
    expect(r.totalCostCents).toBe(80_000);
    expect(r.soldCents).toBe(100_000);
    expect(r.netProceedsCents).toBe(100_000);
    expect(r.marginCents).toBe(20_000);
    expect(r.roiPct).toBe(0.25);
    expect(r.daysInStock).toBe(10);
  });

  it('roi é margin/totalCost e não margin/revenue', () => {
    const id = buy();
    sell(id);

    const r = realizedFor(db, id)!;
    // margin/revenue daria 0,20; o capital emperrado é 80.000 e o retorno real é 25%.
    expect(r.roiPct).toBeCloseTo(0.25, 10);
    expect(r.roiPct).not.toBeCloseTo(0.2, 10);
  });

  it('mesmo dia conta 1 dia de estoque', () => {
    const id = buy({ boughtAt: D('2026-10-01T09:00:00Z') });
    sell(id, { soldAt: D('2026-10-01T18:00:00Z') });

    expect(realizedFor(db, id)!.daysInStock).toBe(1);
  });

  it('fração de dia conta como dia cheio (ceil)', () => {
    const id = buy({ boughtAt: D('2026-10-01T12:00:00Z') });
    sell(id, { soldAt: D('2026-10-11T18:00:00Z') }); // 10 dias e 6 horas de capital preso

    expect(realizedFor(db, id)!.daysInStock).toBe(11);
  });

  it('compra e venda no mesmo instante contam 1 dia, não 0', () => {
    const id = buy({ boughtAt: D('2026-10-01T12:00:00Z') });
    sell(id, { soldAt: D('2026-10-01T12:00:00Z') });

    expect(realizedFor(db, id)!.daysInStock).toBe(1);
  });

  it('venda às 22h de 31/10 é outubro, não novembro', () => {
    // 2026-11-01T01:00Z = 22:00 de 31/10 em America/Sao_Paulo (UTC-3, sem horário de verão).
    const at = D('2026-11-01T01:00:00Z');
    expect(monthKey(at, TZ)).toBe('2026-10');

    const id = buy();
    sell(id, { soldAt: at });

    const s = pnlSummary(db, { tz: TZ });
    expect(s.byMonth.map((m) => m.month)).toEqual(['2026-10']);
  });

  it('itens in_stock entram no capital em estoque e nunca no lucro', () => {
    buy({ label: 'parado' });
    const vendido = buy({ label: 'girado' });
    sell(vendido);

    const s = pnlSummary(db, { tz: TZ });
    expect(s.inventoryValueCents).toBe(80_000);
    expect(s.inventoryCount).toBe(1);
    expect(s.realizedCents).toBe(20_000);
    expect(s.revenueCents).toBe(100_000);
    expect(s.byMonth).toHaveLength(1);
    expect(s.byMonth[0]!.soldCount).toBe(1);
  });

  it('purchase returned: custo realizado, receita zero, margem negativa', () => {
    const id = buy({ paidCents: 78_000, shippingInCents: 2_000 });
    closePurchase(db, id, 'returned', D('2026-10-20T12:00:00Z'));

    const r = realizedFor(db, id)!;
    expect(r.totalCostCents).toBe(80_000);
    expect(r.soldCents).toBe(0);
    expect(r.netProceedsCents).toBe(0);
    expect(r.marginCents).toBe(-80_000);
    expect(r.roiPct).toBe(-1);
    expect(r.daysInStock).toBe(19);

    const s = pnlSummary(db, { tz: TZ });
    expect(s.revenueCents).toBe(0);
    expect(s.costCents).toBe(80_000);
    expect(s.realizedCents).toBe(-80_000);
    expect(s.soldCount).toBe(0);
    expect(s.avgDaysInStock).toBeNull();
    expect(s.byMonth).toEqual([{ month: '2026-10', revenueCents: 0, costCents: 80_000, realizedCents: -80_000, soldCount: 0 }]);
  });

  it('resumo vazio com zero compra não divide por zero', () => {
    const s = pnlSummary(db, { tz: TZ });
    expect(s.realizedCents).toBe(0);
    expect(s.roiPct).toBeNull();
    expect(s.avgDaysInStock).toBeNull();
    expect(s.inventoryCount).toBe(0);
    expect(s.byMonth).toEqual([]);
  });

  it('mudar taxPct/settings não altera um P&L já gravado', () => {
    const id = buy();
    // MELI grava 16% no momento da venda; o P&L lê o valor gravado, não recalcula settings.
    sell(id, { platform: 'meli' });
    expect(realizedFor(db, id)!.marginCents).toBe(4_000);

    db.run(sql`update setting set value = '{"meli":0.99,"olx":0,"pagofio":0.05}' where key = 'platformFeePct'`);
    const r = realizedFor(db, id)!;
    expect(r.feesCents).toBe(16_000);
    expect(r.marginCents).toBe(4_000);
    expect(pnlSummary(db, { tz: TZ }).realizedCents).toBe(4_000);
  });

  it('sold sem venda nomeia a compra em vez de sumir com o dinheiro', () => {
    const id = buy();
    db.run(sql`update purchase set status = 'sold' where id = ${id}`);

    expect(() => realizedFor(db, id)).toThrowError(/iPhone 12 128GB/);
    expect(() => pnlSummary(db, { tz: TZ })).toThrowError(/iPhone 12 128GB/);
    expect(() => categoryStats(db)).toThrowError(/iPhone 12 128GB/);
  });

  it('roi é null num mês sem venda (não 0)', () => {
    buy();
    const s = pnlSummary(db, { tz: TZ });
    expect(s.soldCount).toBe(0);
    expect(s.roiPct).toBeNull();
    expect(s.roiPct).not.toBe(0);
  });

  it('o mês de um returned é o mês de closedAt', () => {
    const id = buy({ boughtAt: D('2026-09-20T12:00:00Z') });
    closePurchase(db, id, 'lost', D('2026-11-05T15:00:00Z'));

    const s = pnlSummary(db, { tz: TZ });
    expect(s.byMonth.map((m) => m.month)).toEqual(['2026-11']);
  });

  it('categoryStats ordena por realizado desc', () => {
    const celular = buy();
    sell(celular);
    const notebook = buy({ label: 'Notebook', category: 'notebook', paidCents: 100_000 });
    sell(notebook, { soldCents: 110_000 });

    const stats = categoryStats(db);
    expect(stats.map((s) => s.category)).toEqual(['celular', 'notebook']);
    expect(stats[0]!.realizedCents).toBe(20_000);
    expect(stats[1]!.realizedCents).toBe(10_000);
  });

  it('resumo por categoria nao soma a outra categoria, mas o estoque continua global', () => {
    const celular = buy();
    sell(celular);
    const notebook = buy({ label: 'Notebook', category: 'notebook', paidCents: 100_000 });
    sell(notebook, { soldCents: 110_000 });
    buy({ label: 'parado', category: 'notebook', paidCents: 100_000 });

    const s = pnlSummary(db, { tz: TZ, category: 'celular' });
    expect(s.revenueCents).toBe(100_000);
    expect(s.costCents).toBe(80_000);
    expect(s.realizedCents).toBe(20_000);
    expect(s.soldCount).toBe(1);
    expect(s.byMonth).toEqual([{ month: '2026-10', revenueCents: 100_000, costCents: 80_000, realizedCents: 20_000, soldCount: 1 }]);
    expect(s.inventoryCount).toBe(1);
    expect(s.inventoryValueCents).toBe(100_000);
  });

  it('stalePurchases usa > metaStaleDays e ignora vendido', () => {
    buy({ label: 'encalhado', boughtAt: D('2026-10-01T12:00:00Z') });
    buy({ label: 'novo', boughtAt: D('2026-10-31T12:00:00Z') });
    const vendido = buy({ label: 'vendido', boughtAt: D('2026-09-01T12:00:00Z') });
    sell(vendido, { soldAt: D('2026-10-10T12:00:00Z') });

    const stale = stalePurchases(db, D('2026-11-10T12:00:00Z'), DEFAULT_SETTINGS);
    expect(stale.map((r) => r.purchase.label)).toEqual(['encalhado']);
    expect(inventoryValue(db, D('2026-11-10T12:00:00Z'))).toEqual({ inventoryValueCents: 160_000, inventoryCount: 2 });
  });
});
