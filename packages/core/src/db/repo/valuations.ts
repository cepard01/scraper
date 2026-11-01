import { desc, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { comparableRefs, valuations } from '../schema';
import type { Valuation } from '../../types';

export interface ComparableRole {
  listingId: number;
  askingCents: number;
  role: 'kept' | 'trimmed';
}

export function insertValuation(db: Db, fingerprintId: number, v: Valuation, comparables: ComparableRole[]): { id: number } {
  if (v.fingerprintId !== fingerprintId) {
    throw new Error(`insertValuation: fingerprintId ${fingerprintId} != valuation.fingerprintId ${v.fingerprintId}`);
  }
  return db.transaction((tx) => {
    const { id } = tx.insert(valuations).values({
      fingerprintId, sampleSize: v.sampleSize, medianCents: v.medianCents, p25Cents: v.p25Cents,
      p75Cents: v.p75Cents, fairGrossCents: v.fairGrossCents, delta: v.delta,
      liquidityDays: v.liquidityDays, liquiditySource: v.liquiditySource, confidence: v.confidence,
      variantAgnostic: v.variantAgnostic, computedAt: v.computedAt,
    }).returning({ id: valuations.id }).get();
    for (const c of comparables) {
      tx.insert(comparableRefs).values({ valuationId: id, listingId: c.listingId, askingCents: c.askingCents, role: c.role }).run();
    }
    return { id };
  });
}

export function latestValuationFor(db: Db, fingerprintId: number): Valuation | null {
  const r = db.select().from(valuations).where(eq(valuations.fingerprintId, fingerprintId))
    .orderBy(desc(valuations.computedAt)).limit(1).get();
  if (!r) return null;
  return {
    fingerprintId: r.fingerprintId, sampleSize: r.sampleSize, medianCents: r.medianCents,
    p25Cents: r.p25Cents, p75Cents: r.p75Cents, fairGrossCents: r.fairGrossCents, delta: r.delta,
    liquidityDays: r.liquidityDays, liquiditySource: r.liquiditySource,
    confidence: r.confidence, variantAgnostic: r.variantAgnostic, computedAt: r.computedAt,
  };
}
