import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, type Db } from '@brique/core/db/client-helpers';
import { createMonitor } from '@brique/core/db/repo/monitors';
import { startRun, finishRun } from '@brique/core/db/repo/runs';
import type { AlertMessage, NotifyPort } from '@brique/core/notify-port';
import { notifyDegradedSources } from '../src/monitoring';

const spy = (ok: boolean) => {
  const calls: AlertMessage[] = [];
  const port: NotifyPort = ok
    ? { async send(m) { calls.push(m); return { ok: true }; } }
    : { async send(m) { calls.push(m); return { ok: false, error: 'http 500' }; } };
  return { port, calls };
};

let db: Db;
beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
  seedSettings(db, DEFAULT_SETTINGS);
  const monitorId = createMonitor(db, { label: 'olx', source: 'olx', query: 'q', category: null, params: {}, intervalMinutes: 30 });
  for (let i = 0; i < 3; i++) {
    const at = new Date(Date.UTC(2026, 10, 2, 10, i));
    const id = startRun(db, monitorId, at);
    finishRun(db, id, at, {
      outcome: 'ok', fetched: 100, created: 0, repriced: 0, unchanged: 100,
      rejected: {}, unmatched: 0, aiCalls: 0, alerts: 0,
    });
  }
});

const opts = (notify: NotifyPort) => ({
  db, notify, sources: ['olx' as const], now: () => new Date('2026-11-02T12:00:00Z'),
});

describe('notifyDegradedSources', () => {
  it('detecta três passadas sem novos e avisa uma vez', async () => {
    const { port, calls } = spy(true);
    expect(await notifyDegradedSources(opts(port))).toEqual(['olx']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toContain('fonte degradada: olx');
    expect(calls[0]!.body).toContain('zero-novos');
    expect(await notifyDegradedSources(opts(port))).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('entrega falha não marca dedupe e tenta de novo', async () => {
    const failed = spy(false);
    expect(await notifyDegradedSources(opts(failed.port))).toEqual([]);
    const ok = spy(true);
    expect(await notifyDegradedSources(opts(ok.port))).toEqual(['olx']);
    expect(ok.calls).toHaveLength(1);
  });

  it('sem passadas não inventa degradação', async () => {
    const fresh = openDb(':memory:').db;
    migrateDb(fresh);
    seedSettings(fresh, DEFAULT_SETTINGS);
    const { port, calls } = spy(true);
    expect(await notifyDegradedSources({ ...opts(port), db: fresh })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('notifier que lança não derruba o resultado', async () => {
    const boom: NotifyPort = { async send() { throw new Error('rede caiu'); } };
    expect(await notifyDegradedSources(opts(boom))).toEqual([]);
    const ok = spy(true);
    expect(await notifyDegradedSources(opts(ok.port))).toEqual(['olx']);
  });
});
