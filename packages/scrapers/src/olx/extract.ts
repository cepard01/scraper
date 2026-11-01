export interface OlxAd {
  externalId: string;
  title: string;
  priceRaw: string;
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
  if (isObj(v)) return firstString((v as Candidate).value, (v as Candidate).formatted) ?? '';
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
    url: firstString(candidate.url, candidate.link, candidate.slug ? `https://www.olx.com.br/anuncio/${candidate.slug}` : null) ?? '',
    city: firstString(isObj(loc.city) ? (loc.city as { name?: unknown }).name : null),
    uf: firstString(isObj(loc.state) ? (loc.state as { initials?: unknown }).initials : null),
    description: firstString(candidate.description) ?? '',
    imageUrls: images.slice(0, 12),
    sellerRef: firstString(isObj(candidate.store) ? (candidate.store as { name?: unknown }).name : null,
      isObj(candidate.seller) ? (candidate.seller as { name?: unknown }).name : null),
    publishedAt: firstString(candidate.createdTime),
  };
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
      title, priceRaw: priceMatch[0], url: `https://www.olx.com.br${href}`,
      city: null, uf: null, description: '', imageUrls: [], sellerRef: null, publishedAt: null,
    });
  }
  return out;
}
