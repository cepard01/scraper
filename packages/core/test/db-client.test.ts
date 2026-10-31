import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import { DEFAULT_SETTINGS, seedSettings } from '../src/db/seed-settings';
import { searchMonitors, listings } from '../src/db/schema';
import type { Settings } from '../src/types';
import { sql } from 'drizzle-orm';

describe('db client', () => {
  it('abre em memoria, migra e roda o round-trip de uma linha', () => {
    const { db } = openDb(':memory:');
    migrateDb(db);
    db.insert(searchMonitors).values({
      label: 'iphone 12', source: 'olx', query: 'iphone 12', params: {},
      intervalMinutes: 30, active: true, createdAt: new Date(), updatedAt: new Date(),
    }).run();
    const [row] = db.select().from(searchMonitors).all();
    expect(row?.label).toBe('iphone 12');
    expect(row?.params).toEqual({});
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(db.select().from(listings).all()).toEqual([]);
  });

  // WAL não existe em :memory: (SQLite responde 'memory'), então os pragmas
  // do contrato só são verificáveis num banco de arquivo.
  it('aplica WAL, busy_timeout e foreign_keys num banco de arquivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brique-test-'));
    const { sqlite, db } = openDb(join(dir, 'test.db'));
    migrateDb(db);
    const pragmas = {
      journal_mode: sqlite.pragma('journal_mode', { simple: true }),
      busy_timeout: sqlite.pragma('busy_timeout', { simple: true }),
      foreign_keys: sqlite.pragma('foreign_keys', { simple: true }),
    };
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
    expect(pragmas).toEqual({ journal_mode: 'wal', busy_timeout: 5000, foreign_keys: 1 });
  });

  it('seed de settings é idempotente e fiel', () => {
    const { db } = openDb(':memory:');
    migrateDb(db);
    seedSettings(db, DEFAULT_SETTINGS);
    const first = db.all<{ key: string; value: string; updated_at: number }>(
      sql`select key, value, updated_at from setting order by key`);
    seedSettings(db, DEFAULT_SETTINGS);
    const second = db.all<{ key: string; value: string; updated_at: number }>(
      sql`select key, value, updated_at from setting order by key`);
    expect(first).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);
    expect(second).toEqual(first);
    for (const row of first) {
      expect(row.value).toBe(JSON.stringify(DEFAULT_SETTINGS[row.key as keyof Settings]));
    }
  });
});
