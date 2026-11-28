import { desc, eq } from 'drizzle-orm';
import { loadConfig } from '@brique/core/config';
import { loadSettings } from '@brique/core/db/client-helpers';
import type { Db } from '@brique/core/db/client';
import {
  comparableRefs, fingerprints, listings, opportunities,
  pricePoints, purchases, valuations,
} from '@brique/core/db/schema';
import { aiStatsSince, countAiDeferred } from '@brique/core/db/repo/ai';
import { listDealAlertsForListing } from '@brique/core/db/repo/alerts';
import { getListing } from '@brique/core/db/repo/listings';
import { listMonitors } from '@brique/core/db/repo/monitors';
import { listShortlistedRanked, type RankedRow } from '@brique/core/db/repo/opportunities';
import { listInventory } from '@brique/core/db/repo/giro';
import { categoryStats, pnlSummary, realizedFor, stalePurchases } from '@brique/core/pnl';
import { checkSourceHealth, type SourceHealth } from '@brique/core/source-health';
import type { AlertStatus, Settings } from '@brique/core/types';

export interface ConfigStatus {
  ntfyConfigured: boolean;
  meliConfigured: boolean;
  omnirouteConfigured: boolean;
}

// Valores de segredo nunca voltam ao painel: só a presença, para não haver
// tópico em HTML, log, snapshot nem diff. `.env` continua fora de `setting`.
export function getConfigStatus(): ConfigStatus {
  const cfg = loadConfig();
  return {
    ntfyConfigured: cfg.ntfy.topic !== null,
    meliConfigured: cfg.meliToken !== null,
    omnirouteConfigured: cfg.omniRoute.apiKey !== null,
  };
}

export interface DealCard extends RankedRow {
  favorite: boolean;
  aiVerdict: 'pass' | 'veto' | 'unavailable' | null;
  aiReasons: string[];
  alertStatus: AlertStatus | null;
  alertReason: string | null;
  priceCount: number;
  lastPriceCents: number | null;
}

export function getDeals(db: Db, limit = 100): DealCard[] {
  return listShortlistedRanked(db, limit).map((row) => {
    const opp = db.select({
      aiVerdict: opportunities.aiVerdict, aiReasons: opportunities.aiReasons,
    }).from(opportunities).where(eq(opportunities.id, row.opportunityId)).get();
    // Digest grava linhas sent com outro canal; sem filtrar, o digest da manhã
    // mascararia um push de deal que falhou antes. A coluna mostra o deal.
    const alert = listDealAlertsForListing(db, row.listingId).find((a) => a.channel === 'ntfy') ?? null;
    const prices = db.select({
      askingCents: pricePoints.askingCents, observedAt: pricePoints.observedAt,
    }).from(pricePoints).where(eq(pricePoints.listingId, row.listingId))
      .orderBy(pricePoints.observedAt).all();
    const listing = getListing(db, row.listingId);

    return {
      ...row,
      favorite: listing?.favorite ?? false,
      aiVerdict: opp?.aiVerdict ?? null,
      aiReasons: opp?.aiReasons ?? [],
      alertStatus: alert?.status ?? null,
      alertReason: alert?.reason ?? null,
      priceCount: prices.length,
      lastPriceCents: prices.at(-1)?.askingCents ?? null,
    };
  });
}

export interface SourceHealthRow extends SourceHealth {
  source: string;
}

export interface HomeAiData {
  configured: boolean;
  /** Taxa de cache nas últimas 24h; null é n/d — nunca transformado em 0%. */
  cacheHitPct: number | null;
  calls: number;
  paused: boolean;
}

export interface HomeData {
  summary: ReturnType<typeof pnlSummary>;
  health: SourceHealthRow[];
  top: DealCard[];
  ai: HomeAiData;
}

const NO_CONFIG: ConfigStatus = { ntfyConfigured: false, meliConfigured: false, omnirouteConfigured: false };

export function getHome(db: Db, tz: string, limit = 10, config: ConfigStatus = NO_CONFIG): HomeData {
  const sources = Array.from(new Set(listMonitors(db).map((m) => m.source)));
  const stats = aiStatsSince(db, new Date(Date.now() - 86_400_000));
  const rows = (status: 'ok' | 'cache-hit') => stats.filter((s) => s.status === status);
  const sum = (status: 'ok' | 'cache-hit') =>
    rows(status).reduce((n, s) => n + s.total, 0);
  // `total` conta linhas do log (uma por lote de até 12); `items` conta anúncios.
  // A taxa de acerto do cache é por item auditado, não por requisição.
  const sumItems = (status: 'ok' | 'cache-hit') =>
    rows(status).reduce((n, s) => n + s.items, 0);
  const calls = sum('ok');
  const audited = sumItems('ok') + sumItems('cache-hit');
  const hits = sumItems('cache-hit');

  return {
    summary: pnlSummary(db, { tz }),
    health: sources.map((source) => ({ source, ...checkSourceHealth(db, source) })),
    top: getDeals(db, limit),
    ai: {
      configured: config.omnirouteConfigured,
      calls,
      cacheHitPct: audited > 0 ? hits / audited : null,
      paused: loadSettings(db).aiPaused,
    },
  };
}

