import { describe, expect, it } from 'vitest';
import { loadCombos } from '@brique/ai/combos';
import type { HttpGet, HttpPost, HttpResult } from '@brique/scrapers/http';
import { adminUrlFrom, parseProviders, runSetup } from '../scripts/omniroute-setup';

const SECRET = 'chave-que-nao-deve-aparecer';
const res = (status: number, text = ''): HttpResult => ({ status, text, json: <T>() => JSON.parse(text) as T });

describe('adminUrlFrom', () => {
  it('troca /v1 por /admin e aceita override', () => {
    expect(adminUrlFrom('https://gateway.local/v1', null)).toBe('https://gateway.local/admin');
    expect(adminUrlFrom('https://gateway.local/v1/', null)).toBe('https://gateway.local/admin');
    expect(adminUrlFrom('https://gateway.local/v1', 'https://outro.local/admin/')).toBe('https://outro.local/admin');
  });
});

describe('parseProviders', () => {
  it('aceita array ou envelope e devolve só nomes gratuitos únicos', () => {
    const envelope = {
      providers: [
        { name: 'pool-a', tier: 'free' },
        { name: 'pool-b', paid: true },
        { id: 'pool-c', cost: 0 },
        { name: 'pool-a', free: true },
        'pool-d',
      ],
    };
    expect(parseProviders(envelope)).toEqual(['pool-a', 'pool-c', 'pool-d']);
    expect(parseProviders([])).toEqual([]);
    expect(parseProviders({ outro: [] })).toEqual([]);
  });
});

describe('runSetup', () => {
  it('envia os quatro combos com auth e lista os gratuitos', async () => {
    const posts: Array<{ url: string; body: string; auth?: string }> = [];
    const gets: string[] = [];
    const post: HttpPost = async (url, body, init) => {
      posts.push({ url, body, auth: init?.headers?.authorization });
      return res(201, '{}');
    };
    const get: HttpGet = async (url) => {
      gets.push(url);
      return res(200, JSON.stringify({ providers: [{ name: 'gratis', tier: 'free' }] }));
    };

    const result = await runSetup({
      adminUrl: 'https://gateway.local/admin', apiKey: SECRET,
      combos: loadCombos(), post, get,
    });

    expect(result.uploaded).toEqual([
      'triage.batch', 'normalize.product', 'audit.vision', 'negotiate.chat',
    ]);
    expect(result.freeProviders).toEqual(['gratis']);
    expect(result.errors).toEqual([]);
    expect(posts).toHaveLength(4);
    expect(posts.every((p) => p.url === 'https://gateway.local/admin/combos')).toBe(true);
    expect(posts.every((p) => p.auth === `Bearer ${SECRET}`)).toBe(true);
    expect(JSON.parse(posts[0]!.body)).toMatchObject({ task: 'triage.batch', name: 'brique-triage', strategy: 'priority' });
    expect(gets).toEqual(['https://gateway.local/admin/providers']);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('falha parcial é relatada por tarefa, sem expor a chave', async () => {
    const post: HttpPost = async (_url, body) => res(body.includes('audit.vision') ? 503 : 200);
    const get: HttpGet = async () => res(500, 'erro');

    const result = await runSetup({
      adminUrl: 'https://gateway.local/admin', apiKey: SECRET,
      combos: loadCombos(), post, get,
    });

    expect(result.uploaded).toHaveLength(3);
    expect(result.errors).toEqual(['audit.vision: http 503', 'providers: http 500']);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
