import { desc, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { comparableRefs, valuations } from '../schema';
import type { Confidence, Valuation } from '../../types';

export interface ComparableRole {
  listingId: number;
  askingCents: number;
  role: 'kept' | 'trimmed';
}

export function insertValuation(db: Db, fingerprintId: number, v: Valuation, comparables: ComparableRole[]): { id: number } {
  const { id } = db.insert(valuations).values({
    fingerprintId, sampleSize: v.sampleSize, medianCents: v.medianCents, p25Cents: v.p25Cents,
    p75Cents: v.p75Cents, fairGrossCents: v.fairGrossCents, delta: v.delta,
    liquidityDays: v.liquidityDays, liquiditySource: v.liquiditySource, confidence: v.confidence,
    variantAgnostic: v.variantAgnostic, computedAt: v.computedAt,
  }).returning({ id: valuations.id }).get();
  for (const c of comparables) {
    db.insert(comparableRefs).values({ valuationId: id, listingId: c.listingId, askingCents: c.askingCents, role: c.role }).run();
  }
  return { id };
}

export function latestValuationFor(db: Db, fingerprintId: number): Valuation | null {
  const r = db.select().from(valuations).where(eq(valuations.fingerprintId, fingerprintId))
    .orderBy(desc(valuations.computedAt)).limit(1).get();
  if (!r) return null;
  return {
    fingerprintId: r.fingerprintId, sampleSize: r.sampleSize, medianCents: r.medianCents,
    p25Cents: r.p25Cents, p75Cents: r.p75Cents, fairGrossCents: r.fairGrossCents, delta: r.delta,
    liquidityDays: r.liquidityDays, liquiditySource: r.liquiditySource as Valuation['liquiditySource'],
    confidence: r.confidence as Confidence, variantAgnostic: r.variantAgnostic, computedAt: r.computedAt,
  };
}
