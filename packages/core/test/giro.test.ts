import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import type { Db } from '../src/db/client';
import { DEFAULT_SETTINGS } from '../src/db/seed-settings';
import { sales } from '../src/db/schema';
import {
  closePurchase, feeFor, getPurchase, getSale, insertPurchase, listInventory,
  netProceeds, recordSale, totalCostCents,
} from '../src/db/repo/giro';
import type { NewPurchase } from '../src/db/repo/giro';
import type { Settings } from '../src/types';

const D = (iso: string) => new Date(iso);
const BUY = D('2026-10-01T12:00:00Z');

const base: NewPurchase = {
  label: 'iPhone 12 128GB', category: 'celular', paidCents: 98_000, boughtAt: BUY,
};

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

let db: Db;
beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
});

describe('repo/giro', () => {
  it('segunda venda na mesma compra falha nomeando a compra', () => {
    const id = insertPurchase(db, base);
    recordSale(db, { purchaseId: id, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings());

    expect(() => recordSale(db, { purchaseId: id, soldCents: 170_000, platform: 'meli', soldAt: D('2026-10-10T12:00:00Z') }, settings()))
      .toThrowError(/iPhone 12 128GB/);
    expect(db.select().from(sales).all()).toHaveLength(1);
  });

  it('venda anterior à compra é recusada', () => {
    const id = insertPurchase(db, base);
    expect(() => recordSale(db, { purchaseId: id, soldCents: 165_000, platform: 'meli', soldAt: D('2026-09-30T12:00:00Z') }, settings()))
      .toThrowError(/soldAt < boughtAt/);
    expect(getPurchase(db, id)!.status).toBe('in_stock');
  });

  it('taxa omitida vem de settings no momento da escrita e fica no banco', () => {
    const id = insertPurchase(db, base);
    const s = recordSale(db, { purchaseId: id, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings());
    expect(s.platformFeeCents).toBe(26_400); // 165.000 x 16% da meli em DEFAULT_SETTINGS
    expect(getSale(db, id)!.platformFeeCents).toBe(26_400);
  });

  it('mudar settings depois não muda a venda já gravada', () => {
    const a = insertPurchase(db, base);
    recordSale(db, { purchaseId: a, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings());

    const novosPct = { meli: 0.05, olx: 0, pagofio: 0.05 };
    db.run(sql`update setting set value = ${JSON.stringify(novosPct)} where key = 'platformFeePct'`);

    expect(getSale(db, a)!.platformFeeCents).toBe(26_400);
    const b = insertPurchase(db, { ...base, label: 'segundo' });
    const s2 = recordSale(db, { purchaseId: b, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-11T12:00:00Z') }, settings({ platformFeePct: novosPct }));
    expect(s2.platformFeeCents).toBe(8_250);
  });

  it('plataforma sem taxa cadastrada recusa a venda em vez de cobrar zero', () => {
    const id = insertPurchase(db, base);
    expect(() => recordSale(db, { purchaseId: id, soldCents: 165_000, platform: 'meii', soldAt: D('2026-10-09T12:00:00Z') }, settings()))
      .toThrowError(/meii/);
    expect(db.select().from(sales).all()).toHaveLength(0);
  });

  it('venda em compra returned é recusada', () => {
    const id = insertPurchase(db, base);
    closePurchase(db, id, 'returned', D('2026-10-05T12:00:00Z'));
    expect(() => recordSale(db, { purchaseId: id, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings()))
      .toThrowError(/returned/);
  });

  it('totalCostCents soma as cinco parcelas e nada mais', () => {
    const id = insertPurchase(db, {
      ...base, shippingInCents: 2_500, repairCents: 3_000, otherCostsCents: 1_000, feesInCents: 500,
    });
    const p = getPurchase(db, id)!;
    expect(totalCostCents(p)).toBe(105_000);
    // refMedianCents é referência de valoração, não custo: se alguém somar, o P&L mente.
    expect(p.refMedianCents).toBeNull();
  });

  it('netProceeds desconta taxa, frete de saída e outros custos', () => {
    const id = insertPurchase(db, base);
    const s = recordSale(db, {
      purchaseId: id, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z'),
      platformFeeCents: 26_400, shippingOutCents: 3_000, otherCostsCents: 700,
    }, settings());
    expect(netProceeds(s)).toBe(134_900);
  });

  it('listInventory traz só o que não girou, com dias parados', () => {
    const emEstoque = insertPurchase(db, { ...base, label: 'parado' });
    const vendido = insertPurchase(db, { ...base, label: 'virou dinheiro' });
    recordSale(db, { purchaseId: vendido, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings());

    const rows = listInventory(db, D('2026-10-12T00:00:00Z'));
    expect(rows.map((r) => r.purchase.label)).toEqual(['parado']);
    expect(rows[0]!.totalCostCents).toBe(98_000);
    expect(rows[0]!.daysHeld).toBe(10);

    expect(listInventory(db, BUY)[0]!.daysHeld).toBe(0);
  });

  it('closePurchase não sobrescreve compra vendida nem ressuscita terminal', () => {
    const id = insertPurchase(db, base);
    recordSale(db, { purchaseId: id, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings());
    expect(() => closePurchase(db, id, 'lost', D('2026-10-10T12:00:00Z'))).toThrowError(/vendida/);

    const outro = insertPurchase(db, { ...base, label: 'devolvido' });
    const fechamento = D('2026-10-07T12:00:00Z');
    closePurchase(db, outro, 'returned', fechamento);
    expect(getPurchase(db, outro)!.closedAt).toEqual(fechamento);
    expect(() => closePurchase(db, outro, 'lost', D('2026-10-08T12:00:00Z'))).toThrowError(/returned/);
  });

  it('listed não fecha o giro: closedAt continua null', () => {
    const id = insertPurchase(db, base);
    closePurchase(db, id, 'listed', D('2026-10-03T12:00:00Z'));

    const p = getPurchase(db, id)!;
    expect(p.status).toBe('listed');
    expect(p.closedAt).toBeNull();
  });

  it('recordSale não grava closed_at: a data de sold é sold_at', () => {
    const id = insertPurchase(db, base);
    recordSale(db, { purchaseId: id, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings());
    expect(getPurchase(db, id)!.closedAt).toBeNull();
  });

  it('centavo negativo é recusado na entrada, não absinto em saldo', () => {
    expect(() => insertPurchase(db, { ...base, repairCents: -100 })).toThrowError(/repairCents/);
    const id = insertPurchase(db, base);
    expect(() => recordSale(db, { purchaseId: id, soldCents: -1, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings()))
      .toThrowError(/soldCents/);
  });

  it('feeFor arredonda o centavo da taxa e é a única origem do valor derivado', () => {
    expect(feeFor(165_000, 'meli', settings())).toBe(26_400);
    expect(feeFor(999, 'meli', settings())).toBe(160);
    expect(feeFor(999, 'olx', settings())).toBe(0);
  });

  it('created_at é bought_at: nada do giro depende do relógio do sistema', () => {
    const id = insertPurchase(db, base);
    const row = db.all<{ created_at: number }>(sql`select created_at from purchase where id = ${id}`)[0]!;
    expect(row.created_at).toBe(BUY.getTime());
  });
});

describe('migração real', () => {
  // D5 é o índice único do banco garantindo, não o repositório decidindo: um insert cru que
  // pule o repo — é o que um painel concorrente com o worker faria — precisa bater nele.
  it('o índice único de venda existe no banco aplicado e recusa o insert cru', () => {
    const idx = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'index' and name = 'u_sale_purchase'`);
    expect(idx).toHaveLength(1);

    const id = insertPurchase(db, base);
    recordSale(db, { purchaseId: id, soldCents: 165_000, platform: 'meli', soldAt: D('2026-10-09T12:00:00Z') }, settings());

    const cru = { purchaseId: id, soldCents: 99_000, platform: 'olx', platformFeeCents: 0, soldAt: BUY, buyerRef: null, shippingOutCents: 0, otherCostsCents: 0 };
    expect(() => db.insert(sales).values(cru).run()).toThrowError(/u_sale_purchase|UNIQUE/);
  });

  it('venda cru sem compra correspondente é recusa de foreign key', () => {
    const orfa = { purchaseId: 999, soldCents: 1, platform: 'olx', platformFeeCents: 0, soldAt: BUY, buyerRef: null, shippingOutCents: 0, otherCostsCents: 0 };
    expect(() => db.insert(sales).values(orfa).run()).toThrowError(/FOREIGN KEY constraint failed/);
  });
});
