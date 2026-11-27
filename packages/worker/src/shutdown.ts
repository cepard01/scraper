interface ShutdownOpts {
  handle: { stop(): Promise<void> };
  drainBackground: () => Promise<void> | void;
  close?: () => void;
  log?: (text: string) => void;
  exit?: (code: number) => void;
}

/** Um desligamento por processo: sinais repetidos compartilham a mesma promessa. */
export function makeStop(opts: ShutdownOpts): (signal?: string) => Promise<void> {
  let stopping: Promise<void> | null = null;
  return (signal) => {
    if (stopping) return stopping;
    stopping = (async () => {
      await opts.drainBackground();
      await opts.handle.stop();
      opts.close?.();
      opts.log?.(`parado${signal ? ` (${signal})` : ''}.`);
      opts.exit?.(0);
    })();
    return stopping;
  };
}

/** Mantém as promessas de digest/health disparadas fora do caminho do scheduler. */
export function createBackgroundTracker() {
  const inFlight = new Set<Promise<unknown>>();
  return {
    track(work: Promise<unknown>): void {
      inFlight.add(work);
      void work.finally(() => inFlight.delete(work)).catch(() => {});
    },
    async drain(): Promise<void> {
      await Promise.allSettled([...inFlight]);
    },
  };
}
