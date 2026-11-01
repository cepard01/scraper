import { describe, it, expect } from 'vitest';
import { createHttp, jitter, sleep } from '../src/http';

describe('createHttp', () => {
  it('respeita o timeout e devolve erro nomeado, sem estourar', async () => {
    const http = createHttp({
      userAgent: 'test',
      timeoutMs: 20,
      maxAttempts: 1,
      fetchImpl: (url, init) =>
        new Promise((_resolve, reject) => {
          // um fetch de verdade rejeita com AbortError quando o signal é acionado;
          // o mock precisa fazer o mesmo, senão a tentativa "vence" em 300ms e o
          // teste receberia status 200 em vez de timeout.
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted') as Error & { name: string };
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });
    const res = await http('https://exemplo.invalid');
    expect(res.status).toBe(0);
    expect(res.error).toBe('timeout');
  });

  it('faz retry com backoff em 429 e desiste com erro nomeado', async () => {
    let calls = 0;
    const http = createHttp({
      userAgent: 'test', timeoutMs: 1000, maxAttempts: 3, baseDelayMs: 1,
      fetchImpl: async () => { calls++; return { status: 429, body: '' } as never; },
    });
    const res = await http('https://exemplo.invalid');
    expect(res.status).toBe(429);
    expect(calls).toBe(3);
  });

  it('json() faz parse do texto', async () => {
    const http = createHttp({ userAgent: 't', fetchImpl: async () => ({ status: 200, body: '{"a":1}' } as never) });
    const res = await http('https://exemplo.invalid');
    expect(res.json<{ a: number }>().a).toBe(1);
  });
});

describe('jitter/sleep', () => {
  it('jitter fica dentro do intervalo', () => {
    for (let i = 0; i < 50; i++) {
      const v = jitter(1500, 4000);
      expect(v).toBeGreaterThanOrEqual(1500);
      expect(v).toBeLessThanOrEqual(4000);
    }
  });
  it('sleep espera', async () => {
    const t0 = Date.now();
    await sleep(15);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10);
  });
});
