import { parsePriceBRL } from '@brique/core/money';
import type { ListingInput, RawListing, SearchMonitor } from '@brique/core/types';
import type { HttpGet } from '../http';
import { sleep, jitter } from '../http';
import { parseOlxDetailPage, parseOlxPage, type OlxAd } from './extract';
import { buildSearchUrl, HOST, MAX_PAGES } from './url';
import type { SourceAdapter } from '../contract';

export const isOlxAd = (x: unknown): x is OlxAd =>
  typeof x === 'object' && x !== null && typeof (x as OlxAd).externalId === 'string' && typeof (x as OlxAd).priceRaw === 'string';

export interface OlxAdapterDeps { http: HttpGet; onPageGap?: () => Promise<void>; pageDelayMs?: number }

export function createOlxAdapter(deps: OlxAdapterDeps): SourceAdapter {
  const pageDelayMs = deps.pageDelayMs ?? 1500;
  const gapFor = (monitorDelay: number | undefined): Promise<void> => {
    if (deps.onPageGap) return deps.onPageGap();
    const base = monitorDelay ?? pageDelayMs;
    return sleep(jitter(base, Math.round(base * 1.5)));
  };

  return {
    id: 'olx' as const,
    parserVersion: 'olx-rsc-2026-11',

    async health() {
      const res = await deps.http(`${HOST}/brasil?q=teste`);
      if (res.status === 200 && res.text.length > 500) return { ok: true };
      return { ok: false, reason: `http ${res.status} / ${res.error ?? 'corpo curto'}` };
    },

    async search(monitor: SearchMonitor, _since: Date) {
      const pages = Math.min(monitor.params.pages ?? 3, MAX_PAGES);
      const out: RawListing[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= pages; page++) {
        const res = await deps.http(buildSearchUrl(monitor, page));
        if (res.status !== 200) break; // bloqueio (403/429) e erro de rede caem aqui; quem precisa distinguir 'fonte bloqueada' de 'dia sem anuncio' e o run do Task 16, nao o search
        const ads = parseOlxPage(res.text).ads;
        if (ads.length === 0) break;
        for (const ad of ads) {
          if (seen.has(ad.externalId)) continue;
          seen.add(ad.externalId);
          out.push({ source: 'olx', externalId: ad.externalId, url: ad.url, fetchedAt: new Date(), payload: ad });
        }
        if (page < pages) await gapFor(monitor.params.pageDelayMs);
      }
      return out;
    },

    async fetchOne(externalId: string) {
      const res = await deps.http(`${HOST}/anuncio/${externalId}`);
      if (res.status !== 200) throw new Error(`olx: anuncio ${externalId} status ${res.status}${res.error ? ` / ${res.error}` : ''}`);
      let ad = parseOlxPage(res.text).ads.find((a) => a.externalId === externalId)
        ?? parseOlxDetailPage(res.text, externalId);

      // /anuncio/<id> responde 200 com página genérica quando o slug/região
      // mudou. A busca por id é o único caminho que ainda devolve o anúncio
      // sem saber o slug, e não dilui o id pedido: só aceita match exato.
      if (!ad) {
        const byId: SearchMonitor = {
          id: 0, label: externalId, source: 'olx', query: externalId, category: null,
          params: { pages: 1 }, intervalMinutes: 30, active: true, lastRunAt: null,
          lastYield: 0, mutedUntil: null,
        };
        const found = await deps.http(buildSearchUrl(byId, 1));
        if (found.status === 200) ad = parseOlxPage(found.text).ads.find((a) => a.externalId === externalId) ?? null;
      }
      if (!ad) throw new Error(`olx: anuncio ${externalId} sem Product/JSON-LD nem RSC no corpo (status ${res.status})`);
      return { source: 'olx' as const, externalId: ad.externalId, url: ad.url, fetchedAt: new Date(), payload: ad };
    },

    toListingInput(raw: RawListing): ListingInput | { rejected: true; reason: string; rawTitle: string } {
      if (!isOlxAd(raw.payload)) return { rejected: true, reason: 'payload-invalido', rawTitle: raw.externalId };
      const ad = raw.payload;
      const price = parsePriceBRL(ad.priceRaw);
      const cents = ad.priceCents !== undefined && ad.priceCents > 0 ? ad.priceCents : price.ok ? price.cents : null;
      if (cents === null) return { rejected: true, reason: price.ok ? 'preco-invalido' : price.reason, rawTitle: ad.title };
      return {
        source: 'olx',
        externalId: ad.externalId,
        url: ad.url || raw.url,
        title: ad.title,
        description: ad.description ?? '',
        askingCents: cents,
        askingRaw: ad.priceRaw || String(cents),
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
