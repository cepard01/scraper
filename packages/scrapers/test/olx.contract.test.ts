import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNextData, findAds, toAd, parseCardHtml } from '../src/olx/extract';
import { createOlxAdapter, isOlxAd } from '../src/olx/adapter';
import { isRejected } from '../src/contract';
import { buildSearchUrl } from '../src/olx/url';
import type { SearchMonitor } from '@brique/core/types';

const blob = JSON.parse(readFileSync('tests/fixtures/olx/search-iphone-12.json', 'utf8'));
const html = readFileSync('tests/fixtures/olx/search-no-blob.html', 'utf8');

const monitor: SearchMonitor = {
  id: 1, label: 'iphone 12', source: 'olx', query: 'iphone 12', category: 'celular',
  params: { uf: 'PR', minCents: 30_000, maxCents: 400_000 }, intervalMinutes: 30,
  active: true, lastRunAt: null, lastYield: 0,
};

describe('findAds', () => {
  it('acha os 3 anuncios sem conhecer o caminho do JSON', () => {
    expect(findAds(blob)).toHaveLength(3);
  });

  it('toAd extrai campos e lida com preco textual', () => {
    const ads = findAds(blob).map(toAd).filter(isOlxAd);
    expect(ads[0]).toMatchObject({
      externalId: '1001', title: 'iPhone 12 128GB Desbloqueado', priceRaw: 'R$ 980', city: 'Curitiba', uf: 'PR',
      imageUrls: ['https://thumb.olxcdn.com/img-a.jpg'],
    });
  });

  it('descarta imagem sem url utilizavel em vez de inventar hospedeiro', () => {
    const ad = toAd({ id: '9', title: 'Qualquer coisa', price: 10, images: [{ id: 'img-b' }, { url: '/caminho/relativo.jpg' }] });
    expect(ad?.imageUrls).toEqual([]);
  });

  it('parseCardHtml pega o preco de cada card quando nao ha blob', () => {
    const cards = parseCardHtml(html);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ priceRaw: 'R$ 900,00', externalId: '2002' });
  });

  it('parseNextData devolve null em HTML sem blob', () => {
    expect(parseNextData(html)).toBeNull();
  });
});

describe('buildSearchUrl', () => {
  it('aplica faixa de preco em centavos convertida para reais e respeita o teto de paginas', () => {
    expect(buildSearchUrl(monitor, 1)).toContain('price_min_300_price_max_4000');
    expect(buildSearchUrl(monitor, 1)).toContain('o=1');
    expect(buildSearchUrl(monitor, 99)).toContain('o=6');
  });

  it('poe a localizacao so no path, com acento resolvido', () => {
    const cidade: SearchMonitor = { ...monitor, params: { city: 'São Paulo' } };
    const url = buildSearchUrl(cidade, 1);
    expect(url).toContain('/estado/sao-paulo-e-regiao?');
    expect(url).not.toContain('city=');
    expect(url).not.toContain('state=');
    expect(buildSearchUrl({ ...monitor, params: {} }, 1)).toContain('https://www.olx.com.br/brasil?');
  });
});

describe('createOlxAdapter.toListingInput', () => {
  const adapter = createOlxAdapter({
    http: async () => ({ status: 200, text: '', error: undefined, json: () => null as never }),
  });

  it('produz ListingInput para preco valido', () => {
    const raw = { source: 'olx' as const, externalId: '1001', url: 'https://olx/a/1001', fetchedAt: new Date(), payload: toAd(findAds(blob)[0]!)! };
    const li = adapter.toListingInput(raw);
    expect(li).toMatchObject({ askingCents: 98_000, city: 'Curitiba', uf: 'PR' });
    expect(isRejected(li)).toBe(false);
  });

  it('rejeita com motivo quando o preco nao e preco', () => {
    const raw = { source: 'olx' as const, externalId: '1003', url: 'https://olx/a/1003', fetchedAt: new Date(), payload: toAd(findAds(blob)[2]!)! };
    const res = adapter.toListingInput(raw);
    expect(res).toMatchObject({ rejected: true, reason: 'gratuito' });
    expect(isRejected(res)).toBe(true);
  });
});
