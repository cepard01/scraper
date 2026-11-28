import { describe, expect, it } from 'vitest';
import { createAi } from '@brique/ai';
import { loadCombos } from '@brique/ai';
import type { FetchLike } from '@brique/scrapers/http';
import { createWorkerPosts } from '../src/posts';

const NOW = new Date('2026-11-27T12:00:00Z');
const combos = loadCombos();

describe('createWorkerPosts', () => {
  it('ntfy repete no transporte; IA deixa todo retry para packages/ai', async () => {
    let fetches = 0;
    const fetchImpl: FetchLike = async () => {
      fetches++;
      return { status: fetches === 1 ? 429 : 200, body: '{}', json: () => ({}) };
    };
    const { post, postAi } = createWorkerPosts({ fetchImpl, baseDelayMs: 0 });

    await post('http://gateway/ntfy', '{}');
    expect(fetches).toBe(2);
    await postAi('http://gateway/ai', '{}');
    expect(fetches).toBe(3); // uma única ida
  });

  it('tempestade de 429 na IA resulta em exatamente cinco POSTs', async () => {
    let fetches = 0;
    const fetchImpl: FetchLike = async () => { fetches++; return { status: 429, body: 'rate', json: () => ({}) }; };
    const { postAi } = createWorkerPosts({ fetchImpl, baseDelayMs: 0 });
    const entries: Array<{ status: string; attempts: number }> = [];
    const log = {
      count: () => entries.filter((e) => e.status === 'ok').length,
      append: (e: { status: string; attempts: number }) => { entries.push(e); },
    };
    const ai = createAi({
      post: postAi, baseUrl: 'http://127.0.0.1:20128/v1', apiKey: 'fake', clock: () => NOW,
      combos, log, sleep: async () => {},
    } as Parameters<typeof createAi>[0]);

    await ai.triage([{ listingId: 1, externalId: 'e1', title: 'iPhone 12', askingCents: 250_000 }]);

    expect(fetches).toBe(5);
    expect(entries.find((e) => e.status === 'failed')?.attempts).toBe(5);
  });
});
