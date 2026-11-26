import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { runs, searchMonitors } from './db/schema';
import type { SourceId } from './types';

export interface SourceHealth {
  degraded: boolean;
  reason: 'zero-novos' | 'yield-caiu' | null;
  detail: string;
}

export const ZERO_NEW_RUNS = 3;
export const YIELD_WINDOW = 10;
export const YIELD_DROP_PCT = 0.60;

// "yield de normalize" is `unmatched / (fetched - rejected)`, not `created`.
// `created` measures the market; `unmatched` measures the parser. §8.3's
// sentence is about a broken parser, so the ratio must isolate parser misses.
function normalizeYield(r: {
  fetched: number;
  unmatched: number;
  rejected: Record<string, number>;
}): number | null {
  const rejected = Object.values(r.rejected).reduce((a, b) => a + b, 0);
  const denominator = r.fetched - rejected;
  if (denominator <= 0) return null;
  return r.unmatched / denominator;
}

const fmtPct = (v: number): string => `${Math.round(v * 100)}%`;

export function checkSourceHealth(db: Db, source: SourceId): SourceHealth {
  const rows = db.select({
    created: runs.created,
    fetched: runs.fetched,
    unmatched: runs.unmatched,
    rejected: runs.rejected,
  })
    .from(runs)
    .innerJoin(searchMonitors, eq(searchMonitors.id, runs.monitorId))
    .where(and(eq(searchMonitors.source, source)))
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(YIELD_WINDOW + 1)
    .all();

  if (rows.length === 0) return { degraded: false, reason: null, detail: 'sem passadas' };

  if (rows.length >= ZERO_NEW_RUNS && rows.slice(0, ZERO_NEW_RUNS).every((r) => r.created === 0)) {
    return {
      degraded: true,
      reason: 'zero-novos',
      detail: `ultimas ${ZERO_NEW_RUNS} passadas sem anuncio novo`,
    };
  }

  const [latest, ...baseline] = rows;
  if (latest === undefined || baseline.length < YIELD_WINDOW) {
    return { degraded: false, reason: null, detail: `passadas insuficientes para yield (${rows.length})` };
  }

  const latestYield = normalizeYield(latest);
  const baselineYields = baseline.slice(0, YIELD_WINDOW).map(normalizeYield);
  // A run with fetched == rejected has no parser-yield denominator. Treating it
  // as zero would manufacture a collapse; a missing yield is not a bad yield.
  if (latestYield === null || baselineYields.some((y) => y === null)) {
    return { degraded: false, reason: null, detail: 'yield sem denominador em alguma passada' };
  }

  const baselineValues = baselineYields as number[];
  const avg = baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length;
  if (avg <= 0) return { degraded: false, reason: null, detail: 'media de yield zero' };

  const drop = (avg - latestYield) / avg;
  if (drop > YIELD_DROP_PCT) {
    return {
      degraded: true,
      reason: 'yield-caiu',
      detail: `yield ${fmtPct(latestYield)} vs media ${fmtPct(avg)} (queda ${fmtPct(drop)})`,
    };
  }

  return { degraded: false, reason: null, detail: `yield ${fmtPct(latestYield)} vs media ${fmtPct(avg)}` };
}
