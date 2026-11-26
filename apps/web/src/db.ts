import { loadConfig } from '@brique/core/config';
import { openDb, type Db } from '@brique/core/db/client';

let handle: Db | null = null;

/** Conexão única do processo web; o worker continua sendo o escritor principal. */
export function webDb(): Db {
  if (!handle) handle = openDb(loadConfig().sqlitePath).db;
  return handle;
}
