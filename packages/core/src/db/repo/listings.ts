import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
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
  // §3.1: um item só muda de status por passo explícito da pipeline ou por ação sua.
  // shortlisted/ignored/bought são sobrevivos à passada — 'unchanged' é o que o
  // pipeline lê em `transition` para encerrar o item, não o que se pinta na coluna.
  const lifecycle: ListingStatus | null =
    existing.status === 'shortlisted' || existing.status === 'ignored' || existing.status === 'bought'
      ? existing.status : null;
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
    status: lifecycle ?? (transition as ListingStatus),
    monitorId: opts.monitorId ?? existing.monitorId,
    fingerprintId: opts.fingerprintId ?? existing.fingerprintId,
    grade: opts.grade ?? existing.grade,
    parserVersion: opts.parserVersion,
    rawPayload: input as unknown,
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

export function markGone(db: Db, source: SourceId, seenExternalIds: string[], now: Date, monitorId?: number): number {
  const scoped = monitorId === undefined ? undefined : eq(listings.monitorId, monitorId);
  const active = db.select({ externalId: listings.externalId, id: listings.id })
    .from(listings)
    .where(and(eq(listings.source, source), scoped, ne(listings.status, 'gone'), ne(listings.status, 'bought')))
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
  const anchor = db.select().from(fingerprints).where(eq(fingerprints.id, fingerprintId)).get();
  if (!anchor) return [];

  const fpIds = [anchor.id];
  // 'celular'|null|null não é uma família: dois fingerprints sem marca e sem modelo
  // "combinam" por `null === null` e a mediana passaria a misturar produtos alheios
  // (§4: variante errada produz margem fantasma). Só há pooling com a âncora preenchida.
  if (opts.variantAgnostic && anchor.brand !== null && anchor.model !== null) {
    const siblings = db.select({ id: fingerprints.id }).from(fingerprints)
      .where(and(
        eq(fingerprints.category, anchor.category),
        eq(fingerprints.brand, anchor.brand),
        eq(fingerprints.model, anchor.model),
      )).all();
    fpIds.push(...siblings.map((s) => s.id));
  }

  const rows = db.select({ id: listings.id, askingCents: listings.askingCents, status: listings.status })
    .from(listings)
    .where(and(
      inArray(listings.fingerprintId, fpIds),
      gte(listings.lastSeenAt, since),
      isNull(listings.dupeOf),
    ))
    .all();

  return rows
    .filter((r) => r.status !== 'bought')
    .filter((r) => r.id !== opts.excludeListingId)
    .map((r) => ({ listingId: r.id, askingCents: r.askingCents }));
}

export function attachDupe(db: Db, listingId: number, dupeOfId: number): void {
  db.update(listings).set({ dupeOf: dupeOfId }).where(eq(listings.id, listingId)).run();
}
