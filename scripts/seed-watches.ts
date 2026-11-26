import { readFileSync } from 'node:fs';
import { loadConfig } from '@brique/core/config';
import { migrateDb, openDb } from '@brique/core/db/client-helpers';
import { parseWatchesYaml } from './seed-watches-schema';
import { seedMonitors } from './seed-watches-store';

try { process.loadEnvFile(); } catch { /* systemd já trouxe o environment */ }

const file = process.argv[2] ?? '../Scrapelytics/watches.yaml';
const cfg = loadConfig();
const imported = parseWatchesYaml(readFileSync(file, 'utf8'));
const { db } = openDb(cfg.sqlitePath);
migrateDb(db);

for (const result of seedMonitors(db, imported)) {
  console.log(result.inserted
    ? `monitor ${result.label} importado (#${result.id})`
    : `monitor ${result.label} já existe (#${result.id}); nada alterado`);
}
