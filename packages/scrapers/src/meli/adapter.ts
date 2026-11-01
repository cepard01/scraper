import type { ListingInput, RawListing, SearchMonitor } from '@brique/core/types';
import type { HttpGet, HttpResult } from '../http';
import { jitter, sleep } from '../http';
import { itemUrl, LIMIT, MAX_PAGES, meliHeaders, searchUrl } from './auth';
import type { SourceAdapter } from '../contract';

export interface MeliItem {
  id: string; title: string; price: number; available_quantity?: number; sold_quantity?: number;
  condition?: string; catalog_product_id?: string | null; permalink?: string; thumbnail?: string;
  address?: { state?: { name?: string; id?: string } }; seller_id?: number;
}

// id e title, nao price: um preco ausente e um anuncio sem preco e precisa sair com o motivo
// proprio (not-a-price). Se a guarda comece pelo price, esses casos viram payload-invalido e o
// contador de rejeicoes do Task 16 mente sobre o que aconteceu.
export const isMeliItem = (x: unknown): x is MeliItem =>
  typeof x === 'object' && x !== null && typeof (x as MeliItem).id === 'string' && typeof (x as MeliItem).title === 'string';

const toCents = (price: number): number => Math.round(price * 100);

// res.json e JSON.parse cru: um corpo 200 que nao e JSON (portal cativo, WAF) lanca. Sem esta
// casca a excecao escaparia do adapter e descartaria as paginas boas ja coletadas.
const safeJson = <T>(res: HttpResult): T | null => {
  try { return res.json<T>() ?? null; } catch { return null; }
};

// so MLB tem estado em BR-<UF>; qualquer outra forma e null em vez de um UF inventado
const stateUf = (id?: string): string | null => (id !== undefined && /^BR-[A-Z]{2}$/.test(id) ? id.slice(3) : null);

export interface MeliAdapterDeps {
  http: HttpGet;
  token: string | null;
  unit: string;
  onPageGap?: () => Promise<void>;
}

// available nao esta em SourceAdapter: e a diferenca entre as duas fontes (OLX sempre existe,
// MELI so funciona com token). A intersecao mantem a verificacao de contrato no site de definicao
// e preserva o campo que o worker da Task 16 le antes de registrar a fonte.
export function createMeliAdapter(deps: MeliAdapterDeps): SourceAdapter & { readonly available: boolean } {
  // '' e null na mesma porta: meliHeaders ja trata '' como ausencia, entao um adapter que
  // chamasse '' de "disponivel" faria health dizer "sem token" num caminho e sair sem header
  // noutro. loadConfig (Task 2) faz este mesmo emptyToNull; repetir aqui custa uma linha e
  // fecha a unica borda em que um .env com MELI_ACCESS_TOKEN= queima cota em silencio.
  const token = deps.token === '' ? null : deps.token;
  const available = token !== null;
  const gap = deps.onPageGap ?? (async () => sleep(jitter(1000, 2500)));

  return {
    id: 'meli' as const,
    parserVersion: 'meli-1',
    available,

    async health() {
      if (!available) return { ok: false, reason: 'sem MELI_ACCESS_TOKEN; fonte desabilitada' };
      const res = await deps.http(searchUrl(deps.unit, 'iphone', 1, 0), { headers: meliHeaders(token) });
      if (res.status !== 200) return { ok: false, reason: res.error ? `http ${res.status} / ${res.error}` : `http ${res.status}` };
      const body = safeJson<{ results?: unknown[] }>(res);
      if (!body || body.results === undefined) return { ok: false, reason: 'http 200 / corpo sem results' };
      return { ok: true };
    },

    async search(monitor: SearchMonitor, _since: Date): Promise<RawListing[]> {
      if (!available) return [];
      const pages = Math.min(monitor.params.pages ?? 2, MAX_PAGES);
      const out: RawListing[] = [];
      for (let page = 0; page < pages; page++) {
        const res = await deps.http(
          searchUrl(deps.unit, monitor.query, LIMIT, page * LIMIT),
          { headers: meliHeaders(token) },
        );
        if (res.status !== 200) break; // 401 de token ruim e 429 de cota caem aqui; quem distingue 'fonte bloqueada' de 'dia sem anuncio' e o run do Task 16, nao o search
        const body = safeJson<{ results?: MeliItem[] }>(res);
        const items = (body?.results ?? []).filter(isMeliItem);
        if (items.length === 0) break;
        for (const it of items) {
          out.push({ source: 'meli', externalId: it.id, url: it.permalink ?? '', fetchedAt: new Date(), payload: it });
        }
        if (page + 1 < pages) await gap();
      }
      return out;
    },

    async fetchOne(externalId: string): Promise<RawListing> {
      if (!available) throw new Error('meli: token ausente');
      const res = await deps.http(itemUrl(externalId), { headers: meliHeaders(token) });
      if (res.status !== 200) throw new Error(`meli: item ${externalId} status ${res.status}`);
      const item = safeJson<MeliItem>(res);
      if (!isMeliItem(item)) throw new Error(`meli: item ${externalId} status 200 sem id/title no corpo`);
      if (item.id !== externalId) throw new Error(`meli: pediu ${externalId}, veio ${item.id}`);
      return { source: 'meli', externalId: item.id, url: item.permalink ?? '', fetchedAt: new Date(), payload: item };
    },

    toListingInput(raw: RawListing): ListingInput | { rejected: true; reason: string; rawTitle: string } {
      if (!isMeliItem(raw.payload)) return { rejected: true, reason: 'payload-invalido', rawTitle: raw.externalId };
      const it = raw.payload;
      if (typeof it.price !== 'number' || !Number.isFinite(it.price)) {
        return { rejected: true, reason: 'not-a-price', rawTitle: it.title };
      }
      const cents = toCents(it.price);
      if (cents < 0) return { rejected: true, reason: 'negativo', rawTitle: it.title };
      if (cents === 0) return { rejected: true, reason: 'zero', rawTitle: it.title };
      return {
        source: 'meli',
        externalId: it.id,
        url: it.permalink ?? raw.url,
        title: it.title,
        description: [it.condition ? `condicao:${it.condition}` : null, `sold_quantity:${it.sold_quantity ?? '?'}`].filter(Boolean).join(' '),
        askingCents: cents,
        askingRaw: String(it.price),
        city: null,
        uf: stateUf(it.address?.state?.id),
        imageUrls: it.thumbnail ? [it.thumbnail] : [],
        sellerRef: it.seller_id ? String(it.seller_id) : null,
        publishedAt: null,
      };
    },
  };
}

export type MeliAdapter = ReturnType<typeof createMeliAdapter>;
