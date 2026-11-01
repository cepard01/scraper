import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { listings } from '../db/schema';
import type { Category, Settings, Valuation } from '../types';

export function liquidityFor(
  db: Db,
  fingerprintId: number,
  category: Category,
  settings: Settings,
  now: Date,
): { days: number; source: Valuation['liquiditySource'] } {
  const windowStart = new Date(now.getTime() - 180 * 86_400_000);
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
    const spans = rows.map((r) => Math.max(1, Math.round((r.last.getTime() - r.first.getTime()) / 86_400_000)));
    const avg = Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
    return { days: Math.min(Math.max(avg, 1), 120), source: 'market' };
  }

  return { days: settings.liquidityDefaults[category], source: 'category-default' };
}
