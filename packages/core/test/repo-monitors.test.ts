import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import type { Db } from '../src/db/client';
import { createMonitor, listDue, touchRun } from '../src/db/repo/monitors';
import { startRun, finishRun } from '../src/db/repo/runs';
import { runs } from '../src/db/schema';

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); });

describe('scheduler repos', () => {
  it('listDue só devolve monitor cujo intervalo venceu', () => {
    const id = createMonitor(db, { label: 'a', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const t0 = new Date('2026-10-01T12:00:00Z');
    expect(listDue(db, t0).map((m) => m.id)).toContain(id);
    touchRun(db, id, t0, 5);
    expect(listDue(db, new Date('2026-10-01T12:29:00Z'))).toHaveLength(0);
    expect(listDue(db, new Date('2026-10-01T12:31:00Z')).map((m) => m.id)).toContain(id);
  });

  it('run guarda contadores e rejeições por motivo', () => {
    const id = createMonitor(db, { label: 'b', source: 'olx', query: 'bike', category: 'bicicleta', params: {}, intervalMinutes: 30 });
    const runId = startRun(db, id, new Date('2026-10-01T12:00:00Z'));
    finishRun(db, runId, new Date('2026-10-01T12:00:30Z'), {
      outcome: 'ok', fetched: 10, created: 3, repriced: 1, unchanged: 6,
      rejected: { gratis: 1 }, unmatched: 2, aiCalls: 0,
    });
    const row = db.select().from(runs).where(eq(runs.id, runId)).get()!;
    expect(row.rejected.gratis).toBe(1);
    expect(row.unchanged).toBe(6);
  });
});
