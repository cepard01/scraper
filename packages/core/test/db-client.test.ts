import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import { DEFAULT_SETTINGS, seedSettings } from '../src/db/seed-settings';
import { searchMonitors, listings } from '../src/db/schema';
import { sql } from 'drizzle-orm';

describe('db client', () => {
  it('abre em memoria, aplica WAL e migra', () => {
    const { db } = openDb(':memory:');
    migrateDb(db);
    const rows = db.all<{ journal_mode: string }>(sql`pragma journal_mode`);
    expect(rows[0]?.journal_mode).not.toBe('delete');
    db.insert(searchMonitors).values({
      label: 'iphone 12', source: 'olx', query: 'iphone 12', params: {},
      intervalMinutes: 30, active: true, createdAt: new Date(), updatedAt: new Date(),
    }).run();
    expect(db.select().from(listings).all()).toEqual([]);
  });

  it('seed de settings é idempotente', () => {
    const { db } = openDb(':memory:');
    migrateDb(db);
    seedSettings(db, DEFAULT_SETTINGS);
    seedSettings(db, DEFAULT_SETTINGS);
    const count = db.all<{ n: number }>(sql`select count(*) as n from setting`)[0]?.n;
    expect(count).toBe(Object.keys(DEFAULT_SETTINGS).length);
  });
});
