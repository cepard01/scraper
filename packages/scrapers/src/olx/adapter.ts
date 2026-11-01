import { parsePriceBRL } from '@brique/core/money';
import type { ListingInput, RawListing, SearchMonitor } from '@brique/core/types';
import type { HttpGet } from '../http';
import { sleep, jitter } from '../http';
import { parseNextData, findAds, toAd, parseCardHtml, type OlxAd } from './extract';
import { buildSearchUrl } from './url';
import type { SourceAdapter } from '../contract';

const HOST = 'https://www.olx.com.br';

export const isOlxAd = (x: OlxAd | null): x is OlxAd => x !== null;

export interface OlxAdapterDeps { http: HttpGet }

export function createOlxAdapter(deps: OlxAdapterDeps): SourceAdapter {
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
      const pages = Math.min(monitor.params.pages ?? 3, 6);
      const out: RawListing[] = [];
      for (let page = 1; page <= pages; page++) {
        const res = await deps.http(buildSearchUrl(monitor, page));
        if (res.error === 'http' && (res.status === 403 || res.status === 429)) break;
        if (res.status !== 200) break;
        const ads = extract(res.text);
        if (ads.length === 0) break;
        for (const ad of ads) {
          out.push({ source: 'olx', externalId: ad.externalId, url: ad.url, fetchedAt: new Date(), payload: ad });
        }
        await sleep(jitter(1500, 4000));
      }
      return out;
    },

    async fetchOne(externalId: string) {
      const res = await deps.http(`${HOST}/anuncio/${externalId}`);
      const ads = extract(res.text);
      const ad = ads.find((a) => a.externalId === externalId) ?? ads[0];
      if (!ad) throw new Error(`olx: anuncio ${externalId} nao parseado (status ${res.status})`);
      return { source: 'olx' as const, externalId: ad.externalId, url: ad.url, fetchedAt: new Date(), payload: ad };
    },

    toListingInput(raw: RawListing): ListingInput | { rejected: true; reason: string; rawTitle: string } {
      const ad = raw.payload as OlxAd;
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
