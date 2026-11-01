import type { MonitorParams, SearchMonitor } from '@brique/core/types';

const HOST = 'https://www.olx.com.br';
const MAX_PAGES = 6;
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

const slug = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(DIACRITICS, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

function locationPath(p: MonitorParams): string {
  if (p.city) return `/estado/${slug(p.city)}-e-regiao`;
  if (p.uf) return `/estado/${slug(p.uf)}-e-regiao`;
  return '/brasil';
}

export function buildSearchUrl(monitor: SearchMonitor, page: number): string {
  const p = monitor.params;
  const q = new URLSearchParams({ q: monitor.query });
  if (p.minCents != null) q.set('f', mergeF(q.get('f'), `price_min_${Math.round(p.minCents / 100)}`));
  if (p.maxCents != null) q.set('f', mergeF(q.get('f'), `price_max_${Math.round(p.maxCents / 100)}`));
  if (p.extraQuery) for (const [k, v] of new URLSearchParams(p.extraQuery)) q.set(k, v);
  const capped = Math.min(Math.max(page, 1), MAX_PAGES);
  return `${HOST}${locationPath(p)}?${q.toString()}&o=${capped}`;
}

function mergeF(existing: string | null, add: string): string {
  return existing ? `${existing}_${add}` : add;
}
