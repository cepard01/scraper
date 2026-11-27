import { describe, expect, it } from 'vitest';
import { createBackgroundTracker, makeStop } from '../src/shutdown';

describe('makeStop', () => {
  it('espera trabalho de fundo e passada antes de fechar o banco e sair', async () => {
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
      drainBackground: async () => { events.push('background'); },
      close: () => events.push('sqlite'),
      log: (text) => events.push(text),
      exit: (code) => events.push(`exit:${code}`),
    });

    const done = stop('SIGTERM');
    await Promise.resolve();
    expect(events).toEqual(['background', 'scheduler:start']);

    release();
    await done;

    expect(events).toEqual([
      'background', 'scheduler:start', 'scheduler:end', 'sqlite', 'parado (SIGTERM).', 'exit:0',
    ]);
  });

  it('sinais repetidos compartilham o mesmo desligamento', async () => {
    let exits = 0;
    const stop = makeStop({
      handle: { stop: async () => {} },
      drainBackground: () => {},
      exit: () => { exits++; },
    });

    const first = stop();
    const second = stop('SIGINT');

    expect(second).toBe(first);
    await first;
    expect(exits).toBe(1);
  });
});

describe('createBackgroundTracker', () => {
  it('drena tudo que estava em voo e ignora falhas já tratadas', async () => {
    const tracker = createBackgroundTracker();
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    tracker.track(slow);
    tracker.track(Promise.reject(new Error('ja logado')));

    let drained = false;
    const waiting = tracker.drain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    release();
    await waiting;
    expect(drained).toBe(true);

    await expect(tracker.drain()).resolves.toBeUndefined();
  });
});
