import { eq, like, sql } from 'drizzle-orm';
import type { Db } from './db/client';
import { settings } from './db/schema';
import type { SourceHealth } from './source-health';
import type { SourceId } from './types';

export const healthSettingKey = (source: SourceId, reason: string): string =>
  `health:${source}:${reason}`;

interface HealthNoticeState {
  detail: string;
  at: string;
}

const read = (db: Db, key: string): HealthNoticeState | null => {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  if (!row) return null;
  try { return JSON.parse(row.value) as HealthNoticeState; } catch { return null; }
};

export function clearHealthNotices(db: Db, source: SourceId): void {
  db.delete(settings).where(like(settings.key, `health:${source}:%`)).run();
}

// O dedupe vive em setting com chave namespaced: sobrevive a restart e não
// disputa espaço com os settings numéricos. Só a entrega confirmada marca a
// chave — um aviso que falhou continua pendente no tick seguinte.
export function healthNoticeDue(
  db: Db,
  source: SourceId,
  health: SourceHealth,
): { shouldNotify: boolean; key: string } {
  const key = healthSettingKey(source, health.reason ?? 'desconhecido');
  if (!health.degraded) {
    clearHealthNotices(db, source);
    return { shouldNotify: false, key };
  }
  return { shouldNotify: read(db, key) === null, key };
}

export function markHealthNotice(db: Db, source: SourceId, health: SourceHealth, now: Date): void {
  const key = healthSettingKey(source, health.reason ?? 'desconhecido');
  const state = { detail: health.detail, at: now.toISOString() } satisfies HealthNoticeState;
  db.run(sql`insert into setting (key, value, updated_at) values (${key}, ${JSON.stringify(state)}, ${now.getTime()})
            on conflict(key) do update set updated_at = excluded.updated_at`);
}
