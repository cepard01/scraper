import { sql } from 'drizzle-orm';
import { integer, text, real, sqliteTable, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Category, Confidence, Cents, GateReason, Grade, ListingStatus, MonitorParams, SourceId, Valuation } from '../types';

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const searchMonitors = sqliteTable('search_monitor', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  source: text('source').$type<SourceId>().notNull(),
  query: text('query').notNull(),
  category: text('category').$type<Category | null>(),
  params: text('params', { mode: 'json' }).$type<MonitorParams>().notNull().default(sql`'{}'`),
  intervalMinutes: integer('interval_minutes').notNull().default(30),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: ts('last_run_at'),
  lastYield: integer('last_yield').notNull().default(0),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const fingerprints = sqliteTable('fingerprint', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  category: text('category').$type<Category>().notNull(),
  brand: text('brand'),
  model: text('model'),
  variant: text('variant'),
  grade: text('grade').$type<Grade | null>(),
  label: text('label').notNull(),
}, (t) => [uniqueIndex('u_fingerprint_key').on(t.key), index('i_fingerprint_model').on(t.category, t.brand, t.model)]);

export const listings = sqliteTable('listing', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').$type<SourceId>().notNull(),
  externalId: text('external_id').notNull(),
  url: text('url').notNull(),
  monitorId: integer('monitor_id'),
  fingerprintId: integer('fingerprint_id'),
  status: text('status').$type<ListingStatus>().notNull().default('new'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  askingCents: integer('asking_cents').$type<Cents>().notNull(),
  askingRaw: text('asking_raw').notNull().default(''),
  grade: text('grade').$type<Grade | null>(),
  city: text('city'),
  uf: text('uf'),
  imageUrls: text('image_urls', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  sellerRef: text('seller_ref'),
  publishedAt: ts('published_at'),
  firstSeenAt: ts('first_seen_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
  dupeOf: integer('dupe_of'),
  rawPayload: text('raw_payload', { mode: 'json' }),
  parserVersion: text('parser_version').notNull(),
}, (t) => [
  uniqueIndex('u_listing_source_ext').on(t.source, t.externalId),
  index('i_listing_fingerprint').on(t.fingerprintId),
  index('i_listing_status_seen').on(t.status, t.lastSeenAt),
]);

export const pricePoints = sqliteTable('price_point', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  listingId: integer('listing_id').notNull().references(() => listings.id),
  askingCents: integer('asking_cents').$type<Cents>().notNull(),
  observedAt: ts('observed_at').notNull(),
}, (t) => [index('i_pricepoint_listing_time').on(t.listingId, t.observedAt)]);

export const valuations = sqliteTable('valuation', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fingerprintId: integer('fingerprint_id').notNull().references(() => fingerprints.id),
  sampleSize: integer('sample_size').notNull(),
  medianCents: integer('median_cents').$type<Cents | null>(),
  p25Cents: integer('p25_cents').$type<Cents | null>(),
  p75Cents: integer('p75_cents').$type<Cents | null>(),
  fairGrossCents: integer('fair_gross_cents').$type<Cents | null>(),
  delta: real('delta').notNull(),
  liquidityDays: integer('liquidity_days').notNull(),
  liquiditySource: text('liquidity_source').$type<Valuation['liquiditySource']>().notNull(),
  confidence: text('confidence').$type<Confidence>().notNull(),
  variantAgnostic: integer('variant_agnostic', { mode: 'boolean' }).notNull().default(false),
  computedAt: ts('computed_at').notNull(),
}, (t) => [index('i_valuation_fp').on(t.fingerprintId, t.computedAt)]);

export const comparableRefs = sqliteTable('comparable_ref', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  valuationId: integer('valuation_id').notNull().references(() => valuations.id),
  listingId: integer('listing_id').notNull().references(() => listings.id),
  askingCents: integer('asking_cents').$type<Cents>().notNull(),
  role: text('role').$type<'kept' | 'trimmed'>().notNull(),
});

export const opportunities = sqliteTable('opportunity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  listingId: integer('listing_id').notNull().references(() => listings.id),
  valuationId: integer('valuation_id'),
  askingCents: integer('asking_cents').$type<Cents>().notNull(),
  fairGrossCents: integer('fair_gross_cents').$type<Cents | null>(),
  costsInCents: integer('costs_in_cents').$type<Cents>().notNull(),
  netRealizableCents: integer('net_realizable_cents').$type<Cents | null>(),
  marginCents: integer('margin_cents').$type<Cents | null>(),
  marginPct: real('margin_pct'),
  expectedPerDayCents: integer('expected_per_day_cents').$type<Cents | null>(),
  liquidityDays: integer('liquidity_days').notNull(),
  score: real('score').notNull(),
  breakdown: text('breakdown', { mode: 'json' }).$type<Record<string, number>>().notNull(),
  gatePassed: integer('gate_passed', { mode: 'boolean' }).notNull().default(false),
  gateReason: text('gate_reason').$type<GateReason>().notNull(),
  aiVerdict: text('ai_verdict').$type<'pass' | 'veto' | 'unavailable' | null>(),
  aiReasons: text('ai_reasons', { mode: 'json' }).$type<string[] | null>(),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('i_opp_score').on(t.gatePassed, t.score), index('i_opp_listing').on(t.listingId)]);

export const runs = sqliteTable('run', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  monitorId: integer('monitor_id').notNull(),
  startedAt: ts('started_at').notNull(),
  finishedAt: ts('finished_at'),
  outcome: text('outcome').$type<'ok' | 'partial' | 'failed'>(),
  fetched: integer('fetched').notNull().default(0),
  created: integer('created').notNull().default(0),
  repriced: integer('repriced').notNull().default(0),
  unchanged: integer('unchanged').notNull().default(0),
  rejected: text('rejected', { mode: 'json' }).$type<Record<string, number>>().notNull().default(sql`'{}'`),
  unmatched: integer('unmatched').notNull().default(0),
  aiCalls: integer('ai_calls').notNull().default(0),
  error: text('error'),
});

export const settings = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: ts('updated_at').notNull(),
});
