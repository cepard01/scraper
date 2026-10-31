import { and, eq, gte, isNull, ne } from 'drizzle-orm';
import type { Db } from '../client';
import { fingerprints, listings, pricePoints } from '../schema';
import type { Grade, ListingInput, ListingStatus, SourceId } from '../../types';

export interface UpsertOpts {
  parserVersion: string;
  monitorId?: number | null;
  fingerprintId?: number | null;
  grade?: Grade | null;
  seenAt: Date;
}

export interface UpsertResult {
  id: number;
  transition: 'new' | 'repriced' | 'unchanged';
}

export function upsertFromSource(db: Db, input: ListingInput, opts: UpsertOpts): UpsertResult {
  const existing = db.select().from(listings)
    .where(and(eq(listings.source, input.source), eq(listings.externalId, input.externalId)))
    .get();

  if (!existing) {
    const inserted = db.insert(listings).values({
      source: input.source,
      externalId: input.externalId,
      url: input.url,
      monitorId: opts.monitorId ?? null,
      fingerprintId: opts.fingerprintId ?? null,
      status: 'new',
      title: input.title,
      description: input.description,
      askingCents: input.askingCents,
      askingRaw: input.askingRaw,
      grade: opts.grade ?? null,
      city: input.city,
      uf: input.uf,
      imageUrls: input.imageUrls,
      sellerRef: input.sellerRef,
      publishedAt: input.publishedAt,
      firstSeenAt: opts.seenAt,
      lastSeenAt: opts.seenAt,
      rawPayload: input as unknown,
      parserVersion: opts.parserVersion,
    }).returning({ id: listings.id }).get();
    const id = inserted.id;
    db.insert(pricePoints).values({ listingId: id, askingCents: input.askingCents, observedAt: opts.seenAt }).run();
    return { id, transition: 'new' };
  }

  const priceChanged = existing.askingCents !== input.askingCents;
  const wasGone = existing.status === 'gone';
  // Item que reaparece depois de gone volta como 'new', não 'unchanged': a valoração
  // que ele carrega é de um mercado que já andou, e o pipeline precisa reavaliá-lo.
  // O firstSeenAt fica intacto de propósito, para a liquidez ver a idade real do anúncio.
  const transition: UpsertResult['transition'] = wasGone ? 'new' : priceChanged ? 'repriced' : 'unchanged';
  db.update(listings).set({
    url: input.url,
    title: input.title,
    description: input.description,
    askingCents: input.askingCents,
    askingRaw: input.askingRaw,
    city: input.city ?? existing.city,
    uf: input.uf ?? existing.uf,
    imageUrls: input.imageUrls.length > 0 ? input.imageUrls : existing.imageUrls,
    sellerRef: input.sellerRef ?? existing.sellerRef,
    publishedAt: input.publishedAt ?? existing.publishedAt,
    lastSeenAt: opts.seenAt,
    status: transition,
    monitorId: opts.monitorId ?? existing.monitorId,
    fingerprintId: opts.fingerprintId ?? existing.fingerprintId,
    grade: opts.grade ?? existing.grade,
  }).where(eq(listings.id, existing.id)).run();

  if (priceChanged) {
    db.insert(pricePoints).values({ listingId: existing.id, askingCents: input.askingCents, observedAt: opts.seenAt }).run();
  }
  return { id: existing.id, transition };
}

export function setStatus(db: Db, listingId: number, status: ListingStatus): void {
  db.update(listings).set({ status }).where(eq(listings.id, listingId)).run();
}

export function setFingerprint(db: Db, listingId: number, fingerprintId: number | null, grade: Grade | null): void {
  db.update(listings).set({ fingerprintId, grade }).where(eq(listings.id, listingId)).run();
}

export function markGone(db: Db, source: SourceId, seenExternalIds: string[], now: Date): number {
  const active = db.select({ externalId: listings.externalId, id: listings.id })
    .from(listings)
    .where(and(eq(listings.source, source), ne(listings.status, 'gone'), ne(listings.status, 'bought')))
    .all();
  const seen = new Set(seenExternalIds);
  const missing = active.filter((r) => !seen.has(r.externalId));
  for (const r of missing) {
    db.update(listings).set({ status: 'gone', lastSeenAt: now }).where(eq(listings.id, r.id)).run();
  }
  return missing.length;
}

export interface ComparableRow {
  listingId: number;
  askingCents: number;
}

export function findComparables(
  db: Db,
  fingerprintId: number,
  opts: { windowDays: number; variantAgnostic: boolean; now: Date; excludeListingId?: number },
): ComparableRow[] {
  const since = new Date(opts.now.getTime() - opts.windowDays * 86_400_000);
  const cols = db.select({ listing: listings, fp: fingerprints })
    .from(listings)
    .innerJoin(fingerprints, eq(fingerprints.id, listings.fingerprintId))
    .where(and(gte(listings.lastSeenAt, since), isNull(listings.dupeOf)))
    .all();

  const anchor = cols.find((c) => c.fp.id === fingerprintId)?.fp;
  if (!anchor) return [];

  const matched = cols.filter((c) => {
    if (c.fp.id === fingerprintId) return true;
    if (!opts.variantAgnostic) return false;
    return c.fp.category === anchor.category && c.fp.brand === anchor.brand && c.fp.model === anchor.model;
  });

  return matched
    .filter((c) => c.listing.status !== 'bought')
    .filter((c) => c.listing.id !== opts.excludeListingId)
    .map((c) => ({ listingId: c.listing.id, askingCents: c.listing.askingCents }));
}

export function attachDupe(db: Db, listingId: number, dupeOfId: number): void {
  db.update(listings).set({ dupeOf: dupeOfId }).where(eq(listings.id, listingId)).run();
}
