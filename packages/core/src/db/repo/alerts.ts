import { and, desc, eq, inArray } from 'drizzle-orm';
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

// Só entregas confirmadas pelo transporte real (ntfy) formam a linha de base.
// Suppressed/failed/pending são prova de que o operador NÃO viu o alerta: não
// podem impedir uma nova tentativa quando o preço cai de novo.
export function latestDealAlertCents(db: Db, listingId: number): Cents | null {
  const row = db.select({ cents: dealAlerts.alertedAtCents })
    .from(dealAlerts)
    .where(and(
      eq(dealAlerts.listingId, listingId),
      inArray(dealAlerts.channel, ['ntfy']),
      eq(dealAlerts.status, 'sent'),
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
