import { eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { purchases, sales } from './db/schema';
import { getPurchase, getSale, listInventory, netProceeds, totalCostCents } from './db/repo/giro';
import type { Category, Cents, Purchase, PurchaseStatus, Sale, Settings } from './types';

const DAY_MS = 86_400_000;

export interface RealizedPnl {
  purchaseId: number;
  label: string;
  category: Category;
  totalCostCents: Cents;
  soldCents: Cents;
  feesCents: Cents;
  shippingOutCents: Cents;
  otherCostsCents: Cents;
  netProceedsCents: Cents;
  marginCents: Cents;
  roiPct: number | null;
  daysInStock: number;
  soldAt: Date;
  boughtAt: Date;
}

type RealizedRow = RealizedPnl & { status: PurchaseStatus };

// Chave de mês na tz de exibição, nunca em SQL: uma venda noturna de 31/10 em São Paulo
// pertence a outubro, e `strftime` em UTC a jogaria para novembro (§3.1 / D4).
export function monthKey(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(at);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return `${year}-${month}`;
}

// Giro no mesmo dia conta 1, não 0: um zero no divisor de dias médios quebraria a média
// sem dizer nada de verdadeiro. `daysHeld` de estoque é floor e pode ser 0 (giro.ts:125-127).
function daysInStock(boughtAt: Date, at: Date): number {
  return Math.max(1, Math.ceil((at.getTime() - boughtAt.getTime()) / DAY_MS));
}

function toRealized(p: Purchase, sale: Sale | null): RealizedRow | null {
  const totalCost = totalCostCents(p);

  if (p.status === 'in_stock' || p.status === 'listed') return null;

  if (p.status === 'sold') {
    if (!sale) throw new Error(`compra ${p.id} ("${p.label}") está em "sold" sem venda registrada`);
    const net = netProceeds(sale);
    const margin = net - totalCost;
    return {
      purchaseId: p.id, label: p.label, category: p.category,
      totalCostCents: totalCost, soldCents: sale.soldCents, feesCents: sale.platformFeeCents,
      shippingOutCents: sale.shippingOutCents, otherCostsCents: sale.otherCostsCents,
      netProceedsCents: net, marginCents: margin,
      roiPct: totalCost > 0 ? margin / totalCost : null,
      daysInStock: daysInStock(p.boughtAt, sale.soldAt),
      soldAt: sale.soldAt, boughtAt: p.boughtAt, status: p.status,
    };
  }

  // returned|lost: o dinheiro e o produto foram embora, a receita é zero e a perda é o custo.
  // O mês é o de `closedAt`, que é a única data de fechamento desses dois status; `sold` usa
  // `soldAt`, e duplicar a mesma informação em duas colunas é criar o dia em que discordam.
  if (sale) throw new Error(`compra ${p.id} ("${p.label}") está em "${p.status}" mas tem venda registrada`);
  if (!p.closedAt) throw new Error(`compra ${p.id} ("${p.label}") está em "${p.status}" sem closed_at — a perda não tem mês`);
  const margin = -totalCost;
  return {
    purchaseId: p.id, label: p.label, category: p.category,
    totalCostCents: totalCost, soldCents: 0, feesCents: 0, shippingOutCents: 0, otherCostsCents: 0,
    netProceedsCents: 0, marginCents: margin,
    roiPct: totalCost > 0 ? -1 : null,
    daysInStock: daysInStock(p.boughtAt, p.closedAt),
    soldAt: p.closedAt, boughtAt: p.boughtAt, status: p.status,
  };
}

function realizedRows(db: Db): RealizedRow[] {
  const rows = db
    .select({ purchase: purchases, sale: sales })
    .from(purchases)
    .leftJoin(sales, eq(sales.purchaseId, purchases.id))
    .all();
  const out: RealizedRow[] = [];
  for (const { purchase, sale } of rows) {
    const r = toRealized(purchase, sale);
    if (r) out.push(r);
  }
  return out;
}

export function realizedFor(db: Db, purchaseId: number): RealizedPnl | null {
  const p = getPurchase(db, purchaseId);
  if (!p) return null;
  return toRealized(p, getSale(db, purchaseId));
}

function inPeriod(at: Date, from?: Date, to?: Date): boolean {
  if (from && at.getTime() < from.getTime()) return false;
  if (to && at.getTime() > to.getTime()) return false;
  return true;
}

export interface PnlSummary {
  from?: Date;
  to?: Date;
  realizedCents: Cents;
  revenueCents: Cents;
  costCents: Cents;
  soldCount: number;
  roiPct: number | null;
  avgDaysInStock: number | null;
  inventoryValueCents: Cents;
  inventoryCount: number;
  byMonth: Array<{ month: string; revenueCents: Cents; costCents: Cents; realizedCents: Cents; soldCount: number }>;
}

// roiPct = margin / totalCost, não / soldCents: a pergunta é "por real emperrado, quanto
// voltou", e totalCost é o que estava emperrado. Divisão por zero é `null`, nunca 0 — um
// `roiPct: 0` num mês sem venda seria uma afirmação falsa.
export function pnlSummary(db: Db, opts: { from?: Date; to?: Date; tz: string }): PnlSummary {
  const rows = realizedRows(db).filter((r) => inPeriod(r.soldAt, opts.from, opts.to));

  let revenueCents = 0;
  let costCents = 0;
  let realizedCents = 0;
  let soldOnlyDays = 0;
  let soldOnlyCount = 0;

  const byMonthMap = new Map<string, { revenueCents: number; costCents: number; realizedCents: number; soldCount: number }>();
  for (const r of rows) {
    revenueCents += r.soldCents;
    costCents += r.totalCostCents;
    realizedCents += r.marginCents;
    if (r.status === 'sold') {
      soldOnlyCount += 1;
      soldOnlyDays += r.daysInStock;
    }
    const key = monthKey(r.soldAt, opts.tz);
    const m = byMonthMap.get(key) ?? { revenueCents: 0, costCents: 0, realizedCents: 0, soldCount: 0 };
    m.revenueCents += r.soldCents;
    m.costCents += r.totalCostCents;
    m.realizedCents += r.marginCents;
    if (r.status === 'sold') m.soldCount += 1;
    byMonthMap.set(key, m);
  }

  const byMonth = Array.from(byMonthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  // `now` só governa daysHeld, que o valor de estoque não lê; o recorte é determinístico.
  const inv = inventoryValue(db, new Date(0));

  return {
    from: opts.from, to: opts.to,
    realizedCents, revenueCents, costCents,
    soldCount: soldOnlyCount,
    roiPct: costCents > 0 ? realizedCents / costCents : null,
    avgDaysInStock: soldOnlyCount > 0 ? soldOnlyDays / soldOnlyCount : null,
    inventoryValueCents: inv.inventoryValueCents,
    inventoryCount: inv.inventoryCount,
    byMonth,
  };
}

export interface CategoryStat {
  category: Category;
  soldCount: number;
  revenueCents: Cents;
  costCents: Cents;
  realizedCents: Cents;
  roiPct: number | null;
}

export function categoryStats(db: Db, opts: { from?: Date; to?: Date } = {}): CategoryStat[] {
  const map = new Map<Category, { soldCount: number; revenueCents: number; costCents: number; realizedCents: number }>();
  for (const r of realizedRows(db)) {
    if (!inPeriod(r.soldAt, opts.from, opts.to)) continue;
    const cur = map.get(r.category) ?? { soldCount: 0, revenueCents: 0, costCents: 0, realizedCents: 0 };
    if (r.status === 'sold') cur.soldCount += 1;
    cur.revenueCents += r.soldCents;
    cur.costCents += r.totalCostCents;
    cur.realizedCents += r.marginCents;
    map.set(r.category, cur);
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({
      category,
      soldCount: v.soldCount,
      revenueCents: v.revenueCents,
      costCents: v.costCents,
      realizedCents: v.realizedCents,
      roiPct: v.costCents > 0 ? v.realizedCents / v.costCents : null,
    }))
    .sort((a, b) => b.realizedCents - a.realizedCents || a.category.localeCompare(b.category));
}

// Encalhado é "> staleDays" (spec §7), não ">=": no dia 30 o item ainda está no prazo.
export function stalePurchases(db: Db, now: Date, settings: Settings) {
  return listInventory(db, now).filter((r) => r.daysHeld > settings.metaStaleDays);
}

export function inventoryValue(db: Db, now: Date): { inventoryValueCents: Cents; inventoryCount: number } {
  const inv = listInventory(db, now);
  return {
    inventoryValueCents: inv.reduce((acc, r) => acc + r.totalCostCents, 0),
    inventoryCount: inv.length,
  };
}
