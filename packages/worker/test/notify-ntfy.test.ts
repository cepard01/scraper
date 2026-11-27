import { describe, it, expect, vi } from 'vitest';
import { formatAlert, formatDigest, createNtfy, encodeHeaderValue } from '../src/notify-ntfy';
import { NULL_NOTIFY_REASON } from '@brique/core/notify-port';
import type { RankedRow } from '@brique/core/db/repo/opportunities';

const TOPIC = 'topico-secreto-que-nao-pode-vazar';
const BASE = 'https://ntfy.example';

const row = (over: Partial<RankedRow> = {}): RankedRow => ({
  opportunityId: 1, listingId: 1, externalId: 'DEAL-A', source: 'olx', title: 'iPhone 12 128GB Desbloqueado',
  url: 'https://olx.com.br/a/1', city: 'Curitiba', askingCents: 98_000, fairGrossCents: 148_000,
  marginCents: 34_000, marginPct: 0.34, expectedPerDayCents: 2_400, liquidityDays: 10,
  score: 0.81, breakdown: { profitFactor: 1, liquidityFactor: 1, confidenceFactor: 1, freshnessFactor: 1 },
  sampleSize: 9, confidence: 'high', ...over,
});

describe('formatAlert', () => {
  it('congela as tres linhas da §9 sem topic nem baseUrl', () => {
    const msg = formatAlert(row(), 'sem indício de golpe');
    expect([msg.title, msg.body, msg.clickUrl].join('\n')).toMatchSnapshot();
    const serialized = JSON.stringify(msg);
    expect(serialized).not.toContain(TOPIC);
    expect(serialized).not.toContain(BASE);
  });

  it('valuation ausente nao vira NaN nem numero inventado', () => {
    const msg = formatAlert(row({ fairGrossCents: null, marginCents: null, marginPct: null, expectedPerDayCents: null, sampleSize: 0, confidence: 'none' }), null);
    expect(msg.body).toContain('justo n/d · margem n/d · ROI n/d · n/d');
    expect(msg.body).toContain('n=0');
    expect(msg.body).toContain('IA: indisponível');
    expect(msg.body).not.toContain('NaN');
  });
});

describe('formatDigest', () => {
  it('lista o top com score, titulo, pedido e cidade', () => {
    const msg = formatDigest([row(), row({ listingId: 2, title: 'PS5 Slim', askingCents: 180_000, city: null })], '2026-11-02');
    expect(msg).toMatchSnapshot();
  });
});

describe('createNtfy', () => {
  it('sem topic devolve o nullNotifier que falha honestamente', async () => {
    const port = createNtfy({ post: vi.fn(), baseUrl: BASE, topic: null });
    const res = await port.send(formatAlert(row(), null));
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NULL_NOTIFY_REASON);
  });

  it('com topic posta no base/topic com Title, Priority, Tags, Click e corpo', async () => {
    let captured: { url: string; body: string; headers: Record<string, string> } | null = null;
    const post = async (url: string, body: string, init?: { headers?: Record<string, string> }) => {
      captured = { url, body, headers: init?.headers ?? {} };
      return { status: 200, text: '', json: <T>() => null as T };
    };
    const port = createNtfy({ post, baseUrl: BASE + '/', topic: TOPIC });
    const msg = formatAlert(row(), null);

    const res = await port.send(msg);

    expect(res.ok).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(`${BASE}/${TOPIC}`);
    expect(captured!.body).toBe(msg.body);
    expect(captured!.headers.Title).toBe(encodeHeaderValue(msg.title));
    expect(captured!.headers.Priority).toBe('4');
    expect(captured!.headers.Tags).toBe('moneybag');
    expect(captured!.headers.Click).toBe(row().url);
  });

  it('titulo com travessao e emoji e aceito pelo fetch de verdade', async () => {
    let captured: { headers: Record<string, string> } | null = null;
    const post = async (_url: string, _body: string, init?: { headers?: Record<string, string> }) => {
      captured = { headers: init?.headers ?? {} };
      return { status: 200, text: '', json: <T>() => null as T };
    };
    const msg = formatAlert(row({ title: 'iPhone 15 — 256GB 💥' }), null);
    const res = await createNtfy({ post, baseUrl: BASE, topic: TOPIC }).send(msg);
    const title = captured!.headers.Title!;

    expect(res.ok).toBe(true);
    expect(title).toMatch(/^=\?UTF-8\?B\?/);
    expect(Buffer.from(title.match(/B\?([^?]+)\?=/)![1]!, 'base64').toString('utf8')).toBe(msg.title);
    // O contrato que quebrava em producao: undici recusa code point > 255 em header.
    expect(() => new Request('https://ntfy.invalid/', { method: 'POST', headers: captured!.headers })).not.toThrow();
  });

  it('quebra de linha no título é codificada e não derruba o POST', async () => {
    let captured: { headers: Record<string, string> } | null = null;
    const post = async (_url: string, _body: string, init?: { headers?: Record<string, string> }) => {
      captured = { headers: init?.headers ?? {} };
      return { status: 200, text: '', json: <T>() => null as T };
    };
    const msg = {
      title: 'iPhone 12\nR$ 900', body: 'x', tags: ['moneybag'], priority: 4, clickUrl: '',
    };
    const res = await createNtfy({ post, baseUrl: BASE, topic: TOPIC }).send(msg);
    const title = captured!.headers.Title!;

    expect(res.ok).toBe(true);
    expect(title).toMatch(/^=\?UTF-8\?B\?/);
    expect(Buffer.from(title.match(/B\?([^?]+)\?=/)![1]!, 'base64').toString('utf8')).toBe(msg.title);
    expect(() => new Request('https://ntfy.invalid/', { method: 'POST', headers: captured!.headers })).not.toThrow();
  });

  it('codifica controles C0/DEL, mas deixa tab e latin-1 legíveis', () => {
    expect(encodeHeaderValue('a\nb\r\u0000\u001f\u007f')).toMatch(/^=\?UTF-8\?B\?/);
    expect(encodeHeaderValue('a\tb café')).toBe('a\tb café');
  });

  it('erro do transporte vira ok:false, sem lancar', async () => {
    const post = vi.fn(async () => ({ status: 0, text: '', error: 'timeout' as const, json: <T>() => null as T }));
    const port = createNtfy({ post, baseUrl: BASE, topic: TOPIC });
    const res = await port.send(formatAlert(row(), null));
    expect(res).toEqual({ ok: false, error: 'timeout' });
  });

  it('status fora de 2xx vira ok:false http <status>', async () => {
    const post = vi.fn(async () => ({ status: 503, text: '', json: <T>() => null as T }));
    const port = createNtfy({ post, baseUrl: BASE, topic: TOPIC });
    const res = await port.send(formatAlert(row(), null));
    expect(res).toEqual({ ok: false, error: 'http 503' });
  });
});
