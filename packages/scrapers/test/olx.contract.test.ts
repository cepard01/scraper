import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNextData, findAds, toAd, parseCardHtml } from '../src/olx/extract';
import { createOlxAdapter, isOlxAd } from '../src/olx/adapter';
import { isRejected } from '../src/contract';
import { buildSearchUrl, MAX_PAGES } from '../src/olx/url';
import type { SearchMonitor } from '@brique/core/types';

const blob = JSON.parse(readFileSync('tests/fixtures/olx/search-iphone-12.json', 'utf8'));
const html = readFileSync('tests/fixtures/olx/search-no-blob.html', 'utf8');

const monitor: SearchMonitor = {
  id: 1, label: 'iphone 12', source: 'olx', query: 'iphone 12', category: 'celular',
  params: { uf: 'PR', minCents: 30_000, maxCents: 400_000 }, intervalMinutes: 30,
  active: true, lastRunAt: null, lastYield: 0, mutedUntil: null,
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

  it('toAd le preco numerico e objeto {value, formatted}, nao so string', () => {
    expect(toAd({ id: '11', title: 'A', price: 980 })?.priceRaw).toBe('980');
    expect(toAd({ id: '12', title: 'B', price: { value: 1050, formatted: 'R$ 1.050' } })?.priceRaw).toBe('R$ 1.050');
    expect(toAd({ id: '13', title: 'C', price: { value: 900 } })?.priceRaw).toBe('900');
    expect(toAd({ id: '14', title: 'D', price: { formatted: 'Combine' } })?.priceRaw).toBe('Combine');
    expect(toAd({ id: '15', title: 'E', price: { value: '980' } })?.priceRaw).toBe('980');
  });

  it('card sem preco e card com preco antes do titulo tem destino definido', () => {
    const cards = parseCardHtml('<a href="/anuncio/x-1/1"><strong>R$ 500</strong><span>So o preco na frente</span></a>' + '<a href="/anuncio/x-2/2"><span>Sem preco</span></a>');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ externalId: '1', title: 'sem titulo', priceRaw: 'R$ 500' });
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

  it('extraQuery nao apaga a faixa de preco e token solto nao vira parametro vazio', () => {
    const comF = buildSearchUrl({ ...monitor, params: { ...monitor.params, extraQuery: 'f=circle_5' } }, 1);
    expect(comF).toContain('f=circle_5_price_min_300_price_max_4000');
    const solto = buildSearchUrl({ ...monitor, params: { ...monitor.params, extraQuery: 'iphone' } }, 1);
    expect(solto).not.toContain('iphone=');
    expect(solto).toContain('q=iphone+12');
  });
});

// adsHtml e adapterDe estao no escopo do arquivo, nao dentro do describe de search: o
// describe de fetchOne usa o mesmo roteiro de respostas, e duplicar o fake e a porta
// para os dois divergirem (um teste com erro de transporte que o outro nao ve).
const adsHtml = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(blob) + '</script>';

const adapterDe = (steps: Array<{ status: number; text?: string }>, calls: string[], gaps: number[]) => {
  let i = 0;
  const http = async (url: string) => {
    calls.push(url);
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    const text = step.text ?? '';
    return { status: step.status, text, error: step.status >= 400 ? ('http' as const) : undefined, json: <T>() => JSON.parse(text) as T };
  };
  return createOlxAdapter({ http, onPageGap: async () => { gaps.push(1); } });
};

