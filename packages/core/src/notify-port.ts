import { formatBRL } from './money';
import type { Cents } from './types';

export interface AlertMessage {
  title: string;
  body: string;
  tags: string[];
  priority: number;
  clickUrl: string;
  /** Dados do embed Discord; transportes sem embed (ntfy) simplesmente ignoram. */
  discord?: DealEmbedContext;
}

export interface DealEmbedContext {
  watchId: string;
  priceCents: Cents;
  baselineCents: Cents | null;
  belowPct: number | null;
  basis: 'median' | 'manual';
  samples: number;
  city?: string | null;
  neighbourhood?: string | null;
  thumbUrl?: string | null;
  mention?: string;
  timestamp?: Date;
}

export interface DiscordPayload {
  username: string;
  content?: string;
  embeds: Array<Record<string, unknown>>;
}

export interface NotifyPort {
  send(m: AlertMessage): Promise<{ ok: boolean; error?: string }>;
}

export const NULL_NOTIFY_REASON = 'alertas desligados (sem DISCORD_WEBHOOK_URL/NTFY_TOPIC)';
export const DISCORD_SUSPICIOUS_THRESHOLD = 60;
const GREEN = 0x2ecc71;
const AMBER = 0xe67e22;

// A no-op that reports success would mark alerts as delivered when nothing left
// the machine. The port stays callable on a clean machine, but the failure is
// recorded honestly so the panel can show why no push arrived.
export function nullNotifier(): NotifyPort {
  return {
    async send() {
      return { ok: false, error: NULL_NOTIFY_REASON };
    },
  };
}

// Builder puro: o transporte Discord em packages/worker só faz o POST. Assim o
// formato do embed é testável sem rede e sem webhook.
export function buildDiscordPayload(m: AlertMessage): DiscordPayload {
  const c = m.discord;
  if (!c) {
    return { username: 'Scrapelytics', embeds: [{ title: m.title.slice(0, 256), url: m.clickUrl, description: m.body }] };
  }

  const suspicious = c.belowPct !== null && c.belowPct > DISCORD_SUSPICIOUS_THRESHOLD;
  const basisLabel = c.basis === 'median' ? `mediana de ${c.samples} anúncios` : 'teto manual (cold start)';
  const lines = [
    c.belowPct !== null ? `🔻 **${c.belowPct}% abaixo da base**` : null,
    `**${formatBRL(c.priceCents)}**`,
    c.baselineCents !== null
      ? `Base: ${formatBRL(c.baselineCents)} (${basisLabel})`
      : `Base: ${basisLabel}`,
    c.city ?? c.neighbourhood ? `📍 ${[c.neighbourhood, c.city].filter(Boolean).join(', ')}` : null,
    suspicious ? '⚠️ Desconto extremo — desconfie de golpe' : null,
  ].filter((line): line is string => line !== null);

  const embed: Record<string, unknown> = {
    title: m.title.slice(0, 256),
    url: m.clickUrl,
    description: lines.join('\n'),
    color: suspicious ? AMBER : GREEN,
    footer: { text: `${c.watchId} · Scrapelytics` },
    timestamp: (c.timestamp ?? new Date()).toISOString(),
  };
  if (c.thumbUrl) embed.thumbnail = { url: c.thumbUrl };
  return {
    username: 'Scrapelytics',
    ...(c.mention ? { content: c.mention } : {}),
    embeds: [embed],
  };
}

export interface SendLimiter {
  /** Serializa entregas e mantém no mínimo `minIntervalMs` entre duas delas. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSendLimiter(
  minIntervalMs: number,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): SendLimiter {
  const now = opts.now ?? Date.now;
  const nap = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let nextAt = 0;
  let chain: Promise<unknown> = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = chain.then(async () => {
        const wait = Math.max(0, nextAt - now());
        if (wait > 0) await nap(wait);
        try {
          return await task();
        } finally {
          nextAt = now() + minIntervalMs;
        }
      });
      chain = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
