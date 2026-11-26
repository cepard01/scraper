import type { Db } from './db/client';
import { loadSettings, setSettings } from './db/seed-settings';
import { insertDealAlert } from './db/repo/alerts';
import { listShortlistedRanked, type RankedRow } from './db/repo/opportunities';
import { localDateKey, shouldSendDigest } from './alerts';
import type { AlertMessage, NotifyPort } from './notify-port';

export const DIGEST_LIMIT = 10;

export interface DigestOutcome {
  sent: boolean;
  rows: number;
  reason?: string;
}

// O digest é um efeito do worker, não da pipeline: ele resume o shortlist já
// calculado e não pode atrasar nem derrubar uma passada de scrape. A hora e o
// último envio moram em setting, então restart não repete o resumo do dia.
export async function runDigest(opts: {
  db: Db;
  notify: NotifyPort;
  now: () => Date;
  tz: string;
  format: (rows: RankedRow[], dateLabel: string) => AlertMessage;
  limit?: number;
}): Promise<DigestOutcome> {
  const settings = loadSettings(opts.db);
  const now = opts.now();
  if (!shouldSendDigest(now, {
    hourLocal: settings.digestHourLocal, tz: opts.tz, lastDigestAt: settings.lastDigestAt,
  })) return { sent: false, rows: 0, reason: 'fora-da-hora' };

  const rows = listShortlistedRanked(opts.db, opts.limit ?? DIGEST_LIMIT);
  if (rows.length === 0) return { sent: false, rows: 0, reason: 'sem-itens' };

  const label = localDateKey(now, opts.tz);
  let result: { ok: boolean; error?: string };
  try {
    result = await opts.notify.send(opts.format(rows, label));
  } catch (err) {
    result = { ok: false, error: (err as Error).message.split('\n')[0] ?? 'erro-no-digest' };
  }

  const reason = result.ok ? null : (result.error ?? 'entrega-recusada').slice(0, 200);
  for (const r of rows) {
    insertDealAlert(opts.db, {
      opportunityId: r.opportunityId, listingId: r.listingId, channel: 'digest',
      alertedAtCents: r.askingCents, status: result.ok ? 'sent' : 'failed',
      reason, createdAt: now,
    });
  }
  if (!result.ok) return { sent: false, rows: rows.length, reason: reason ?? undefined };

  setSettings(opts.db, { lastDigestAt: now });
  return { sent: true, rows: rows.length };
}
