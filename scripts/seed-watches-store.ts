import { and, eq } from 'drizzle-orm';
import type { Db } from '@brique/core/db/client';
import { createMonitor } from '@brique/core/db/repo/monitors';
import { searchMonitors } from '@brique/core/db/schema';
import { toMonitorSeed, type WatchesYaml } from './seed-watches-schema';

export interface SeedResult { id: number; label: string; inserted: boolean }

export function seedMonitors(db: Db, imported: WatchesYaml): SeedResult[] {
  return imported.watches.map((watch) => {
    const seed = toMonitorSeed(watch, imported.settings);
    const existing = db.select({ id: searchMonitors.id }).from(searchMonitors)
      .where(and(
        eq(searchMonitors.label, seed.label),
        eq(searchMonitors.source, seed.source),
        eq(searchMonitors.query, seed.query),
      ))
      .get();
    if (existing) return { id: existing.id, label: seed.label, inserted: false };
    const id = createMonitor(db, seed);
    return { id, label: seed.label, inserted: true };
  });
}
