import { createAi, dbAiPorts } from '@brique/ai';
import { nullAiPort } from '@brique/core/ai-port';
import { setAiPaused } from '@brique/core/db/client-helpers';
import type { AiTriagePort } from '@brique/core/ai-port';
import type { Db } from '@brique/core/db/client';
import type { HttpPost } from '@brique/scrapers/http';
import type { Settings } from '@brique/core/types';

export interface WorkerAi {
  ai: AiTriagePort;
  configured: boolean;
}

/** Sem chave o worker segue com o porte nulo: nenhum POST, nenhuma cota. */
export function createWorkerAi(opts: {
  db: Db;
  settings: Settings;
  post: HttpPost;
  omniRoute: { baseUrl: string; apiKey: string | null };
  clock?: () => Date;
}): WorkerAi {
  if (opts.omniRoute.apiKey === null) return { ai: nullAiPort(), configured: false };

  let lastPaused: boolean | null = null;
  const ai = createAi({
    post: opts.post,
    baseUrl: opts.omniRoute.baseUrl,
    apiKey: opts.omniRoute.apiKey,
    clock: opts.clock ?? (() => new Date()),
    limits: opts.settings.aiDailyLimits,
    ...dbAiPorts(opts.db),
    onState: (state) => {
      if (state.paused !== lastPaused) {
        lastPaused = state.paused;
        setAiPaused(opts.db, state.paused);
      }
    },
  });
  return { ai, configured: true };
}