describe('createOlxAdapter.search', () => {

  it('para na primeira pagina quando a fonte bloqueia (429) em vez de queimar as outras', async () => {
    const calls: string[] = []; const gaps: number[] = [];
    const ads = await adapterDe([{ status: 429, text: adsHtml }], calls, gaps).search(monitor, new Date());
    expect(calls).toHaveLength(1);
    expect(ads).toEqual([]);
    expect(gaps).toHaveLength(0);
  });

  it('para numa pagina 200 sem anuncios em vez de varrer ate o teto', async () => {
    const calls: string[] = []; const gaps: number[] = [];
    const adapter = adapterDe([{ status: 200, text: adsHtml }, { status: 200, text: '<html>dia vazio</html>' }], calls, gaps);
    const ads = await adapter.search({ ...monitor, params: { ...monitor.params, pages: 3 } }, new Date());
    expect(ads.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
    expect(gaps).toHaveLength(1);
  });

  it('respeita o teto de paginas e nao dorme depois da ultima', async () => {
    const calls: string[] = []; const gaps: number[] = [];
    const adapter = adapterDe([{ status: 200, text: adsHtml }], calls, gaps);
    const ads = await adapter.search({ ...monitor, params: { ...monitor.params, pages: 2 } }, new Date());
    expect(calls).toHaveLength(2);
    expect(gaps).toHaveLength(1);
    expect(ads).toHaveLength(6);
  });

  it('acima do teto nao varre: pages=99 faz MAX_PAGES chamadas e para', async () => {
    const calls: string[] = []; const gaps: number[] = [];
    const adapter = adapterDe([{ status: 200, text: adsHtml }], calls, gaps);
    await adapter.search({ ...monitor, params: { ...monitor.params, pages: 99 } }, new Date());
    expect(calls).toHaveLength(MAX_PAGES);
    expect(gaps).toHaveLength(MAX_PAGES - 1);
  });

  it('health distingue corpo bom de pagina de desafio curta', async () => {
    const calls: string[] = []; const gaps: number[] = [];
    const ok = await adapterDe([{ status: 200, text: 'x'.repeat(600) }], calls, gaps).health();
    expect(ok).toEqual({ ok: true });
    const off = await adapterDe([{ status: 200, text: 'curto' }], calls, gaps).health();
    expect(off).toMatchObject({ ok: false, reason: 'http 200 / corpo curto' });
  });
});

describe('createOlxAdapter.fetchOne', () => {
  it('devolve exatamente o anuncio pedido', async () => {
    const calls: string[] = []; const gaps: number[] = [];
    const raw = await adapterDe([{ status: 200, text: adsHtml }], calls, gaps).fetchOne('1002');
    expect(calls).toHaveLength(1);
    expect(raw.externalId).toBe('1002');
    expect(isOlxAd(raw.payload)).toBe(true);
  });

  it('pagina que devolve outros anuncios nao passa por este id: soft 404 lanca', async () => {
    const calls: string[] = []; const gaps: number[] = [];
    await expect(adapterDe([{ status: 200, text: adsHtml }], calls, gaps).fetchOne('9999999')).rejects.toThrow(/9999999/);
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
    expect(adapter.id).toBe('olx');
    expect(adapter.parserVersion).toBe('olx-1');
  });

  it('rejeita com motivo quando o preco nao e preco', () => {
    const raw = { source: 'olx' as const, externalId: '1003', url: 'https://olx/a/1003', fetchedAt: new Date(), payload: toAd(findAds(blob)[2]!)! };
    const res = adapter.toListingInput(raw);
    expect(res).toMatchObject({ rejected: true, reason: 'gratuito' });
    expect(isRejected(res)).toBe(true);
  });

  it('payload que nao veio do parser vira rejeicao, nao TypeError', () => {
    const bruto = { source: 'olx' as const, externalId: '9001', url: 'https://olx/a/9001', fetchedAt: new Date(), payload: null };
    expect(adapter.toListingInput(bruto)).toMatchObject({ rejected: true, reason: 'payload-invalido', rawTitle: '9001' });
  });

  it('payload com priceRaw numerico tambem e rejeicao: a guarda olha os campos, nao so o objeto', () => {
    const velho = { source: 'olx' as const, externalId: '9002', url: 'https://olx/a/9002', fetchedAt: new Date(), payload: { externalId: '9002', title: 'iPhone 12', priceRaw: 980 } };
    expect(adapter.toListingInput(velho)).toMatchObject({ rejected: true, reason: 'payload-invalido', rawTitle: '9002' });
  });
});
