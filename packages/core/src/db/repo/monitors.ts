import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { searchMonitors } from '../schema';
import type { SearchMonitor } from '../../types';

export function listDue(db: Db, now: Date): SearchMonitor[] {
  const rows = db.select().from(searchMonitors).where(eq(searchMonitors.active, true)).all();
  return rows
    .map((r) => ({
      id: r.id, label: r.label, source: r.source, query: r.query, category: r.category,
      params: r.params, intervalMinutes: r.intervalMinutes, active: r.active,
      lastRunAt: r.lastRunAt, lastYield: r.lastYield,
    }))
    .filter((m) => !m.lastRunAt || now.getTime() - m.lastRunAt.getTime() >= m.intervalMinutes * 60_000);
}

export function touchRun(db: Db, monitorId: number, at: Date, yieldCount: number): void {
  db.update(searchMonitors).set({ lastRunAt: at, lastYield: yieldCount, updatedAt: at })
    .where(eq(searchMonitors.id, monitorId)).run();
}

export function createMonitor(db: Db, m: Pick<SearchMonitor, 'label' | 'source' | 'query' | 'category' | 'params' | 'intervalMinutes'>): number {
  const now = new Date();
  return db.insert(searchMonitors)
    .values({ ...m, active: true, createdAt: now, updatedAt: now })
    .returning({ id: searchMonitors.id }).get().id;
}
