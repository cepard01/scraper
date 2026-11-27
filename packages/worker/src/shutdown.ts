interface ShutdownOpts {
  handle: { stop(): Promise<void> };
  stopDigest: () => Promise<void> | void;
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
      await opts.stopDigest();
      await opts.handle.stop();
      opts.close?.();
      opts.log?.(`parado${signal ? ` (${signal})` : ''}.`);
      opts.exit?.(0);
    })();
    return stopping;
  };
}
