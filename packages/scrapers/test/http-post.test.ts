import { describe, it, expect } from 'vitest';
import { createHttpPost } from '../src/http';

describe('createHttpPost', () => {
  it('manda POST com corpo e headers, sem jitter e sem fallback de metodo', async () => {
    const calls: { url: string; init?: { method?: string; body?: string; headers?: Record<string, string> } }[] = [];
    const post = createHttpPost({
      timeoutMs: 1_000,
      fetchImpl: async (url, init) => { calls.push({ url, init }); return { status: 200, body: 'ok' }; },
    });

    const res = await post('https://ntfy.sh/t', 'mensagem', { headers: { Title: 'oi' } });

    expect(res.status).toBe(200);
    expect(res.error).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://ntfy.sh/t');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.body).toBe('mensagem');
    expect(calls[0]!.init?.headers).toEqual({ Title: 'oi' });
  });

  it('retenta 429/5xx com backoff e devolve a resposta que passar', async () => {
    let calls = 0;
    const post = createHttpPost({
      maxAttempts: 3,
      baseDelayMs: 1,
      fetchImpl: async () => {
        calls++;
        return calls < 3 ? { status: 503, body: '' } : { status: 200, body: 'ok' };
      },
    });

    const res = await post('https://ntfy.sh/t', 'x');
    expect(calls).toBe(3);
    expect(res.status).toBe(200);
  });

  it('4xx nao retenta e volta com error http', async () => {
    let calls = 0;
    const post = createHttpPost({
      maxAttempts: 3,
      baseDelayMs: 1,
      fetchImpl: async () => { calls++; return { status: 400, body: 'bad' }; },
    });

    const res = await post('https://ntfy.sh/t', 'x');
    expect(calls).toBe(1);
    expect(res.status).toBe(400);
    expect(res.error).toBe('http');
  });

  it('timeout vira error timeout depois de esgotar as tentativas', async () => {
    let calls = 0;
    const post = createHttpPost({
      maxAttempts: 2,
      baseDelayMs: 1,
      fetchImpl: async () => {
        calls++;
        throw Object.assign(new Error('abort'), { name: 'AbortError' });
      },
    });

    const res = await post('https://ntfy.sh/t', 'x');
    expect(calls).toBe(2);
    expect(res.status).toBe(0);
    expect(res.error).toBe('timeout');
  });
});
