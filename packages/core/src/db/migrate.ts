import { loadConfig } from '../config';
import { migrateDb, openDb } from './client';

try { process.loadEnvFile(); } catch { /* em VPS o EnvironmentFile do systemd já trouxe tudo */ }

const cfg = loadConfig();
const { db } = openDb(cfg.sqlitePath);
migrateDb(db);
console.log(`migrações aplicadas em ${cfg.sqlitePath}`);
