import { parsePriceBRL } from '@brique/core/money';
import type { ListingInput, RawListing, SearchMonitor } from '@brique/core/types';
import type { HttpGet } from '../http';
import { sleep, jitter } from '../http';
import { parseNextData, findAds, toAd, parseCardHtml, type OlxAd } from './extract';
import { buildSearchUrl, HOST, MAX_PAGES } from './url';
import type { SourceAdapter } from '../contract';

export const isOlxAd = (x: unknown): x is OlxAd =>
  typeof x === 'object' && x !== null && typeof (x as OlxAd).externalId === 'string' && typeof (x as OlxAd).priceRaw === 'string';

export interface OlxAdapterDeps { http: HttpGet; onPageGap?: () => Promise<void> }

export function createOlxAdapter(deps: OlxAdapterDeps): SourceAdapter {
  const gap = deps.onPageGap ?? (async () => sleep(jitter(1500, 4000)));
  const extract = (text: string): OlxAd[] => {
    const blob = parseNextData(text);
    if (blob) {
      const fromBlob = findAds(blob).map(toAd).filter(isOlxAd);
      if (fromBlob.length > 0) return fromBlob;
    }
    return parseCardHtml(text);
  };

  return {
    id: 'olx' as const,
    parserVersion: 'olx-1',

    async health() {
      const res = await deps.http(`${HOST}/brasil?q=teste`);
      if (res.status === 200 && res.text.length > 500) return { ok: true };
      return { ok: false, reason: `http ${res.status} / ${res.error ?? 'corpo curto'}` };
    },

    async search(monitor: SearchMonitor, _since: Date) {
      const pages = Math.min(monitor.params.pages ?? 3, MAX_PAGES);
      const out: RawListing[] = [];
      for (let page = 1; page <= pages; page++) {
        const res = await deps.http(buildSearchUrl(monitor, page));
        if (res.status !== 200) break; // bloqueio (403/429) e erro de rede caem aqui; quem precisa distinguir 'fonte bloqueada' de 'dia sem anuncio' e o run do Task 16, nao o search
        const ads = extract(res.text);
        if (ads.length === 0) break;
        for (const ad of ads) {
          out.push({ source: 'olx', externalId: ad.externalId, url: ad.url, fetchedAt: new Date(), payload: ad });
        }
        if (page < pages) await gap();
      }
      return out;
    },

    async fetchOne(externalId: string) {
      const res = await deps.http(`${HOST}/anuncio/${externalId}`);
      const ad = extract(res.text).find((a) => a.externalId === externalId);
      if (!ad) throw new Error(`olx: anuncio ${externalId} nao esta no corpo (status ${res.status}) — pagina viva que nao traz o proprio anuncio no blob e achado de contrato (fetchOne so recebe id), nao do parser`);
      return { source: 'olx' as const, externalId: ad.externalId, url: ad.url, fetchedAt: new Date(), payload: ad };
    },

    toListingInput(raw: RawListing): ListingInput | { rejected: true; reason: string; rawTitle: string } {
      if (!isOlxAd(raw.payload)) return { rejected: true, reason: 'payload-invalido', rawTitle: raw.externalId };
      const ad = raw.payload;
      const price = parsePriceBRL(ad.priceRaw);
      if (!price.ok) return { rejected: true, reason: price.reason, rawTitle: ad.title };
      return {
        source: 'olx',
        externalId: ad.externalId,
        url: ad.url || raw.url,
        title: ad.title,
        description: ad.description ?? '',
        askingCents: price.cents,
        askingRaw: ad.priceRaw,
        city: ad.city,
        uf: ad.uf,
        imageUrls: ad.imageUrls ?? [],
        sellerRef: ad.sellerRef,
        publishedAt: ad.publishedAt ? new Date(ad.publishedAt) : null,
      };
    },
  };
}

export type OlxAdapter = ReturnType<typeof createOlxAdapter>;
