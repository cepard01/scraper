import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { listings, purchases, sales } from '../db/schema';
import type { Category, Settings, Valuation } from '../types';
import { median } from './median';

const DAY_MS = 86_400_000;
const OWN_MIN_SALES = 3;

export function liquidityFor(
  db: Db,
  fingerprintId: number,
  category: Category,
  settings: Settings,
  now: Date,
): { days: number; source: Valuation['liquiditySource'] } {
  const ownRows = db.select({
      boughtAt: purchases.boughtAt,
      soldAt: sales.soldAt,
    })
    .from(sales)
    .innerJoin(purchases, eq(purchases.id, sales.purchaseId))
    .where(eq(purchases.fingerprintId, fingerprintId))
    .all();

  if (ownRows.length >= OWN_MIN_SALES) {
    const spans = ownRows.map((r) => Math.max(1, Math.round((r.soldAt.getTime() - r.boughtAt.getTime()) / DAY_MS)));
    const dias = Math.round(median(spans)!);
    return { days: Math.min(Math.max(dias, 1), 120), source: 'own' };
  }

  const windowStart = new Date(now.getTime() - 180 * DAY_MS);
  const rows = db.select({
      first: listings.firstSeenAt,
      last: listings.lastSeenAt,
    })
    .from(listings)
    .where(and(
      eq(listings.fingerprintId, fingerprintId),
      eq(listings.status, 'gone'),
      gte(listings.lastSeenAt, windowStart),
    ))
    .all();

  if (rows.length >= 5) {
    const spans = rows.map((r) => Math.max(1, Math.round((r.last.getTime() - r.first.getTime()) / DAY_MS)));
    const avg = Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
    return { days: Math.min(Math.max(avg, 1), 120), source: 'market' };
  }

  return { days: settings.liquidityDefaults[category], source: 'category-default' };
}
