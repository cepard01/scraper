import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { listings, opportunities, valuations } from '../schema';
import type { Confidence, GateReason, OpportunityMath } from '../../types';

export function insertOpportunity(
  db: Db,
  listingId: number,
  m: OpportunityMath,
  opts: { valuationId: number | null; gatePassed: boolean; gateReason: GateReason; createdAt: Date },
): number {
  return db.insert(opportunities).values({
    listingId, valuationId: opts.valuationId, askingCents: m.askingCents,
    fairGrossCents: m.fairGrossCents, costsInCents: m.costsInCents,
    netRealizableCents: m.netRealizableCents, marginCents: m.marginCents, marginPct: m.marginPct,
    expectedPerDayCents: m.expectedPerDayCents, liquidityDays: m.liquidityDays, score: m.score,
    breakdown: m.breakdown, gatePassed: opts.gatePassed, gateReason: opts.gateReason,
    createdAt: opts.createdAt,
  }).returning({ id: opportunities.id }).get().id;
}

export interface RankedRow {
  listingId: number; externalId: string; source: string; title: string; url: string;
  city: string | null; askingCents: number; fairGrossCents: number | null;
  marginCents: number | null; marginPct: number | null; expectedPerDayCents: number | null;
  liquidityDays: number; score: number; breakdown: Record<string, number>;
  sampleSize: number; confidence: Confidence | 'none';
}

export function listShortlistedRanked(db: Db, limit: number): RankedRow[] {
  return db.select({
      listingId: opportunities.listingId,
      externalId: listings.externalId,
      source: listings.source,
      title: listings.title,
      url: listings.url,
      city: listings.city,
      askingCents: opportunities.askingCents,
      fairGrossCents: opportunities.fairGrossCents,
      marginCents: opportunities.marginCents,
      marginPct: opportunities.marginPct,
      expectedPerDayCents: opportunities.expectedPerDayCents,
      liquidityDays: opportunities.liquidityDays,
      score: opportunities.score,
      breakdown: opportunities.breakdown,
      sampleSize: sql<number>`coalesce(${valuations.sampleSize}, 0)`.as('sampleSize'),
      confidence: sql<Confidence | 'none'>`coalesce(${valuations.confidence}, 'none')`.as('confidence'),
    })
    .from(opportunities)
    .innerJoin(listings, eq(listings.id, opportunities.listingId))
    .leftJoin(valuations, eq(valuations.id, opportunities.valuationId))
    .where(eq(opportunities.gatePassed, true))
    .orderBy(desc(opportunities.score))
    .limit(limit)
    .all();
}
