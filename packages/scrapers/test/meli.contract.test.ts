import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SourceAdapter } from '@brique/core/adapter-contract';
import type { SearchMonitor } from '@brique/core/types';
import type { HttpGet } from '../src/http';
import { createMeliAdapter, isMeliItem } from '../src/meli/adapter';
import { isRejected } from '../src/contract';
import { HOST, itemUrl, LIMIT, MAX_PAGES, meliHeaders, searchUrl } from '../src/meli/auth';

const payload = JSON.parse(readFileSync('tests/fixtures/meli/search-iphone-12.json', 'utf8'));
const item = payload.results[0];

const monitor: SearchMonitor = {
  id: 1, label: 'iphone 12', source: 'meli', query: 'iphone 12 128gb', category: 'celular',
  params: { pages: 1 }, intervalMinutes: 30, active: true, lastRunAt: null, lastYield: 0,
};

const adapter = createMeliAdapter({
  http: async () => ({ status: 200, text: JSON.stringify(payload), error: undefined, json: <T>() => payload as T }),
  token: 'fake', unit: 'MLB',
});

// O contrato e verificado por compilador no ponto de uso: meli devolve SourceAdapter e mais
// available. Sem esta linha o shape podia divergir do contrato sem que nada reclamasse.
const contrato: SourceAdapter = adapter;

describe('meli auth', () => {
  it('nenhum endpoint carrega o token na query string', () => {
    const url = searchUrl('MLB', 'iphone 12', LIMIT, LIMIT);
    expect(url).toBe(`${HOST}/sites/MLB/search?q=iphone+12&limit=50&offset=50`);
    expect(itemUrl('MLB1111111111')).toBe(`${HOST}/items/MLB1111111111`);
    expect(meliHeaders('fake')).toEqual({ authorization: 'Bearer fake' });
    expect(meliHeaders(null)).toEqual({});
  });
});

