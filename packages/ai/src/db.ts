import type { Db } from '@brique/core/db/client';
import {
  countAiCalls, getAiCache, insertAiCall, listAiDeferred,
  pushAiDeferred, putAiCache, removeAiDeferred,
} from '@brique/core/db/repo/ai';
import type { AiCachePort, AiDeferredPort, AiLogPort } from './ports';

/** Liga o cliente ao SQLite do Brique: cache, fila e log são do core, não da rede. */
export function dbAiPorts(db: Db): { cache: AiCachePort; log: AiLogPort; deferred: AiDeferredPort } {
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
    deferred: {
      list: () => listAiDeferred(db),
      push: (items) => pushAiDeferred(db, items),
      remove: (ids) => removeAiDeferred(db, ids),
    },
  };
}
