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
      // Primeiro cancelam-se os ticks e espera-se a passada em voo: é o
      // scheduler que dispara health checks em background. Drenar antes
      // deixava um POST entrar no tracker depois do snapshot do drain.
      await opts.handle.stop();
      await opts.drainBackground();
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
      // O trabalho de fundo pode registrar mais trabalho enquanto o anterior
      // termina; um snapshot único fecharia o banco com esse segundo em voo.
      do {
        await Promise.allSettled([...inFlight]);
      } while (inFlight.size > 0);
    },
  };
}