describe('meli adapter', () => {
  it('id e parserVersion sao o contrato do banco', () => {
    expect(contrato.id).toBe('meli');
    expect(contrato.parserVersion).toBe('meli-1');
  });

  it('normaliza preco inteiro de reais em centavos', () => {
    const li = adapter.toListingInput({ source: 'meli', externalId: item.id, url: item.permalink, fetchedAt: new Date(), payload: item });
    expect(li).toMatchObject({
      source: 'meli', askingCents: 149_900, askingRaw: '1499', uf: 'PR', city: null,
      title: 'Iphone 12 128Gb Desbloqueado Novo Lacrado', sellerRef: '987654',
    });
    expect(isRejected(li)).toBe(false);
  });

  it('normaliza preco com duas casas sem perder o centavo', () => {
    const li = adapter.toListingInput({ source: 'meli', externalId: 'MLB2222222222', url: 'x', fetchedAt: new Date(), payload: payload.results[1] });
    expect('askingCents' in li && li.askingCents).toBe(115_050);
  });

  it('preco cujo x100 nao e exato e arredondado, nao truncado', () => {
    // o item do fixture (1150.5) NAO prova o arredondamento: 1150.5 * 100 === 115050
    // exatamente. Em float, 2599.95 * 100 === 259994.99999999997, e e esse caso que
    // separa Math.round de Math.floor ou de nenhum round. Sem ele, askingCents chega
    // fracionario numa coluna integer e a mediana da Task 13 herda a fracao.
    const li = adapter.toListingInput({ source: 'meli', externalId: 'MLB4444444444', url: 'x', fetchedAt: new Date(), payload: { ...item, price: 2599.95 } });
    expect('askingCents' in li && li.askingCents).toBe(259_995);
  });

  it('sold_quantity zero e uma medida, nao vira placeholder', () => {
    const li = adapter.toListingInput({ source: 'meli', externalId: 'MLB2222222222', url: 'x', fetchedAt: new Date(), payload: payload.results[1] });
    expect('description' in li ? li.description : null).toBe('condicao:used sold_quantity:0');
  });

  it('state id que nao e BR- nao vira uf inventado', () => {
    const li = adapter.toListingInput({ source: 'meli', externalId: 'MLB5555555555', url: 'x', fetchedAt: new Date(), payload: { ...item, address: { state: { id: 'AR-P', name: 'Paraná' } } } });
    expect('uf' in li && li.uf).toBe(null);
  });

  it('a thumbnail da API e a unica imagem que a fonte entrega', () => {
    const li = adapter.toListingInput({ source: 'meli', externalId: item.id, url: 'x', fetchedAt: new Date(), payload: item });
    expect('imageUrls' in li ? li.imageUrls : null).toEqual([item.thumbnail]);
    const sem = adapter.toListingInput({ source: 'meli', externalId: 'MLB6', url: 'x', fetchedAt: new Date(), payload: { ...item, thumbnail: undefined } });
    expect('imageUrls' in sem ? sem.imageUrls : null).toEqual([]);
  });

  it('descricao carrega condition e sold_quantity, e nenhuma palavra de grade', () => {
    const li = adapter.toListingInput({ source: 'meli', externalId: item.id, url: 'x', fetchedAt: new Date(), payload: item });
    expect('description' in li ? li.description : null).toBe('condicao:new sold_quantity:41');
  });

  it('condition ausente nao deixa rotulo pendurado na descricao', () => {
    const sem = { ...item, condition: undefined };
    const li = adapter.toListingInput({ source: 'meli', externalId: item.id, url: 'x', fetchedAt: new Date(), payload: sem });
    expect('description' in li ? li.description : null).toBe('sold_quantity:41');
  });

  it('sem permalink o adapter preserva a url do raw em vez de inventar hospedeiro', async () => {
    const bruto = { source: 'meli' as const, externalId: 'MLB3333333333', url: 'https://www.mercadolivre.com.br/visitar', fetchedAt: new Date(), payload: { ...item, permalink: undefined } };
    expect(adapter.toListingInput(bruto)).toMatchObject({ url: 'https://www.mercadolivre.com.br/visitar' });
    const search = createMeliAdapter({
      http: async () => ({ status: 200, text: '', error: undefined, json: <T>() => ({ results: [{ ...item, permalink: undefined }] }) as T }),
      token: 'fake', unit: 'MLB',
    });
    const raws = await search.search(monitor, new Date());
    expect(raws[0]!.url).toBe('');
  });

  it('sem token fica indisponivel e health diz o motivo', async () => {
    const off = createMeliAdapter({ http: async () => ({ status: 401, text: '', error: undefined, json: () => null as never }), token: null, unit: 'MLB' });
    expect(off.available).toBe(false);
    expect(await off.health()).toMatchObject({ ok: false, reason: /token/ });
  });

  it('sem token nao sai batendo na API', async () => {
    const calls: string[] = [];
    const off = createMeliAdapter({ http: async (url) => { calls.push(url); return { status: 200, text: '', error: undefined, json: () => null as never }; }, token: null, unit: 'MLB' });
    expect(await off.search({ ...monitor, params: { pages: 3 } }, new Date())).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('string vazia e token ausente: mesma porta, mesmo motivo', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    const vazio = adapterDe([{ status: 200, body: corpo([item]) }], calls, gaps, '');
    expect(vazio.available).toBe(false);
    expect(await vazio.health()).toMatchObject({ ok: false, reason: /MELI_ACCESS_TOKEN/ });
    expect(await vazio.search({ ...monitor, params: { pages: 2 } }, new Date())).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('search devolve um RawListing por item e paga o payload', async () => {
    const raws = await adapter.search(monitor, new Date());
    expect(raws).toHaveLength(2);
    expect(raws[0]!.externalId).toBe('MLB1111111111');
    expect(isMeliItem(raws[0]!.payload)).toBe(true);
    expect(raws[0]!.url).toBe(item.permalink);
  });

  it('payload que nao veio da API vira rejeicao, nao TypeError', () => {
    const nulo = { source: 'meli' as const, externalId: '9001', url: 'u', fetchedAt: new Date(), payload: null };
    expect(adapter.toListingInput(nulo)).toMatchObject({ rejected: true, reason: 'payload-invalido', rawTitle: '9001' });
    const idNumerico = { source: 'meli' as const, externalId: '9002', url: 'u', fetchedAt: new Date(), payload: { id: 9002, title: 'iPhone 12', price: 1499 } };
    expect(adapter.toListingInput(idNumerico)).toMatchObject({ rejected: true, reason: 'payload-invalido', rawTitle: '9002' });
  });

  it('preco ausente, zero e negativo tem motivo proprio, nao payload-invalido', () => {
    const li = (p: unknown) => adapter.toListingInput({ source: 'meli', externalId: 'x', url: 'u', fetchedAt: new Date(), payload: { id: 'x', title: 'iPhone 12', price: p } });
    expect(li(undefined)).toMatchObject({ rejected: true, reason: 'not-a-price', rawTitle: 'iPhone 12' });
    expect(li('1499')).toMatchObject({ rejected: true, reason: 'not-a-price' });
    expect(li(Number.NaN)).toMatchObject({ rejected: true, reason: 'not-a-price' });
    expect(li(0)).toMatchObject({ rejected: true, reason: 'zero' });
    expect(li(-5)).toMatchObject({ rejected: true, reason: 'negativo' });
  });
});

type Step = { status: number; body?: unknown; naoJson?: boolean };
type Call = { url: string; auth?: string };

const corpo = (items: unknown[]): unknown => ({ results: items, paging: { total: items.length, offset: 0, limit: LIMIT } });

const adapterDe = (steps: Step[], calls: Call[], gaps: number[], token: string | null = 'fake', unit = 'MLB') => {
  let i = 0;
  const http: HttpGet = async (url, init) => {
    calls.push({ url, auth: init?.headers?.authorization });
    const s = steps[Math.min(i, steps.length - 1)]!;
    i++;
    return {
      status: s.status,
      text: s.naoJson ? '<html>portal cativo</html>' : JSON.stringify(s.body ?? null),
      error: s.status >= 400 ? ('http' as const) : undefined,
      json: <T>(): T => {
        if (s.naoJson) throw new SyntaxError('Unexpected token < in JSON at position 0');
        return (s.body ?? null) as T;
      },
    };
  };
  return createMeliAdapter({ http, token, unit, onPageGap: async () => { gaps.push(1); } });
};

describe('createMeliAdapter.search', () => {
  it('para na primeira pagina quando a fonte recusa credencial (401)', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    // o corpo traz results reais de proposito: se o 401 devolver pagina vazia, este teste
    // para tambem pelo break de "pagina sem itens" e as duas condicoes de parada ficam
    // indistingutiveis. Com corpo util no 401, quem encerra a varredura e o status.
    const raws = await adapterDe([{ status: 401, body: corpo([item, payload.results[1]]) }], calls, gaps).search({ ...monitor, params: { pages: 3 } }, new Date());
    expect(calls).toHaveLength(1);
    expect(raws).toEqual([]);
    expect(gaps).toHaveLength(0);
  });

  it('para numa pagina sem itens em vez de varrer ate o teto', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    const raws = await adapterDe([{ status: 200, body: corpo([item, payload.results[1]]) }, { status: 200, body: corpo([]) }], calls, gaps)
      .search({ ...monitor, params: { pages: 3 } }, new Date());
    expect(calls).toHaveLength(2);
    expect(gaps).toHaveLength(1);
    expect(raws).toHaveLength(2);
  });

  it('respeita pages e nao dorme depois da ultima', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    const raws = await adapterDe([{ status: 200, body: corpo([item, payload.results[1]]) }], calls, gaps)
      .search({ ...monitor, params: { pages: 2 } }, new Date());
    expect(calls).toHaveLength(2);
    expect(gaps).toHaveLength(1);
    expect(raws).toHaveLength(4);
  });

  it('acima do teto nao varre: pages=99 faz MAX_PAGES chamadas e para', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    await adapterDe([{ status: 200, body: corpo([item]) }], calls, gaps).search({ ...monitor, params: { pages: 99 } }, new Date());
    // o teto e uma politica de consumo de API, nao um detalhe de implementacao: pinar o
    // literal (4 e 3) e o que faz MAX_PAGES mudar de valor quebre a suite. Escrito com a
    // constante, o teto podia virar 99 e este teste continuaria verde.
    expect(MAX_PAGES).toBe(4);
    expect(calls).toHaveLength(4);
    expect(gaps).toHaveLength(3);
  });

  it('pagina por offset, nao por numero de pagina', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    await adapterDe([{ status: 200, body: corpo([item]) }], calls, gaps).search({ ...monitor, params: { pages: 2 } }, new Date());
    expect(calls[0]!.url).toContain(`offset=0`);
    expect(calls[1]!.url).toContain(`offset=${LIMIT}`);
  });

  it('o token vai no header e nunca na URL pedida', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    await adapterDe([{ status: 200, body: corpo([item]) }], calls, gaps).search({ ...monitor, params: { pages: 2 } }, new Date());
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth === 'Bearer fake')).toBe(true);
    expect(calls.every((c) => !c.url.includes('fake'))).toBe(true);
  });

  it('pede o query do monitor, nao um termo fixo do adapter', async () => {
    const calls: Call[] = [];
    await adapterDe([{ status: 200, body: corpo([item]) }], calls, []).search(monitor, new Date());
    expect(calls[0]!.url).toContain('q=iphone+12+128gb');
  });

  it('sem params.pages o padrao e duas paginas, nao uma', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    await adapterDe([{ status: 200, body: corpo([item]) }], calls, gaps).search({ ...monitor, params: {} }, new Date());
    expect(calls).toHaveLength(2);
    expect(gaps).toHaveLength(1);
  });

  it('item que nao passa no guard nao vira RawListing quebrado', async () => {
    const calls: Call[] = [];
    const raws = await adapterDe([{ status: 200, body: corpo([{ id: 1 }]) }], calls, []).search(monitor, new Date());
    expect(raws).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('200 com corpo que nao e JSON para sem lancar e preserva a pagina boa', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    const raws = await adapterDe([{ status: 200, body: corpo([item, payload.results[1]]) }, { status: 200, naoJson: true }], calls, gaps)
      .search({ ...monitor, params: { pages: 3 } }, new Date());
    expect(raws).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(gaps).toHaveLength(1);
  });

  it('health distingue resposta boa de corpo que nao e busca', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    expect(await adapterDe([{ status: 200, body: corpo([]) }], calls, gaps).health()).toEqual({ ok: true });
    expect(await adapterDe([{ status: 200, body: { error: 'bad_request' } }], calls, gaps).health())
      .toMatchObject({ ok: false, reason: 'http 200 / corpo sem results' });
    // portal cativo devolve 200 com HTML: health tem de devolver motivo, nao lancar, porque
    // o boot da Task 16 so sabe ler o objeto do contrato.
    expect(await adapterDe([{ status: 200, naoJson: true }], calls, gaps).health())
      .toMatchObject({ ok: false, reason: 'http 200 / corpo sem results' });
    expect(await adapterDe([{ status: 401, body: { message: 'unauthorized' } }], calls, gaps).health())
      .toMatchObject({ ok: false, reason: 'http 401 / http' });
    expect(calls[calls.length - 1]!.url).toContain('limit=1');
  });

  it('health usa o unit configurado, nao um MLB fixo no corpo do adapter', async () => {
    const calls: Call[] = [];
    await adapterDe([{ status: 200, body: corpo([]) }], calls, [], 'fake', 'MLM').health();
    expect(calls[0]!.url).toContain('/sites/MLM/search');
  });
});

