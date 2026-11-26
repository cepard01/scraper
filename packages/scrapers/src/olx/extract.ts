import { parsePriceBRL } from '@brique/core/money';
import { HOST } from './url';

export interface OlxAd {
  externalId: string;
  title: string;
  priceRaw: string;
  /** Present when the RSC payload carried a numeric price (already in cents). */
  priceCents?: number;
  url: string;
  city: string | null;
  uf: string | null;
  description: string;
  imageUrls: string[];
  sellerRef: string | null;
  publishedAt: string | null;
}

export interface Candidate {
  id?: unknown; title?: unknown; description?: unknown; price?: unknown;
  value?: unknown; formatted?: unknown;
  slug?: unknown; link?: unknown; url?: unknown; location?: unknown; images?: unknown;
  ads?: unknown; store?: unknown; seller?: unknown; createdTime?: unknown;
}

export interface OlxFlightAd {
  listId?: number | string;
  subject?: string;
  url?: string;
  price?: { raw?: number } | string | null;
  priceValue?: string | null;
  oldPrice?: string | null;
  professionalAd?: boolean;
  imageCount?: number;
  images?: Array<{ original?: string } | null>;
  locationDetails?: { municipality?: string; neighbourhood?: string; uf?: string } | null;
  date?: string | number | null;
}

const isObj = (v: unknown): v is Candidate => typeof v === 'object' && v !== null;

export function findAds(payload: unknown): Candidate[] {
  const found: Candidate[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!isObj(node) || seen.has(node)) return;
    seen.add(node);
    if (typeof node.id !== 'undefined' && typeof node.title === 'string' && typeof node.price !== 'undefined') {
      found.push(node);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (isObj(value)) walk(value);
    }
  };
  walk(payload);
  return found;
}

export function parseNextData(html: string): unknown {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m || !m[1]) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

const firstString = (...vals: unknown[]): string | null => {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v;
  return null;
};

const numToStr = (v: unknown): string => {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (isObj(v)) {
    const c = v as Candidate;
    return firstString(c.formatted) ?? numToStr(c.value);
  }
  return '';
};

export function toAd(candidate: Candidate): OlxAd | null {
  const externalId = firstString(String(candidate.id ?? ''));
  const title = firstString(candidate.title);
  const priceRaw = numToStr(candidate.price);
  if (!externalId || !title) return null;

  const loc = isObj(candidate.location) ? candidate.location as { city?: { name?: unknown }; state?: { initials?: unknown; name?: unknown } } : {};
  const images = Array.isArray(candidate.images)
    ? (candidate.images as Array<{ url?: unknown }>)
        .map((i) => {
          const u = firstString(i.url);
          if (!u) return null;
          if (u.startsWith('//')) return `https:${u}`;
          return /^https?:\/\//.test(u) ? u : null;
        })
        .filter((x): x is string => x !== null)
    : [];

  return {
    externalId,
    title,
    priceRaw,
    url: firstString(candidate.url, candidate.link, candidate.slug ? `${HOST}/anuncio/${candidate.slug}` : null) ?? '',
    city: firstString(isObj(loc.city) ? (loc.city as { name?: unknown }).name : null),
    uf: firstString(isObj(loc.state) ? (loc.state as { initials?: unknown }).initials : null),
    description: firstString(candidate.description) ?? '',
    imageUrls: images.slice(0, 12),
    sellerRef: firstString(isObj(candidate.store) ? (candidate.store as { name?: unknown }).name : null,
      isObj(candidate.seller) ? (candidate.seller as { name?: unknown }).name : null),
    publishedAt: firstString(candidate.createdTime),
  };
}

// React Flight chunks are JSON strings wrapped in self.__next_f.push([1, "..."]).
// The bracket walk must respect quotes: ad titles contain `[` and `"` often enough
// to break a naive `indexOf(']')`.
function extractBalanced(text: string, startIdx: number): string | null {
  let i = startIdx;
  while (i < text.length && text[i] !== '[') i++;
  if (i >= text.length) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const begin = i;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return text.slice(begin, i + 1);
    }
  }
  return null;
}

export function concatFlightChunks(html: string): string {
  let flight = '';
  let pos = 0;
  const marker = 'self.__next_f.push(';
  while (true) {
    pos = html.indexOf(marker, pos);
    if (pos === -1) break;
    const raw = extractBalanced(html, pos + marker.length);
    pos += marker.length;
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr) && arr[0] === 1 && typeof arr[1] === 'string') flight += arr[1];
    } catch { /* chunk parcial não é prova de resultado */ }
  }
  return flight;
}

