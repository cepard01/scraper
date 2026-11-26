import { ConfigError, loadConfig } from '@brique/core/config';
import { openDb, type Db, type DbHandle } from '@brique/core/db/client';

let handle: DbHandle | null = null;

/** Conexão única do processo web; o worker continua sendo o escritor principal. */
export function webDb(): Db {
  if (!handle) {
    const opened = openDb(loadConfig().sqlitePath);
    const ready = opened.sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'search_monitor'",
    ).get();
    if (!ready) {
      opened.sqlite.close();
      throw new ConfigError(
        'Banco sem as tabelas do Brique: rode pnpm db:migrate antes de abrir o painel.',
      );
    }
    handle = opened;
  }
  return handle.db;
}
