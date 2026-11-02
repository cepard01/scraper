import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../client';
import { dealAlerts } from '../schema';
import type { AlertChannel, AlertStatus, Cents, DealAlert } from '../../types';

export interface InsertAlertArgs {
  opportunityId: number;
  listingId: number;
  channel: AlertChannel;
  alertedAtCents: Cents;
  status?: AlertStatus;
  reason?: string | null;
  createdAt: Date;
}

export function insertDealAlert(db: Db, a: InsertAlertArgs): number {
  return db.insert(dealAlerts).values({
    opportunityId: a.opportunityId,
    listingId: a.listingId,
    channel: a.channel,
    alertedAtCents: a.alertedAtCents,
    status: a.status ?? 'pending',
    reason: a.reason ?? null,
    createdAt: a.createdAt,
  }).returning({ id: dealAlerts.id }).get().id;
}

export function updateDealAlert(
  db: Db,
  id: number,
  patch: { status: AlertStatus; deliveredAt?: Date | null; reason?: string | null },
): void {
  db.update(dealAlerts).set({
    status: patch.status,
    deliveredAt: patch.deliveredAt ?? null,
    reason: patch.reason ?? null,
  }).where(eq(dealAlerts.id, id)).run();
}

// Suppressed rows are the proof that the alert was refused, not an alert the
// operator saw. They must not set the dedupe baseline: after silent hours end,
// the same price still deserves a push.
export function latestDealAlertCents(db: Db, listingId: number): Cents | null {
  const row = db.select({ cents: dealAlerts.alertedAtCents })
    .from(dealAlerts)
    .where(and(
      eq(dealAlerts.listingId, listingId),
      eq(dealAlerts.channel, 'ntfy'),
      ne(dealAlerts.status, 'suppressed'),
    ))
    .orderBy(desc(dealAlerts.id))
    .limit(1)
    .get();
  return row?.cents ?? null;
}

export function getDealAlert(db: Db, id: number): DealAlert | null {
  return db.select().from(dealAlerts).where(eq(dealAlerts.id, id)).get() ?? null;
}

export function listDealAlertsForListing(db: Db, listingId: number): DealAlert[] {
  return db.select().from(dealAlerts)
    .where(eq(dealAlerts.listingId, listingId))
    .orderBy(desc(dealAlerts.id))
    .all();
}