export function extractFlightAds(flight: string): OlxFlightAd[][] {
  const out: OlxFlightAd[][] = [];
  let pos = 0;
  while (true) {
    pos = flight.indexOf('"ads":', pos);
    if (pos === -1) break;
    const raw = extractBalanced(flight, pos + 6);
    if (raw) {
      try {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr) && arr.some((a) => isObj(a) && 'listId' in a)) {
          out.push(arr as OlxFlightAd[]);
        }
      } catch { /* segue para o próximo array */ }
    }
    pos += 6;
  }
  return out;
}

const httpImage = (u: unknown): string | null => {
  const s = firstString(u);
  if (!s) return null;
  if (s.startsWith('//')) return `https:${s}`;
  return /^https?:\/\//.test(s) ? s : null;
};

const flightDate = (d: OlxFlightAd['date']): string | null => {
  if (d == null) return null;
  const ms = typeof d === 'number' ? (d > 1e12 ? d : d * 1000) : new Date(d).getTime();
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
};

export function rscAdToAd(ad: OlxFlightAd): OlxAd | null {
  if (ad.listId == null || !ad.subject || !ad.url) return null;
  const priceRaw = firstString(ad.priceValue, typeof ad.price === 'string' ? ad.price : null, ad.oldPrice) ?? '';
  const numericRaw = ad.price && typeof ad.price === 'object' && typeof ad.price.raw === 'number' ? ad.price.raw : null;
  const parsed = parsePriceBRL(priceRaw);
  return {
    externalId: String(ad.listId),
    title: ad.subject.trim(),
    priceRaw,
    priceCents: numericRaw !== null && numericRaw > 0 ? numericRaw : parsed.ok ? parsed.cents : undefined,
    url: ad.url,
    city: firstString(ad.locationDetails?.municipality),
    uf: firstString(ad.locationDetails?.uf),
    description: firstString(ad.locationDetails?.neighbourhood) ?? '',
    imageUrls: (ad.images ?? []).map((i) => httpImage(i?.original)).filter((x): x is string => x !== null).slice(0, 12),
    sellerRef: null,
    publishedAt: flightDate(ad.date),
  };
}

export function parseRscAds(html: string): OlxAd[] {
  const seen = new Set<string>();
  const out: OlxAd[] = [];
  for (const arr of extractFlightAds(concatFlightChunks(html))) {
    for (const raw of arr) {
      const ad = rscAdToAd(raw);
      if (!ad || seen.has(ad.externalId)) continue;
      seen.add(ad.externalId);
      out.push(ad);
    }
  }
  return out;
}

export function looksLikeSearchResults(html: string): boolean {
  return html.includes('self.__next_f.push') && html.includes('listId');
}

export type OlxParserStrategy = 'rsc' | 'next-data' | 'html';

export function parseOlxPage(html: string): { ads: OlxAd[]; strategy: OlxParserStrategy } {
  const rsc = parseRscAds(html);
  if (rsc.length > 0) return { ads: rsc, strategy: 'rsc' };
  const blob = parseNextData(html);
  if (blob) {
    const fromBlob = findAds(blob).map(toAd).filter((ad): ad is OlxAd => ad !== null);
    if (fromBlob.length > 0) return { ads: fromBlob, strategy: 'next-data' };
  }
  return { ads: parseCardHtml(html), strategy: 'html' };
}

const CARD_RE = /<a[^>]+href="(\/anuncio\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const PRICE_IN_CARD_RE = /R\$\s*[\d.,]+/;

export function parseCardHtml(html: string): OlxAd[] {
  const out: OlxAd[] = [];
  for (const m of html.matchAll(CARD_RE)) {
    const href = m[1]!;
    const inner = m[2]!;
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const priceMatch = text.match(PRICE_IN_CARD_RE);
    if (!priceMatch) continue;
    const title = text.slice(0, text.indexOf(priceMatch[0])).trim() || 'sem titulo';
    out.push({
      externalId: href.split('/').pop()!.replace(/\?.*$/, ''),
      title, priceRaw: priceMatch[0], url: `${HOST}${href}`,
      city: null, uf: null, description: '', imageUrls: [], sellerRef: null, publishedAt: null,
    });
  }
  return out;
}
