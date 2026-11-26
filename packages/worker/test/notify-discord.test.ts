import { afterEach, describe, expect, it, vi } from 'vitest';
import { NULL_NOTIFY_REASON, createSendLimiter, type AlertMessage } from '@brique/core/notify-port';
import type { HttpResult } from '@brique/scrapers/http';
import { createDiscord, DISCORD_MIN_INTERVAL_MS } from '../src/notify-discord';

const WEBHOOK = 'https://discord.example/webhook/token-secreto';

const msg = (): AlertMessage => ({
  title: 'iPhone 15 — R$ 2.500,00',
  body: '37.5% abaixo da base',
  tags: ['moneybag'],
  priority: 4,
  clickUrl: 'https://rj.olx.com.br/anuncio/1',
  discord: {
    watchId: 'iphone-15-rj', priceCents: 250_000, baselineCents: 400_000,
    belowPct: 37.5, basis: 'median', samples: 15, city: 'Rio de Janeiro',
    timestamp: new Date('2026-11-26T12:00:00Z'),
  },
});

const ok = (status = 204): HttpResult => ({ status, text: '', json: <T>() => null as T });

afterEach(() => vi.useRealTimers());

describe('createDiscord', () => {
  it('sem webhook falha honestamente e não faz POST', async () => {
    const post = vi.fn(async () => ok());
    const res = await createDiscord({ post, webhookUrl: null }).send(msg());
    expect(res).toEqual({ ok: false, error: NULL_NOTIFY_REASON });
    expect(post).not.toHaveBeenCalled();
  });

  it('POSTA o payload do builder com content-type JSON', async () => {
    let captured: { url: string; body: string; headers?: Record<string, string> } | null = null;
    const post = async (url: string, body: string, init?: { headers?: Record<string, string> }) => {
      captured = { url, body, headers: init?.headers };
      return ok();
    };
    const res = await createDiscord({ post, webhookUrl: WEBHOOK }).send(msg());

    expect(res).toEqual({ ok: true });
    expect(captured!.url).toBe(WEBHOOK);
    expect(captured!.headers).toEqual({ 'Content-Type': 'application/json' });
    const payload = JSON.parse(captured!.body);
    expect(payload.username).toBe('Scrapelytics');
    expect(payload.embeds[0]).toMatchObject({ color: 0x2ecc71, footer: { text: 'iphone-15-rj · Scrapelytics' } });
    expect(payload.embeds[0].description).toContain('mediana de 15 anúncios');
    expect(captured!.body).not.toContain('token-secreto');
  });

  it('erro do transporte e status fora de 2xx viram ok:false', async () => {
    const timeout = vi.fn(async () => ({ ...ok(0), error: 'timeout' as const }));
    expect(await createDiscord({ post: timeout, webhookUrl: WEBHOOK }).send(msg()))
      .toEqual({ ok: false, error: 'timeout' });

    const bad = vi.fn(async () => ok(503));
    expect(await createDiscord({ post: bad, webhookUrl: WEBHOOK }).send(msg()))
      .toEqual({ ok: false, error: 'http 503' });
  });

  it('serializa entregas com intervalo mínimo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    let posts = 0;
    const post = async () => { posts++; return ok(); };
    const port = createDiscord({
      post, webhookUrl: WEBHOOK,
      limiter: createSendLimiter(DISCORD_MIN_INTERVAL_MS),
    });

    const first = port.send(msg());
    const second = port.send(msg());
    await vi.advanceTimersByTimeAsync(0);
    expect(posts).toBe(1);
    await vi.advanceTimersByTimeAsync(DISCORD_MIN_INTERVAL_MS - 1);
    expect(posts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(posts).toBe(2);
    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
  });
});
