import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  concatFlightChunks,
  extractFlightAds,
  looksLikeSearchResults,
  parseOlxPage,
  parseRscAds,
  rscAdToAd,
  type OlxFlightAd,
} from '../src/olx/extract';
import { createOlxAdapter } from '../src/olx/adapter';
import { buildSearchUrl } from '../src/olx/url';
import type { SearchMonitor } from '@brique/core/types';

const flightHtml = (...flights: string[]): string =>
  `<!DOCTYPE html><html><body>${flights.map((f) => `<script>self.__next_f.push([1,${JSON.stringify(f)}])</script>`).join('\n')}</body></html>`;

const adsFlight = (ads: OlxFlightAd[]): string =>
  `2:["$","$L38",null,{"ads":${JSON.stringify(ads)},"totalPages":10}]`;

const makeAd = (over: Partial<OlxFlightAd> = {}): OlxFlightAd => ({
  subject: 'iPhone 15 Pro 256gb',
  priceValue: 'R$ 4.350',
  listId: 1527874257,
  url: 'https://rj.olx.com.br/celulares/iphone-15-pro-1527874257',
  images: [{ original: 'https://img.olx.com.br/images/36/369676552316494.jpg' }],
  imageCount: 3,
  locationDetails: { municipality: 'Rio de Janeiro', neighbourhood: 'Barra da Tijuca', uf: 'RJ' },
  date: 1755868800,
  ...over,
});

const monitor: SearchMonitor = {
  id: 1, label: 'rsc', source: 'olx', query: 'iphone 15', category: 'celular',
  params: { pages: 2, uf: 'RJ' }, intervalMinutes: 30, active: true,
  lastRunAt: null, lastYield: 0, mutedUntil: null,
};

const recorded = readFileSync('tests/fixtures/olx/search-rsc-2026-11.html', 'utf8');

describe('RSC flight', () => {
  it('concatena chunks na ordem e ignora push sem payload de texto', () => {
    const html = flightHtml('a:', 'b:') + '<script>(self.__next_f=self.__next_f||[]).push([0])</script>';
    expect(concatFlightChunks(html)).toBe('a:b:');
  });

  it('reconhece os marcadores da busca viva, mas nao uma pagina de desafio', () => {
    expect(looksLikeSearchResults(recorded)).toBe(true);
    expect(looksLikeSearchResults('<html>Just a moment...</html>')).toBe(false);
  });

  it('extrai apenas arrays de ads com listId', () => {
    const flight = concatFlightChunks(flightHtml(adsFlight([makeAd()]), '9:"other", "ads":[]'));
    const arrays = extractFlightAds(flight);
    expect(arrays).toHaveLength(1);
    expect(arrays[0]).toHaveLength(1);
  });

  it('mapeia campos do anuncio, converte preco e data e deduplica por listId', () => {
    const ads = parseRscAds(flightHtml(adsFlight([makeAd()]), adsFlight([makeAd(), makeAd({ listId: 999 })])));
    expect(ads.map((a) => a.externalId)).toEqual(['1527874257', '999']);
    expect(ads[0]).toMatchObject({
      title: 'iPhone 15 Pro 256gb',
      priceRaw: 'R$ 4.350',
      priceCents: 435000,
      city: 'Rio de Janeiro',
      uf: 'RJ',
      publishedAt: '2025-08-22T13:20:00.000Z',
    });
    expect(ads[0]!.url).toContain('/celulares/');
    expect(ads[0]!.imageUrls[0]).toContain('img.olx.com.br');
  });

  it('data em milissegundos e preco numerico do flight viram centavos sem reescalar', () => {
    const ad = rscAdToAd(makeAd({ date: 1755868800000, priceValue: undefined, price: { raw: 250000 } }));
    expect(ad?.priceCents).toBe(250000);
    expect(ad?.publishedAt).toBe('2025-08-22T13:20:00.000Z');
  });

  it('descarta entradas sem listId, titulo ou url', () => {
    const ads = parseRscAds(flightHtml(adsFlight([
      makeAd(),
      makeAd({ listId: undefined }),
      makeAd({ subject: undefined }),
      makeAd({ url: undefined }),
    ])));
    expect(ads).toHaveLength(1);
  });
});

describe('parseOlxPage', () => {
  it('RSC entra primeiro, mesmo quando um __NEXT_DATA__ tambem esta presente', () => {
    const html = flightHtml(adsFlight([makeAd()])) +
      '<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>';
    expect(parseOlxPage(html).strategy).toBe('rsc');
  });

  it('cai para __NEXT_DATA__ quando o flight nao traz anuncios', () => {
    const blob = { props: { ads: [{ id: '1001', title: 'iPhone 12', price: { formatted: 'R$ 980' } }] } };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(blob)}</script>`;
    const page = parseOlxPage(html);
    expect(page.strategy).toBe('next-data');
    expect(page.ads[0]!.externalId).toBe('1001');
  });

  it('ultimo recurso e o HTML dos cards', () => {
    const page = parseOlxPage('<a href="/anuncio/x-1/1"><strong>R$ 500</strong><span>Oferta</span></a>');
    expect(page.strategy).toBe('html');
    expect(page.ads[0]!.priceRaw).toBe('R$ 500');
  });

  it('fixture gravada da pagina viva produz dezenas de anuncios RSC', () => {
    const page = parseOlxPage(recorded);
    expect(page.strategy).toBe('rsc');
    expect(page.ads.length).toBeGreaterThanOrEqual(40);
    expect(new Set(page.ads.map((a) => a.externalId)).size).toBe(page.ads.length);
    expect(page.ads[0]).toMatchObject({ externalId: '1556245478', title: 'Iphone 15', priceRaw: 'R$ 2.900', uf: 'RJ' });
  });
});

describe('adapter com RSC', () => {
  const httpFor = (steps: Array<{ status: number; text: string }>, calls: string[], gaps: number[]) => {
    let i = 0;
    return async (url: string) => {
      calls.push(url);
      const step = steps[Math.min(i++, steps.length - 1)]!;
      return { status: step.status, text: step.text, json: <T>(): T => JSON.parse(step.text) as T };
    };
  };

  it('varre duas paginas e nao repete listId entre elas', async () => {
    const calls: string[] = []; const gaps: number[] = [];
    const adapter = createOlxAdapter({
      http: httpFor([
        { status: 200, text: flightHtml(adsFlight([makeAd({ listId: 1 }), makeAd({ listId: 2 })])) },
        { status: 200, text: flightHtml(adsFlight([makeAd({ listId: 2 }), makeAd({ listId: 3 })])) },
      ], calls, gaps),
      onPageGap: async () => { gaps.push(1); },
    });
    const raws = await adapter.search(monitor, new Date());
    expect(raws.map((r) => r.externalId)).toEqual(['1', '2', '3']);
    expect(calls[0]).toContain('sf=1');
    expect(calls[1]).toContain('o=2');
    expect(gaps).toHaveLength(1);
  });

  it('fetchOne encontra o anuncio pedido na pagina RSC gravada', async () => {
    const adapter = createOlxAdapter({
      http: httpFor([{ status: 200, text: recorded }], [], []),
    });
    const raw = await adapter.fetchOne('1556245478');
    expect(raw.externalId).toBe('1556245478');
    expect(raw.url).toContain('/celulares/');
  });

  it('gera URL de busca com o formato validado', () => {
    expect(buildSearchUrl(monitor, 1)).toBe('https://www.olx.com.br/estado-rj?q=iphone+15&sf=1&o=1');
  });
});
