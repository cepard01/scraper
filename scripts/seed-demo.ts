import { loadConfig } from '@brique/core/config';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS } from '@brique/core/db/client-helpers';
import { searchMonitors } from '@brique/core/db/schema';
import { createMonitor } from '@brique/core/db/repo/monitors';
import { upsertFromSource } from '@brique/core/db/repo/listings';
import { extractProduct } from '@brique/core/product';
import { getOrCreateFingerprint } from '@brique/core/db/repo/fingerprints';
import { DAY1 } from '../tests/feed/day1';

const cfg = loadConfig();
const { db } = openDb(cfg.sqlitePath);
migrateDb(db);
seedSettings(db, DEFAULT_SETTINGS);

let seeded = 0;
for (const input of DAY1) {
  const p = extractProduct(input.title, input.description);
  const fp = p.matched ? getOrCreateFingerprint(db, p) : null;
  upsertFromSource(db, input, { parserVersion: 'seed-demo', fingerprintId: fp?.id ?? null, grade: p.matched ? p.grade : null, seenAt: new Date('2026-10-01T12:00:00Z') });
  seeded++;
}

const existentes = new Set(db.select({ label: searchMonitors.label }).from(searchMonitors).all().map((r) => r.label));
const novos = [
  { label: 'iPhone 12 PR', source: 'olx' as const, query: 'iphone 12', category: 'celular' as const, params: { uf: 'PR', maxCents: 400_000 }, intervalMinutes: 30 },
  { label: 'Galaxy A54 SP', source: 'olx' as const, query: 'galaxy a54', category: 'celular' as const, params: { uf: 'SP' }, intervalMinutes: 45 },
  { label: 'Caloi Elite', source: 'meli' as const, query: 'caloi elite 29', category: 'bicicleta' as const, params: {}, intervalMinutes: 60 },
].filter((m) => !existentes.has(m.label));
for (const m of novos) createMonitor(db, m);

console.log(`seed ok: ${seeded} listings, ${novos.length} monitores novos. rode: pnpm worker`);
