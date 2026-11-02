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

export function startScheduler(
  deps: SchedulerDeps,
  tickMs = 30_000,
  onPass?: (summaries: RunSummary[]) => void,
): { stop: () => void } {
  let busy = false;
  let stopped = false;
  const loop = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const summaries = await runPending(deps);
      if (summaries.length > 0) onPass?.(summaries);
    } finally { busy = false; }
  };
  void loop();
  const timer = setInterval(() => void loop(), tickMs);
  return { stop: () => { stopped = true; clearInterval(timer); } };
}
