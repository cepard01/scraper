import {
  buildDiscordPayload,
  createSendLimiter,
  nullNotifier,
  type NotifyPort,
  type SendLimiter,
} from '@brique/core/notify-port';
import type { HttpPost } from '@brique/scrapers/http';

export const DISCORD_MIN_INTERVAL_MS = 500;

// O builder do embed vive em core (puro); aqui só existe o POST e a cadência.
// A URL do webhook nunca entra em log nem em reason de deal_alert.
export function createDiscord(opts: {
  post: HttpPost;
  webhookUrl: string | null;
  limiter?: SendLimiter;
}): NotifyPort {
  if (!opts.webhookUrl) return nullNotifier();
  const limiter = opts.limiter ?? createSendLimiter(DISCORD_MIN_INTERVAL_MS);
  const url = opts.webhookUrl;

  return {
    send(m) {
      return limiter.run(async () => {
        const res = await opts.post(url, JSON.stringify(buildDiscordPayload(m)), {
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.error) return { ok: false, error: res.error };
        if (res.status < 200 || res.status >= 300) return { ok: false, error: `http ${res.status}` };
        return { ok: true };
      });
    },
  };
}
