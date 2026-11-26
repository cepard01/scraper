import type { Cents, Confidence, GateReason } from './types';

export interface AlertDecision {
  shouldAlert: boolean;
  kind: 'novo' | 'caiu' | null;
  dropPct: number | null;
  reason: string | null;
}

export const REALERT_MIN_DROP_PCT = 0.10;
export const SILENT_FROM_HOUR = 22;
export const SILENT_TO_HOUR = 8;
export const DIGEST_HOUR_DEFAULT = 9;

export function localHour(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

export function localDateKey(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Silent hours are a suppression, not an omission: the caller must write the
// suppressed row. An alert swallowed without a record is indistinguishable from
// a broken system, which is exactly the accusation a missing push earns.
export function isSilentHours(at: Date, tz: string): boolean {
  const h = localHour(at, tz);
  return h >= SILENT_FROM_HOUR || h < SILENT_TO_HOUR;
}

export function shouldSendDigest(
  now: Date,
  cfg: { hourLocal: number; tz: string; lastDigestAt: Date | null },
): boolean {
  if (localHour(now, cfg.tz) < cfg.hourLocal) return false;
  if (cfg.lastDigestAt === null) return true;
  return localDateKey(now, cfg.tz) !== localDateKey(cfg.lastDigestAt, cfg.tz);
}

// §5.3 + §9. The gate already refuses low-confidence samples below 2×floor;
// this check exists because the alert layer is the last place allowed to
// interrupt the operator, and two thresholds that happen to agree today must
// not silently become one.
export function decideAlert(args: {
  listingId: number;
  askingCents: Cents;
  gatePassed: boolean;
  gateReason: GateReason;
  confidence: Confidence | 'none';
  marginPct: number | null;
  floorMarginPct: number;
  lastAlertCents: Cents | null;
}): AlertDecision {
  const no = (reason: string): AlertDecision => ({ shouldAlert: false, kind: null, dropPct: null, reason });

  if (!args.gatePassed) return no(args.gateReason);
  if (args.confidence === 'none') return no('amostra-insuficiente');
  if (args.confidence === 'low' && (args.marginPct === null || args.marginPct < 2 * args.floorMarginPct)) {
    return no('confianca-baixa');
  }

  if (args.lastAlertCents === null) {
    return { shouldAlert: true, kind: 'novo', dropPct: null, reason: null };
  }
  if (args.askingCents >= args.lastAlertCents) return no('sem-nova-cruzada');

  const dropPct = (args.lastAlertCents - args.askingCents) / args.lastAlertCents;
  if (dropPct < REALERT_MIN_DROP_PCT) return no('queda-insuficiente');

  return { shouldAlert: true, kind: 'caiu', dropPct, reason: null };
}
