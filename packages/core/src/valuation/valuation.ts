import type { Db } from '../db/client';
import type { ComparablesProvider } from './comparables';
import type { Category, Confidence, Settings, Valuation } from '../types';
import { keepFlags, medianCents, quantile } from './median';
import { liquidityFor } from './liquidity';

export interface ValueOpts {
  settings: Settings;
  now: Date;
  provider: ComparablesProvider;
  category: Category;
  windowDays?: number;
  excludeListingId?: number;
}

export interface ValueResult {
  valuation: Valuation;
  comparables: { listingId: number; askingCents: number; role: 'kept' | 'trimmed' }[];
  sampleGate: 'ok' | 'insufficient';
}

export function confidenceFor(sampleSize: number, variantAgnostic: boolean): Confidence | null {
  const capped: Confidence | null =
    sampleSize >= 8 ? 'high' : sampleSize >= 5 ? 'med' : sampleSize >= 3 ? 'low' : null;
  if (!capped) return null;
  return variantAgnostic && capped === 'high' ? 'med' : capped;
}

export function valueFingerprint(db: Db, fingerprintId: number, opts: ValueOpts): ValueResult {
  const windowDays = opts.windowDays ?? 90;
  const base = { fingerprintId, windowDays, now: opts.now, excludeListingId: opts.excludeListingId };
  const exact = opts.provider.collect(db, { ...base, variantAgnostic: false });
  const useAgnostic = exact.length < 3;
  const raw = useAgnostic ? opts.provider.collect(db, { ...base, variantAgnostic: true }) : exact;

  const values = raw.map((c) => c.askingCents);
  const flags = keepFlags(values, 0.1);
  const kept = values.filter((_, i) => flags[i]);
  const comparables = raw.map((c, i) => ({ listingId: c.listingId, askingCents: c.askingCents, role: flags[i] ? 'kept' as const : 'trimmed' as const }));
  const median = medianCents(kept);

  const delta = opts.settings.delta;
  const fairGross = median === null ? null : Math.round(median * delta);
  const liq = liquidityFor(db, fingerprintId, opts.category, opts.settings, opts.now);
  const confidence = confidenceFor(kept.length, useAgnostic) ?? 'low';

  return {
    valuation: {
      fingerprintId,
      sampleSize: kept.length,
      medianCents: median,
      p25Cents: quantile(kept, 0.25),
      p75Cents: quantile(kept, 0.75),
      fairGrossCents: fairGross,
      delta,
      liquidityDays: liq.days,
      liquiditySource: liq.source,
      confidence,
      variantAgnostic: useAgnostic,
      computedAt: opts.now,
    },
    comparables,
    sampleGate: kept.length < 3 ? 'insufficient' : 'ok',
  };
}
