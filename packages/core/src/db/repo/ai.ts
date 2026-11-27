import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { aiCache, aiCallLog, aiDeferred } from '../schema';
import type { TriageInput } from '../../ai-port';
import type { AiTask } from '../../types';

export function getAiCache(db: Db, key: string): unknown | undefined {
  return db.select({ result: aiCache.result }).from(aiCache)
    .where(eq(aiCache.key, key)).limit(1).get()?.result;
}

export function putAiCache(
  db: Db,
  entry: { key: string; task: AiTask; combo: string; result: unknown; createdAt: Date },
): void {
  db.insert(aiCache).values(entry)
    .onConflictDoUpdate({ target: aiCache.key, set: { result: entry.result, createdAt: entry.createdAt } })
    .run();
}

export type AiCallStatus = 'ok' | 'unparsed' | 'budget' | 'circuit' | 'failed' | 'cache-hit';

export function insertAiCall(db: Db, entry: {
  task: AiTask;
  status: AiCallStatus;
  attempts: number;
  batchSize: number;
  cacheKey?: string;
  error?: string;
  createdAt: Date;
}): void {
  db.insert(aiCallLog).values({
    task: entry.task, status: entry.status, attempts: entry.attempts,
    batchSize: entry.batchSize, cacheKey: entry.cacheKey ?? null,
    error: entry.error ?? null, createdAt: entry.createdAt,
  }).run();
}

/** Chamadas de rede vencidas na janela; cache-hit não consome cota (§16.2). */
export function countAiCalls(db: Db, task: AiTask, from: Date, to: Date): number {
  return db.select({ id: aiCallLog.id }).from(aiCallLog)
    .where(and(
      eq(aiCallLog.task, task),
      eq(aiCallLog.status, 'ok'),
      gte(aiCallLog.createdAt, from),
      lt(aiCallLog.createdAt, to),
    )).all().length;
}

export function aiStatsSince(db: Db, since: Date): Array<{ task: AiTask; status: AiCallStatus; total: number; items: number }> {
  const rows = db.select({
    task: aiCallLog.task, status: aiCallLog.status, batchSize: aiCallLog.batchSize,
  }).from(aiCallLog)
    .where(gte(aiCallLog.createdAt, since))
    .all();
  const grouped = new Map<string, { task: AiTask; status: AiCallStatus; total: number; items: number }>();
  for (const r of rows) {
    const key = `${r.task}:${r.status}`;
    const at = grouped.get(key) ?? { task: r.task, status: r.status, total: 0, items: 0 };
    at.total++;
    at.items += r.batchSize;
    grouped.set(key, at);
  }
  return [...grouped.values()];
}

export function latestAiCalls(db: Db, limit = 20): Array<{
  task: AiTask; status: AiCallStatus; attempts: number; batchSize: number; error: string | null; createdAt: Date;
}> {
  return db.select({
    task: aiCallLog.task, status: aiCallLog.status, attempts: aiCallLog.attempts,
    batchSize: aiCallLog.batchSize, error: aiCallLog.error, createdAt: aiCallLog.createdAt,
  }).from(aiCallLog).orderBy(desc(aiCallLog.id)).limit(limit).all();
}

// Um payload corrompido no banco não pode derrubar o worker: a fila é best-effort,
// o alerta determinístico continua saindo sem IA.
function isTriageInput(value: unknown): value is TriageInput {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<TriageInput>;
  return typeof v.listingId === 'number' && Number.isFinite(v.listingId)
    && typeof v.externalId === 'string' && typeof v.title === 'string'
    && typeof v.askingCents === 'number' && Number.isFinite(v.askingCents);
}

/** Fila persistida: sobrevive ao restart do worker e à virada do dia. */
export function listAiDeferred(db: Db): TriageInput[] {
  return db.select({ payload: aiDeferred.payload }).from(aiDeferred)
    .orderBy(asc(aiDeferred.createdAt), asc(aiDeferred.listingId)).all()
    .map((r) => r.payload)
    .filter(isTriageInput);
}

export function pushAiDeferred(db: Db, items: TriageInput[]): void {
  if (items.length === 0) return;
  const createdAt = new Date();
  db.insert(aiDeferred).values(items.map((item) => ({
    listingId: item.listingId, task: 'triage.batch' as const, payload: item, createdAt,
  }))).onConflictDoUpdate({
    target: aiDeferred.listingId,
    // createdAt permanece: quem foi postergado primeiro continua na frente da fila.
    set: { payload: sql`excluded.payload` },
  }).run();
}

export function removeAiDeferred(db: Db, listingIds: number[]): void {
  if (listingIds.length === 0) return;
  db.delete(aiDeferred).where(inArray(aiDeferred.listingId, listingIds)).run();
}

export function countAiDeferred(db: Db): number {
  return db.select({ listingId: aiDeferred.listingId }).from(aiDeferred).all().length;
}