describe('createMeliAdapter.fetchOne', () => {
  it('devolve exatamente o item pedido', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    const raw = await adapterDe([{ status: 200, body: item }], calls, gaps).fetchOne('MLB1111111111');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(itemUrl('MLB1111111111'));
    expect(raw.externalId).toBe('MLB1111111111');
    expect(isMeliItem(raw.payload)).toBe(true);
  });

  it('corpo que devolve outro id nao passa por este id: lanca', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    await expect(adapterDe([{ status: 200, body: payload.results[1] }], calls, gaps).fetchOne('MLB1111111111'))
      .rejects.toThrow(/pediu MLB1111111111, veio MLB2222222222/);
  });

  it('200 sem corpo-util lanca em vez de devolver um raw quebrado', async () => {
    const calls: Call[] = []; const gaps: number[] = [];
    await expect(adapterDe([{ status: 200, naoJson: true }], calls, gaps).fetchOne('MLB1111111111')).rejects.toThrow(/sem id\/title/);
  });

  it('sem token lanca em vez de devolver payload vazio', async () => {
    const off = createMeliAdapter({ http: async () => ({ status: 200, text: '', error: undefined, json: () => null as never }), token: null, unit: 'MLB' });
    await expect(off.fetchOne('MLB1111111111')).rejects.toThrow(/token ausente/);
  });
});