export type ListingDetail = NonNullable<ReturnType<typeof getListing>> & {
  fingerprintLabel: string | null;
  category: string | null;
  opportunity: {
    id: number; gatePassed: boolean; gateReason: string; score: number;
    breakdown: Record<string, number>; aiVerdict: 'pass' | 'veto' | 'unavailable' | null;
    aiReasons: string[] | null;
  } | null;
  valuation: {
    sampleSize: number; medianCents: number | null; p25Cents: number | null;
    p75Cents: number | null; fairGrossCents: number | null; delta: number;
    liquidityDays: number; liquiditySource: string; confidence: string; computedAt: Date;
  } | null;
  comparables: Array<{ listingId: number; title: string; askingCents: number; role: string }>;
  priceSeries: Array<{ askingCents: number; observedAt: Date }>;
  alerts: ReturnType<typeof listDealAlertsForListing>;
  purchase: { id: number; paidCents: number; status: string; boughtAt: Date } | null;
};

export function getListingDetail(db: Db, listingId: number): ListingDetail | null {
  const listing = getListing(db, listingId);
  if (!listing) return null;

  // Cada repricing cria uma opportunity nova. /deals e o digest usam a de maior
  // id; o detalhe não pode ficar preso à primeira avaliação do anúncio.
  const opportunity = db.select({
    id: opportunities.id, gatePassed: opportunities.gatePassed, gateReason: opportunities.gateReason,
    score: opportunities.score, breakdown: opportunities.breakdown,
    aiVerdict: opportunities.aiVerdict, aiReasons: opportunities.aiReasons,
    valuationId: opportunities.valuationId,
  }).from(opportunities).where(eq(opportunities.listingId, listingId))
    .orderBy(desc(opportunities.id)).limit(1).get() ?? null;

  const valuation = opportunity?.valuationId
    ? db.select({
        sampleSize: valuations.sampleSize, medianCents: valuations.medianCents,
        p25Cents: valuations.p25Cents, p75Cents: valuations.p75Cents,
        fairGrossCents: valuations.fairGrossCents, delta: valuations.delta,
        liquidityDays: valuations.liquidityDays, liquiditySource: valuations.liquiditySource,
        confidence: valuations.confidence, computedAt: valuations.computedAt,
      }).from(valuations).where(eq(valuations.id, opportunity.valuationId)).get() ?? null
    : null;

  const comparables = opportunity?.valuationId
    ? db.select({
        listingId: comparableRefs.listingId, title: listings.title,
        askingCents: comparableRefs.askingCents, role: comparableRefs.role,
      }).from(comparableRefs)
        .innerJoin(listings, eq(listings.id, comparableRefs.listingId))
        .where(eq(comparableRefs.valuationId, opportunity.valuationId))
        .all()
    : [];

  const fingerprint = listing.fingerprintId
    ? db.select({ label: fingerprints.label, category: fingerprints.category }).from(fingerprints)
        .where(eq(fingerprints.id, listing.fingerprintId)).get()
    : null;
  const fingerprintLabel = fingerprint?.label ?? null;

  const purchase = db.select({
    id: purchases.id, paidCents: purchases.paidCents,
    status: purchases.status, boughtAt: purchases.boughtAt,
  }).from(purchases).where(eq(purchases.listingId, listingId)).limit(1).get() ?? null;

  return {
    ...listing,
    fingerprintLabel,
    category: fingerprint?.category ?? null,
    opportunity: opportunity ? {
      id: opportunity.id, gatePassed: opportunity.gatePassed, gateReason: opportunity.gateReason,
      score: opportunity.score, breakdown: opportunity.breakdown,
      aiVerdict: opportunity.aiVerdict, aiReasons: opportunity.aiReasons,
    } : null,
    valuation,
    comparables,
    priceSeries: db.select({
      askingCents: pricePoints.askingCents, observedAt: pricePoints.observedAt,
    }).from(pricePoints).where(eq(pricePoints.listingId, listingId))
      .orderBy(pricePoints.observedAt).all(),
    alerts: listDealAlertsForListing(db, listingId),
    purchase,
  };
}

export function getInventory(db: Db, now: Date, settings: Settings) {
  return listInventory(db, now).map((row) => ({
    ...row,
    stale: row.daysHeld > settings.metaStaleDays,
    referenceCents: row.purchase.refMedianCents,
  }));
}

export function getPnl(db: Db, tz: string, now = new Date(), settings = loadSettings(db)) {
  const ids = db.select({ id: purchases.id }).from(purchases).all();
  return {
    summary: pnlSummary(db, { tz }),
    categories: categoryStats(db),
    stale: stalePurchases(db, now, settings),
    items: ids.map((r) => realizedFor(db, r.id)).filter((r) => r !== null),
  };
}

export function getSettingsView(db: Db, config: ConfigStatus = NO_CONFIG) {
  return { settings: loadSettings(db), config, aiQueued: countAiDeferred(db) };
}
