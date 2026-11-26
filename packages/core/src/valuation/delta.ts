import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { purchases, sales } from '../db/schema';
import type { Category, Settings } from '../types';
import { median } from './median';

export const MEASURED_MIN_SALES = 20;

export function measuredPairs(db: Db, category: Category): number[] {
  return db.select({
      soldCents: sales.soldCents,
      refMedianCents: purchases.refMedianCents,
    })
    .from(sales)
    .innerJoin(purchases, eq(purchases.id, sales.purchaseId))
    .where(and(
      eq(purchases.category, category),
      gt(purchases.refMedianCents, 0),
    ))
    .all()
    .map((r) => r.soldCents / r.refMedianCents!);
}

export function deltaFor(
  db: Db,
  category: Category,
  s: Settings,
): { delta: number; mode: 'fixed' | 'measured'; samples: number } {
  if (s.deltaMode !== 'measured') return { delta: s.delta, mode: 'fixed', samples: 0 };

  const rows = measuredPairs(db, category);
  if (rows.length < MEASURED_MIN_SALES) return { delta: s.delta, mode: 'fixed', samples: rows.length };
  return { delta: median(rows)!, mode: 'measured', samples: rows.length };
}
