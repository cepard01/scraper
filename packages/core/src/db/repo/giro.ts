import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../client';
import { purchases, sales } from '../schema';
import type { Category, Cents, Purchase, PurchaseStatus, Sale, Settings } from '../../types';

export interface NewPurchase {
  label: string; category: Category; paidCents: Cents; boughtAt: Date;
  listingId?: number | null; fingerprintId?: number | null; refMedianCents?: Cents | null;
  shippingInCents?: Cents; repairCents?: Cents; otherCostsCents?: Cents; feesInCents?: Cents;
  notes?: string | null;
}

export interface NewSale {
  purchaseId: number; soldCents: Cents; platform: string; soldAt: Date;
  platformFeeCents?: Cents | null;
  shippingOutCents?: Cents; otherCostsCents?: Cents; buyerRef?: string | null;
}

const TERMINAL: PurchaseStatus[] = ['sold', 'returned', 'lost'];

const neg = (name: string, v: Cents): void => {
  if (v < 0) throw new Error(`${name} negativo (${v}); custo de giro entra no banco em centavos positivos`);
};

export function insertPurchase(db: Db, p: NewPurchase): number {
  neg('paidCents', p.paidCents);
  neg('shippingInCents', p.shippingInCents ?? 0);
  neg('repairCents', p.repairCents ?? 0);
  neg('otherCostsCents', p.otherCostsCents ?? 0);
  neg('feesInCents', p.feesInCents ?? 0);

  return db.insert(purchases).values({
    label: p.label,
    category: p.category,
    listingId: p.listingId ?? null,
    fingerprintId: p.fingerprintId ?? null,
    refMedianCents: p.refMedianCents ?? null,
    paidCents: p.paidCents,
    shippingInCents: p.shippingInCents ?? 0,
    repairCents: p.repairCents ?? 0,
    otherCostsCents: p.otherCostsCents ?? 0,
    feesInCents: p.feesInCents ?? 0,
    boughtAt: p.boughtAt,
    status: 'in_stock',
    notes: p.notes ?? null,
    // bought_at, e não new Date(): o repositório de giro é chamado por CLI, painel e teste
    // com o mesmo relógio do registro, e uma data de sistema aqui tornaria o P&L não reproduzível.
    createdAt: p.boughtAt,
  }).returning({ id: purchases.id }).get().id;
}

export function getPurchase(db: Db, id: number): Purchase | null {
  return db.select().from(purchases).where(eq(purchases.id, id)).get() ?? null;
}

export function getSale(db: Db, purchaseId: number): Sale | null {
  return db.select().from(sales).where(eq(sales.purchaseId, purchaseId)).get() ?? null;
}

export function totalCostCents(p: Purchase): Cents {
  return p.paidCents + p.shippingInCents + p.repairCents + p.otherCostsCents + p.feesInCents;
}

export function netProceeds(s: Sale): Cents {
  return s.soldCents - s.platformFeeCents - s.shippingOutCents - s.otherCostsCents;
}

// D6: a taxa efetiva é decidida na escrita e gravada. Mudar settings.platformFeePct depois
// não reescreve venda nenhuma — e por isso a plataforma desconhecida é erro aqui, e não 0.
export function feeFor(soldCents: Cents, platform: string, settings: Settings): Cents {
  const pct = settings.platformFeePct[platform];
  if (pct === undefined) {
    throw new Error(`plataforma "${platform}" sem taxa em settings.platformFeePct; informe platformFeeCents na venda ou cadastre a taxa`);
  }
  return Math.round(soldCents * pct);
}

export function recordSale(db: Db, s: NewSale, settings: Settings): Sale {
  neg('soldCents', s.soldCents);
  neg('shippingOutCents', s.shippingOutCents ?? 0);
  neg('otherCostsCents', s.otherCostsCents ?? 0);

  const p = getPurchase(db, s.purchaseId);
  if (!p) throw new Error(`compra ${s.purchaseId} não existe`);
  if (TERMINAL.includes(p.status)) {
    throw new Error(`compra ${p.id} ("${p.label}") já está em "${p.status}" — a venda dela já foi registrada, e nada aqui sobrescreve giro fechado`);
  }
  if (s.soldAt.getTime() < p.boughtAt.getTime()) {
    throw new Error(`venda de "${p.label}" datada antes da compra (soldAt < boughtAt)`);
  }

  const platformFeeCents = s.platformFeeCents ?? feeFor(s.soldCents, s.platform, settings);

  try {
    return db.transaction((tx) => {
      const sale = tx.insert(sales).values({
        purchaseId: p.id,
        soldCents: s.soldCents,
        platform: s.platform,
        platformFeeCents,
        shippingOutCents: s.shippingOutCents ?? 0,
        otherCostsCents: s.otherCostsCents ?? 0,
        soldAt: s.soldAt,
        buyerRef: s.buyerRef ?? null,
      }).returning().get();
      tx.update(purchases).set({ status: 'sold' }).where(eq(purchases.id, p.id)).run();
      return sale;
    });
  } catch (err) {
    // O check de cima pega o caso comum; o índice único pega a corrida entre worker e painel,
    // e aqui ela vira o mesmo erro nomeando a compra em vez de "SQLITE_CONSTRAINT_UNIQUE".
    if ((err as Error).message.includes('u_sale_purchase') || (err as Error).message.includes('sale.purchase_id')) {
      throw new Error(`compra ${p.id} ("${p.label}") já tem venda registrada — 1 compra = 1 venda (D5)`);
    }
    throw err;
  }
}

export interface InventoryRow {
  purchase: Purchase;
  totalCostCents: Cents;
  daysHeld: number;
}

// daysHeld de estoque é `floor` e pode ser 0; o daysInStock realizado do P&L é `ceil` com piso 1.
// São perguntas diferentes: "há quanto tempo está parado" aceita hoje; "quanto o capital ficou
// preso" nunca é zero, porque giro no mesmo dia é informação, não ausência dela.
export function listInventory(db: Db, now: Date): InventoryRow[] {
  return db.select().from(purchases)
    .where(inArray(purchases.status, ['in_stock', 'listed']))
    .all()
    .map((r) => ({
      purchase: r,
      totalCostCents: totalCostCents(r),
      daysHeld: Math.max(0, Math.floor((now.getTime() - r.boughtAt.getTime()) / 86_400_000)),
    }));
}

// `closedAt` guarda quando este status foi registrado. `sold` não usa esta coluna — a data
// dele é `soldAt`, e duplicar a mesma informação em duas colunas é criar o dia em que elas
// discordam. O P&L só lê `closedAt` em returned|lost, que é onde a perda precisa de mês.
export function closePurchase(db: Db, purchaseId: number, status: 'listed' | 'returned' | 'lost', at: Date): void {
  const p = getPurchase(db, purchaseId);
  if (!p) throw new Error(`compra ${purchaseId} não existe`);
  if (p.status === 'sold') throw new Error(`compra ${purchaseId} foi vendida; o status dela é da venda`);
  if (p.status === 'returned' || p.status === 'lost') throw new Error(`compra ${purchaseId} já está em "${p.status}"`);
  if (status === 'listed' && p.status !== 'in_stock') throw new Error(`compra ${purchaseId} não está em_stock para ser listada`);
  // `listed` não fecha giro: o item continua em estoque, então `closedAt` fica nulo e só
  // returned|lost recebem data. Para `sold` a data é `soldAt`, não esta coluna.
  const patch = status === 'listed' ? { status } : { status, closedAt: at };
  db.update(purchases).set(patch).where(eq(purchases.id, purchaseId)).run();
}
