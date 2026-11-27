import { describe, it, expect } from 'vitest';
import type { HttpPost, HttpResult } from '@brique/scrapers/http';
import type { TriageInput } from '@brique/core/ai-port';
import type { AiCallEntry, AiCachePort, AiDeferredPort, AiLogPort } from '../src/ports';
import { createAi, leanInput } from '../src/client';
import { cacheKey, canonicalJson } from '../src/canonical';
import { loadCombos } from '../src/combos';

const combos = loadCombos();
const NOW = new Date('2026-11-26T12:00:00Z');

const item = (id: number, title = 'iPhone 12 128GB', over: Record<string, unknown> = {}) => ({
  listingId: id, externalId: `ext-${id}`, title, askingCents: 250_000,
  description: 'usado', city: 'Curitiba', imageUrls: ['a', 'b', 'c', 'd'], ...over,
});

const result = (status: number, text: string, error?: HttpResult['error']): HttpResult => ({
  status, text, error, json: () => JSON.parse(text),
});

function postFrom(responses: Array<HttpResult | ((body: string, init?: { headers?: Record<string, string> }) => HttpResult)>) {
  const calls: Array<{ url: string; body: string; headers?: Record<string, string> }> = [];
  let i = 0;
  const post: HttpPost = async (url, body, init) => {
    calls.push({ url, body, headers: init?.headers });
    const next = responses[Math.min(i++, responses.length - 1)]!;
    return typeof next === 'function' ? next(body, init) : next;
  };
  return { post, calls };
}

function memoryPorts() {
  const store = new Map<string, unknown>();
  const entries: AiCallEntry[] = [];
  const cache: AiCachePort = {
    get: (key) => store.get(key),
    set: (key, value) => { store.set(key, value); },
  };
  const log: AiLogPort = {
    count: (task, from, to) => entries.filter((e) =>
      e.task === task && e.status === 'ok' && e.createdAt >= from && e.createdAt < to).length,
    append: (entry) => { entries.push(entry); },
  };
  return { cache, log, store, entries };
}

function sharedDeferred() {
  const store = new Map<number, TriageInput>();
  const port: AiDeferredPort = {
    list: () => [...store.values()],
    push: (items) => { for (const i of items) store.set(i.listingId, i); },
    remove: (ids) => { for (const id of ids) store.delete(id); },
  };
  return port;
}

const valid = (ids: number[], verdict = 'pass') => JSON.stringify({
  verdicts: ids.map((id) => ({ listingId: id, verdict, reasons: ['ok'] })),
});

const base = (post: HttpPost, over: Record<string, unknown> = {}) => ({
  post, baseUrl: 'http://127.0.0.1:20128/v1/', apiKey: 'teste', clock: () => NOW,
  combos, sleep: async () => {}, maxAttempts: 2, ...over,
});

describe('canonicalJson e cacheKey', () => {
  it('ordem de chaves não muda a chave; conteúdo muda', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    const a = cacheKey('triage.batch', 'brique-triage', { title: 'x', price: 1 });
    expect(a).toBe(cacheKey('triage.batch', 'brique-triage', { price: 1, title: 'x' }));
    expect(a).not.toBe(cacheKey('triage.batch', 'brique-triage', { title: 'y', price: 1 }));
  });
});

