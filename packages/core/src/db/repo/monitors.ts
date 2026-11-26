import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { searchMonitors } from '../schema';
import type { SearchMonitor } from '../../types';

function toMonitor(r: typeof searchMonitors.$inferSelect): SearchMonitor {
  return {
    id: r.id, label: r.label, source: r.source, query: r.query, category: r.category,
    params: r.params, intervalMinutes: r.intervalMinutes, active: r.active,
    lastRunAt: r.lastRunAt, lastYield: r.lastYield, mutedUntil: r.mutedUntil,
  };
}

export function listMonitors(db: Db): SearchMonitor[] {
  return db.select().from(searchMonitors).orderBy(searchMonitors.id).all().map(toMonitor);
}

export function getMonitor(db: Db, id: number): SearchMonitor | null {
  const row = db.select().from(searchMonitors).where(eq(searchMonitors.id, id)).get();
  return row ? toMonitor(row) : null;
}

export function listDue(db: Db, now: Date): SearchMonitor[] {
  const rows = db.select().from(searchMonitors).where(eq(searchMonitors.active, true)).all();
  return rows
    .map(toMonitor)
    .filter((m) => !m.mutedUntil || m.mutedUntil.getTime() <= now.getTime())
    .filter((m) => !m.lastRunAt || now.getTime() - m.lastRunAt.getTime() >= m.intervalMinutes * 60_000);
}

export function setMonitorMute(db: Db, monitorId: number, mutedUntil: Date | null, at: Date): void {
  db.update(searchMonitors).set({ mutedUntil, updatedAt: at })
    .where(eq(searchMonitors.id, monitorId)).run();
}

export function touchRun(db: Db, monitorId: number, at: Date, yieldCount: number): void {
  db.update(searchMonitors).set({ lastRunAt: at, lastYield: yieldCount, updatedAt: at })
    .where(eq(searchMonitors.id, monitorId)).run();
}

// §8.4: cadência abaixo de 15 min é risco de bloqueio de IP, não detalhe de tuning.
// Todo caminho de escrita passa por aqui, inclusive o update do painel.
function assertCadence(label: string, intervalMinutes: number): void {
  if (intervalMinutes < 15) {
    throw new Error(`monitor "${label}" com intervalMinutes=${intervalMinutes}; mínimo 15`);
  }
}

export type MonitorWrite = Pick<SearchMonitor, 'label' | 'source' | 'query' | 'category' | 'params' | 'intervalMinutes'>;

export function createMonitor(db: Db, m: MonitorWrite): number {
  assertCadence(m.label, m.intervalMinutes);
  const now = new Date();
  return db.insert(searchMonitors)
    .values({ ...m, active: true, createdAt: now, updatedAt: now })
    .returning({ id: searchMonitors.id }).get().id;
}

export type MonitorPatch = Partial<MonitorWrite & { active: boolean }>;

export function updateMonitor(db: Db, id: number, patch: MonitorPatch, at: Date): void {
  const current = getMonitor(db, id);
  if (!current) throw new Error(`monitor ${id} não encontrado`);
  const next = { ...current, ...patch };
  assertCadence(next.label, next.intervalMinutes);
  db.update(searchMonitors).set({
    label: next.label, source: next.source, query: next.query, category: next.category,
    params: next.params, intervalMinutes: next.intervalMinutes, active: next.active, updatedAt: at,
  }).where(eq(searchMonitors.id, id)).run();
}

export function setActiveMonitor(db: Db, id: number, active: boolean, at: Date): void {
  const current = getMonitor(db, id);
  if (!current) throw new Error(`monitor ${id} não encontrado`);
  db.update(searchMonitors).set({ active, updatedAt: at })
    .where(eq(searchMonitors.id, id)).run();
}

/** Exclusão é explícita: excluir um monitor não apaga anúncios nem passes já coletados. */
export function deleteMonitor(db: Db, id: number): void {
  if (!getMonitor(db, id)) throw new Error(`monitor ${id} não encontrado`);
  db.delete(searchMonitors).where(eq(searchMonitors.id, id)).run();
}

