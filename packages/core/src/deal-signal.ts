import { formatBRL } from './money';
import type { AlertMessage } from './notify-port';
import type { Cents, ListingInput, MonitorParams, SearchMonitor } from './types';

// Decisão de alerta portada do Scrapelytics, agora usando a mediana aparada do
// Brique (que já considera só comparáveis eligible). Nenhuma função aqui toca
// banco, relógio ou rede.

export type DealBasis = 'median' | 'manual';

export interface DealSignal {
  deal: boolean;
  priceCents: Cents;
  baselineCents: Cents | null;
  belowPct: number | null;
  basis: DealBasis;
  samples: number;
}

const DEFAULT_BELOW_PCT = 35;
const DEFAULT_MIN_SAMPLES = 15;
const round1 = (v: number): number => Math.round(v * 10) / 10;

export function evaluateDealSignal(opts: {
  priceCents: Cents;
  medianCents: Cents | null;
  samples: number;
  params: MonitorParams;
}): DealSignal {
  const { priceCents, params } = opts;
  const belowPctConfig = params.belowMedianPct ?? DEFAULT_BELOW_PCT;
  const minSamples = params.minSamples ?? DEFAULT_MIN_SAMPLES;

  const reliableMedian = opts.samples >= minSamples && opts.medianCents !== null && opts.medianCents > 0;
  const baselineCents = reliableMedian
    ? opts.medianCents
    : params.manualCeilingCents !== undefined && params.manualCeilingCents > 0
      ? params.manualCeilingCents
      : null;

  if (baselineCents === null || baselineCents <= 0) {
    return { deal: false, priceCents, baselineCents: null, belowPct: null, basis: 'manual', samples: opts.samples };
  }

  const basis: DealBasis = reliableMedian ? 'median' : 'manual';
  const threshold = Math.round(baselineCents * (1 - belowPctConfig / 100));
  return {
    deal: priceCents <= threshold,
    priceCents,
    baselineCents,
    belowPct: round1(((baselineCents - priceCents) / baselineCents) * 100),
    basis,
    samples: opts.samples,
  };
}

export const DEAL_TAGS = ['moneybag'];
export const DEAL_PRIORITY = 4;

export function formatDealMessage(opts: {
  monitor: Pick<SearchMonitor, 'label' | 'params'>;
  listing: Pick<ListingInput, 'title' | 'url' | 'city' | 'imageUrls'>;
  signal: DealSignal;
  now?: Date;
}): AlertMessage {
  const { monitor, listing, signal } = opts;
  const s = signal;
  const basis = s.basis === 'median' ? `mediana de ${s.samples} anúncios` : 'teto manual (cold start)';
  const linhas = [
    s.belowPct !== null ? `${s.belowPct}% abaixo da base` : null,
    `preço ${formatBRL(s.priceCents)} · base ${s.baselineCents === null ? 'n/d' : formatBRL(s.baselineCents)} (${basis})`,
    `watch ${monitor.label}${listing.city ? ` · ${listing.city}` : ''}`,
  ].filter((l): l is string => l !== null);

  return {
    title: `${listing.title} — ${formatBRL(s.priceCents)}`,
    body: linhas.join('\n'),
    tags: DEAL_TAGS,
    priority: DEAL_PRIORITY,
    clickUrl: listing.url,
    discord: {
      watchId: monitor.label,
      priceCents: s.priceCents,
      baselineCents: s.baselineCents,
      belowPct: s.belowPct,
      basis: s.basis,
      samples: s.samples,
      city: listing.city,
      thumbUrl: listing.imageUrls[0] ?? null,
      timestamp: opts.now,
    },
  };
}
