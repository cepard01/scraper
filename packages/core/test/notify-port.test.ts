import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDiscordPayload,
  createSendLimiter,
  DISCORD_SUSPICIOUS_THRESHOLD,
  nullNotifier,
  NULL_NOTIFY_REASON,
  type DealEmbedContext,
  type AlertMessage,
} from '../src/notify-port';

const ctx = (over: Partial<DealEmbedContext> = {}): DealEmbedContext => ({
  watchId: 'iphone-15-rj',
  priceCents: 250_000,
  baselineCents: 400_000,
  belowPct: 37.5,
  basis: 'median',
  samples: 42,
  city: 'Rio de Janeiro',
  neighbourhood: 'Tijuca',
  thumbUrl: 'https://img.olx.com.br/a.jpg',
  timestamp: new Date('2026-11-26T12:00:00Z'),
  ...over,
});

const msg = (over: Partial<AlertMessage> = {}): AlertMessage => ({
  title: 'iPhone 15 Pro 256gb',
  body: 'justo R$ 4.000,00',
  tags: ['moneybag'],
  priority: 4,
  clickUrl: 'https://rj.olx.com.br/x',
  discord: ctx(),
  ...over,
});

afterEach(() => vi.useRealTimers());

describe('buildDiscordPayload', () => {
  it('monta o embed completo do negócio', () => {
    const payload = buildDiscordPayload(msg());
    expect(payload.username).toBe('Scrapelytics');
    expect(payload.embeds).toHaveLength(1);
    const embed = payload.embeds[0]!;
    expect(embed.title).toBe('iPhone 15 Pro 256gb');
    expect(embed.url).toBe('https://rj.olx.com.br/x');
    expect(embed.color).toBe(0x2ecc71);
    expect(String(embed.description)).toContain('R$ 2.500,00');
    expect(String(embed.description)).toContain('37.5%');
    expect(String(embed.description)).toContain('mediana de 42 anúncios');
    expect(String(embed.description)).toContain('Tijuca, Rio de Janeiro');
    expect(JSON.stringify(embed.thumbnail)).toContain('img.olx.com.br');
    expect(payload.content).toBeUndefined();
  });

  it('marca desconto extremo e preserva o timestamp informado', () => {
    const payload = buildDiscordPayload(msg({ discord: ctx({ belowPct: DISCORD_SUSPICIOUS_THRESHOLD + 10 }) }));
    const embed = payload.embeds[0]!;
    expect(embed.color).toBe(0xe67e22);
    expect(String(embed.description)).toContain('golpe');
    expect(embed.timestamp).toBe('2026-11-26T12:00:00.000Z');
  });

  it('cold start comunica o teto manual', () => {
    const payload = buildDiscordPayload(msg({ discord: ctx({ basis: 'manual', samples: 2 }) }));
    expect(String(payload.embeds[0]!.description)).toContain('teto manual (cold start)');
  });

  it('mencão entra no content, não no embed', () => {
    const payload = buildDiscordPayload(msg({ discord: ctx({ mention: '<@123>' }) }));
    expect(payload.content).toBe('<@123>');
  });

  it('sem contexto de negócio devolve embed genérico a partir do AlertMessage', () => {
    const payload = buildDiscordPayload(msg({ discord: undefined }));
    expect(payload.embeds[0]).toMatchObject({ title: 'iPhone 15 Pro 256gb', description: 'justo R$ 4.000,00' });
  });
});

describe('nullNotifier', () => {
  it('falha honestamente em vez de fingir entrega', async () => {
    expect(await nullNotifier().send(msg())).toEqual({ ok: false, error: NULL_NOTIFY_REASON });
  });
});

describe('createSendLimiter', () => {
  it('serializa e respeita o intervalo mínimo com timers falsos', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    const limiter = createSendLimiter(500);
    const order: number[] = [];
    const first = limiter.run(async () => { order.push(1); return 1; });
    const second = limiter.run(async () => { order.push(2); return 2; });

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1]);
    await vi.advanceTimersByTimeAsync(499);
    expect(order).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual([1, 2]);
    expect(await Promise.all([first, second])).toEqual([1, 2]);
  });

  it('uma entrega que lança não trava as seguintes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    const limiter = createSendLimiter(100);
    const falha = limiter.run(async () => { throw new Error('http 500'); });
    const ok = limiter.run(async () => 'entregue');
    await vi.advanceTimersByTimeAsync(100);
    await expect(falha).rejects.toThrow(/500/);
    expect(await ok).toBe('entregue');
  });
});