describe('createAi.triage', () => {
  it('loteia em 12, reduz o prompt e nunca envia rawPayload', async () => {
    const { post, calls } = postFrom([result(200, valid(Array.from({ length: 12 }, (_, i) => i + 1)))]);
    const ai = createAi(base(post));
    const items = Array.from({ length: 25 }, (_, i) => item(i + 1, `iPhone ${i}`, { rawPayload: 'SEGREDO' }));

    await ai.triage(items);

    expect(calls).toHaveLength(3);
    expect(calls.map((c) => (JSON.parse(c.body).messages[1].content as string).match(/listingId/g)?.length))
      .toEqual([12, 12, 1]);
    expect(calls[0]!.body).not.toContain('SEGREDO');
    expect(calls[0]!.headers).toMatchObject({
      'content-type': 'application/json',
      'x-omniroute-compression': 'aggressive',
      authorization: 'Bearer teste',
    });
    expect(calls[0]!.url).toBe('http://127.0.0.1:20128/v1/chat/completions');

    const lean = leanInput(item(1, 'x', { description: 'a'.repeat(900) })) as { description: string; imageUrls: string[] };
    expect(lean.description).toHaveLength(800);
    expect(lean.imageUrls).toHaveLength(3);
  });

  it('segunda passada igual sai do cache, sem POST e sem contar chamada', async () => {
    const { post, calls } = postFrom([result(200, valid([1]))]);
    const ports = memoryPorts();
    const ai = createAi(base(post, ports));
    const first = await ai.triage([item(1)]);
    const second = await ai.triage([item(1)]);

    expect(first.get(1)?.verdict).toBe('pass');
    expect(second.get(1)?.verdict).toBe('pass');
    expect(calls).toHaveLength(1);
    expect(ai.calls).toBe(1);
    expect(ai.cacheHits).toBe(1);
    expect(ports.entries.filter((e) => e.status === 'cache-hit')).toHaveLength(1);
  });

  it('título novo não reusa cache', async () => {
    const { post, calls } = postFrom([result(200, valid([1])), result(200, valid([1]))]);
    const ports = memoryPorts();
    const ai = createAi(base(post, ports));
    await ai.triage([item(1)]);
    await ai.triage([item(1, 'iPhone 13 128GB')]);
    expect(calls).toHaveLength(2);
    expect(ai.cacheHits).toBe(0);
  });

  it('JSON quebrado usa reparo e, se preciso, regex por item', async () => {
    const { post, calls } = postFrom([
      result(200, '{"verdicts": ['),
      result(200, '{"verdicts":[{"listingId":2,"verdict":"veto","reasons":["foto"]}]}'),
    ]);
    const ai = createAi(base(post));
    const out = await ai.triage([item(1), item(2)]);

    expect(calls).toHaveLength(2);
    expect(out.get(2)).toEqual({ verdict: 'veto', reasons: ['foto'] });
    expect(out.get(1)).toEqual({ verdict: 'unavailable', reasons: [] });

    const broken = postFrom([result(200, 'lixo'), result(200, 'mais lixo')]);
    const regexAi = createAi(base(broken.post));
    const regexOut = await regexAi.triage([
      item(1), item(2),
    ]);
    // Um array inteiro quebrado não pode dar opinião por ninguém; o degrau de
    // regex só age quando há objeto reconhecível na resposta.
    expect(regexOut.get(1)?.verdict).toBe('unavailable');
    expect(broken.calls).toHaveLength(2);
  });

  it('429 vira retry com jitter e não derruba a triagem', async () => {
    const { post, calls } = postFrom([result(429, 'rate'), result(200, valid([1]))]);
    const ports = memoryPorts();
    const ai = createAi(base(post, ports));
    const out = await ai.triage([item(1)]);

    expect(out.get(1)?.verdict).toBe('pass');
    expect(calls).toHaveLength(2);
    expect(ai.calls).toBe(1);
    expect(ports.entries.find((e) => e.status === 'ok')?.attempts).toBe(2);
  });

  it('budget esgotado posterga em fila, sem POST e sem falha', async () => {
    const { post, calls } = postFrom([result(200, valid([1]))]);
    const ports = memoryPorts();
    const ai = createAi(base(post, { ...ports, limits: { 'triage.batch': 1 } }));

    await ai.triage([item(1)]);
    const out = await ai.triage([item(2)]);

    expect(calls).toHaveLength(1);
    expect(out.get(2)).toEqual({ verdict: 'unavailable', reasons: ['ia-budget'] });
    expect(ai.paused).toBe(true);
    expect(ai.queued).toBe(1);
    expect(ports.entries.filter((e) => e.status === 'budget')).toHaveLength(1);
  });

  it('fila injetada sobrevive a nova instância do cliente', async () => {
    const ports = memoryPorts();
    const deferred = sharedDeferred();
    const firstPost = postFrom([result(200, valid([1]))]);
    const first = createAi(base(firstPost.post, { ...ports, deferred, limits: { 'triage.batch': 1 } }));

    await first.triage([item(1)]);
    const blocked = await first.triage([item(2)]);

    expect(blocked.get(2)?.reasons).toEqual(['ia-budget']);
    expect(deferred.list().map((i) => i.listingId)).toEqual([2]);

    const secondPost = postFrom([result(200, valid([2, 3]))]);
    const second = createAi(base(secondPost.post, { ...ports, deferred, limits: { 'triage.batch': 2 } }));
    const out = await second.triage([item(3)]);

    expect(out.get(2)?.verdict).toBe('pass');
    expect(out.get(3)?.verdict).toBe('pass');
    expect(secondPost.calls).toHaveLength(1);
    expect(deferred.list()).toEqual([]);
    expect(second.queued).toBe(0);
  });

  it('três falhas abrem circuito por 15 min e o relógio injetado o fecha', async () => {
    let now = NOW.getTime();
    const { post, calls } = postFrom([result(429, 'rate')]);
    const ports = memoryPorts();
    const ai = createAi(base(post, { ...ports, clock: () => new Date(now) }));
    const one = [item(1)];

    await ai.triage(one);
    await ai.triage(one);
    await ai.triage(one);
    const antes = calls.length;
    const bloqueado = await ai.triage(one);

    expect(bloqueado.get(1)?.reasons).toEqual(['ia-circuit']);
    expect(calls.length).toBe(antes);
    expect(ai.state().circuitOpenUntil['triage.batch']).toBe(now + 900_000);
    expect(ai.paused).toBe(true);

    now += 900_001;
    await ai.triage(one);
    expect(calls.length).toBe(antes + 2); // retry do 429 + chamada seguinte
  });
});
