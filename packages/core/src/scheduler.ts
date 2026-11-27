import { listDue } from './db/repo/monitors';
import { runMonitor, type PipelineDeps } from './pipeline';
import type { SourceAdapter } from './adapter-contract';
import type { SourceId } from './types';
import type { RunSummary } from './db/repo/runs';

export type SchedulerDeps = Omit<PipelineDeps, 'adapter'> & {
  adapters: Partial<Record<SourceId, SourceAdapter>>;
};

export async function runPending(deps: SchedulerDeps): Promise<RunSummary[]> {
  const due = listDue(deps.db, deps.now());
  const out: RunSummary[] = [];
  for (const monitor of due) {
    const adapter = deps.adapters[monitor.source];
    if (!adapter) continue;
    out.push(await runMonitor({ ...deps, adapter }, monitor));
  }
  return out;
}

export interface SchedulerHandle {
  /** Cancela os ticks e resolve quando a passada em voo termina. */
  stop(): Promise<void>;
}

export function startScheduler(
  deps: SchedulerDeps,
  tickMs = 30_000,
  onPass?: (summaries: RunSummary[]) => void,
): SchedulerHandle {
  let busy = false;
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const loop = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    try {
      const summaries = await runPending(deps);
      if (summaries.length > 0) onPass?.(summaries);
    } finally { busy = false; }
  };
  const tick = (): Promise<void> => {
    const work = loop();
    current = work;
    return work;
  };
  void tick();
  const timer = setInterval(() => void tick(), tickMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await current;
    },
  };
}
