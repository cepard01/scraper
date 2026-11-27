import { describe, expect, it } from 'vitest';
import { makeStop } from '../src/shutdown';

describe('makeStop', () => {
  it('espera digest e passada antes de fechar o banco e sair', async () => {
    const events: string[] = [];
    let release!: () => void;
    const pass = new Promise<void>((r) => { release = r; });
    const stop = makeStop({
      handle: {
        stop: async () => {
          events.push('scheduler:start');
          await pass;
          events.push('scheduler:end');
        },
      },
      stopDigest: async () => { events.push('digest'); },
      close: () => events.push('sqlite'),
      log: (text) => events.push(text),
      exit: (code) => events.push(`exit:${code}`),
    });

    const done = stop('SIGTERM');
    await Promise.resolve();
    expect(events).toEqual(['digest', 'scheduler:start']);

    release();
    await done;

    expect(events).toEqual([
      'digest', 'scheduler:start', 'scheduler:end', 'sqlite', 'parado (SIGTERM).', 'exit:0',
    ]);
  });

  it('sinais repetidos compartilham o mesmo desligamento', async () => {
    let exits = 0;
    const stop = makeStop({
      handle: { stop: async () => {} },
      stopDigest: () => {},
      exit: () => { exits++; },
    });

    const first = stop();
    const second = stop('SIGINT');

    expect(second).toBe(first);
    await first;
    expect(exits).toBe(1);
  });
});
