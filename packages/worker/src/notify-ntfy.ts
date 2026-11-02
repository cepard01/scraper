import { formatBRL } from '@brique/core/money';
import { nullNotifier, type AlertMessage, type NotifyPort } from '@brique/core/notify-port';
import type { RankedRow } from '@brique/core/db/repo/opportunities';
import type { HttpPost } from '@brique/scrapers/http';

export const DEAL_PRIORITY = 4;
export const DIGEST_PRIORITY = 3;
export const SOURCE_DEGRADED_PRIORITY = 5;
export const SOURCE_DEGRADED_TAGS = ['warning'];
export const DEAL_TAGS = ['moneybag'];
export const DIGEST_TAGS = ['bar_chart'];

const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function formatAlert(r: RankedRow, aiVerdict: string | null): AlertMessage {
  const justo = r.fairGrossCents === null ? 'n/d' : formatBRL(r.fairGrossCents);
  const margem = r.marginCents === null ? 'n/d' : formatBRL(r.marginCents);
  const roi = r.marginPct === null ? 'n/d' : pct(r.marginPct);
  const dia = r.expectedPerDayCents === null ? 'n/d' : `~${formatBRL(r.expectedPerDayCents)}/dia`;

  return {
    title: `${r.title} — ${formatBRL(r.askingCents)}`,
    body: [
      `justo ${justo} · margem ${margem} · ROI ${roi} · ${dia}`,
      `score ${Math.round(r.score * 100)} · ${r.city ?? '-'} · n=${r.sampleSize} · IA: ${aiVerdict ?? 'indisponível'}`,
    ].join('\n'),
    tags: DEAL_TAGS,
    priority: DEAL_PRIORITY,
    clickUrl: r.url,
  };
}

export function formatDigest(rows: RankedRow[], dateLabel: string): AlertMessage {
  return {
    title: `Brique · top ${rows.length} · ${dateLabel}`,
    body: rows.map((r, i) =>
      `${i + 1}. ${Math.round(r.score * 100)} · ${r.title} · ${formatBRL(r.askingCents)} · ${r.city ?? '-'}`,
    ).join('\n'),
    tags: DIGEST_TAGS,
    priority: DIGEST_PRIORITY,
    clickUrl: rows[0]?.url ?? '',
  };
}

export function sourceDegradedMessage(
  source: string,
  health: { reason: string | null; detail: string },
): AlertMessage {
  return {
    title: `fonte degradada: ${source}`,
    body: `motivo: ${health.reason ?? 'desconhecido'}\n${health.detail}`,
    tags: SOURCE_DEGRADED_TAGS,
    priority: SOURCE_DEGRADED_PRIORITY,
    clickUrl: '',
  };
}

export function createNtfy(opts: { post: HttpPost; baseUrl: string; topic: string | null }): NotifyPort {
  if (!opts.topic) return nullNotifier();
  const base = opts.baseUrl.replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(opts.topic)}`;

  return {
    async send(m) {
      const headers: Record<string, string> = {
        'Content-Type': 'text/plain; charset=utf-8',
        Title: m.title,
        Priority: String(m.priority),
        Tags: m.tags.join(','),
      };
      if (m.clickUrl.length > 0) headers.Click = m.clickUrl;

      const res = await opts.post(url, m.body, { headers });
      if (res.error) return { ok: false, error: res.error };
      if (res.status < 200 || res.status >= 300) return { ok: false, error: `http ${res.status}` };
      return { ok: true };
    },
  };
}
