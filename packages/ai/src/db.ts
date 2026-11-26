import type { Db } from '@brique/core/db/client';
import {
  countAiCalls, getAiCache, insertAiCall, putAiCache,
} from '@brique/core/db/repo/ai';
import type { AiCachePort, AiLogPort } from './ports';

/** Liga o cliente ao SQLite do Brique: cache e log são do core, não da rede. */
export function dbAiPorts(db: Db): { cache: AiCachePort; log: AiLogPort } {
  return {
    cache: {
      get: (key) => getAiCache(db, key),
      set: (key, value, meta) => putAiCache(db, {
        key, task: meta.task, combo: meta.combo, result: value, createdAt: meta.createdAt,
      }),
    },
    log: {
      count: (task, from, to) => countAiCalls(db, task, from, to),
      append: (entry) => insertAiCall(db, entry),
    },
  };
}
