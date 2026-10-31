import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { runs } from '../schema';

export interface RunSummary {
  outcome: 'ok' | 'partial' | 'failed';
  fetched: number;
  created: number;
  repriced: number;
  unchanged: number;
  rejected: Record<string, number>;
  unmatched: number;
  aiCalls: number;
  error?: string;
}

export function startRun(db: Db, monitorId: number, at: Date): number {
  return db.insert(runs).values({ monitorId, startedAt: at })
    .returning({ id: runs.id }).get().id;
}

export function finishRun(db: Db, runId: number, at: Date, s: RunSummary): void {
  db.update(runs).set({
    finishedAt: at, outcome: s.outcome, fetched: s.fetched, created: s.created,
    repriced: s.repriced, unchanged: s.unchanged, rejected: s.rejected,
    unmatched: s.unmatched, aiCalls: s.aiCalls, error: s.error ?? null,
  }).where(eq(runs.id, runId)).run();
}
