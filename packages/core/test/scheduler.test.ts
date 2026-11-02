import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, type Db } from '../src/db/client-helpers';
import { runPending, startScheduler, type SchedulerDeps } from '../src/scheduler';
import { createMonitor } from '../src/db/repo/monitors';
import { nullAiPort } from '../src/ai-port';
import { localAskingProvider } from '../src/valuation/comparables';
import { runs } from '../src/db/schema';
import type { SourceAdapter } from '../src/adapter-contract';
import type { SourceId } from '../src/types';

// R102: scheduler não tinha verificador nenhum (bateria16: S1 e S2 VIVEU).
const NOW = new Date('2026-10-05T12:00:00Z');

const spyAdapter = (source: SourceId, calls: SourceId[]): SourceAdapter => ({
  id: source,
  parserVersion: source + '-1',
  async health() { return { ok: true }; },
  async search() { calls.push(source); return []; },
  async fetchOne() { throw new Error('nao usado'); },
  toListingInput() { throw new Error('nao usado'); },
});

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); seedSettings(db, DEFAULT_SETTINGS); });

const nRuns = (): number => db.select({ id: runs.id }).from(runs).all().length;

describe('runPending', () => {
  it('roteia cada monitor pelo source dele, em fila serial', async () => {
    const calls: SourceId[] = [];
    createMonitor(db, { label: 'o', source: 'olx', query: 'o', category: null, params: {}, intervalMinutes: 30 });
    createMonitor(db, { label: 'm', source: 'meli', query: 'm', category: null, params: {}, intervalMinutes: 30 });

    const summaries = await runPending({
      db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, now: () => NOW,
      adapters: { olx: spyAdapter('olx', calls), meli: spyAdapter('meli', calls) },
    });

    expect(calls).toEqual(['olx', 'meli']);
    expect(summaries).toHaveLength(2);
    expect(nRuns()).toBe(2);
  });

  it('fonte sem adaptador registrado é pulada em silêncio, sem linha em run', async () => {
    const calls: SourceId[] = [];
    createMonitor(db, { label: 'o', source: 'olx', query: 'o', category: null, params: {}, intervalMinutes: 30 });
    const meliId = createMonitor(db, { label: 'm', source: 'meli', query: 'm', category: null, params: {}, intervalMinutes: 30 });

    const summaries = await runPending({
      db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, now: () => NOW,
      adapters: { olx: spyAdapter('olx', calls) },
    });

    expect(calls).toEqual(['olx']);
    expect(summaries).toHaveLength(1);
    expect(nRuns()).toBe(1);
    expect(db.select().from(runs).all().some((r) => r.monitorId === meliId)).toBe(false);
  });

  it('um monitor ja rodado nao entra na passada seguinte', async () => {
    const calls: SourceId[] = [];
    createMonitor(db, { label: 'o', source: 'olx', query: 'o', category: null, params: {}, intervalMinutes: 30 });
    const deps = {
      db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, now: () => NOW,
      adapters: { olx: spyAdapter('olx', calls) },
    };
    await runPending(deps);
    const segunda = await runPending({ ...deps, now: () => new Date(NOW.getTime() + 60_000) });

    expect(calls).toEqual(['olx']);
    expect(segunda).toHaveLength(0);
  });
});

describe('startScheduler', () => {
  it('uma passada longa nao se sobrepoe ao tick seguinte e o onPass roda depois dela', async () => {
    let buscas = 0;
    const lenta: SourceAdapter = {
      id: 'olx',
      parserVersion: 'olx-1',
      async health() { return { ok: true }; },
      async search() { buscas++; await new Promise<void>((r) => setTimeout(r, 3_000)); return []; },
      async fetchOne() { throw new Error('nao usado'); },
      toListingInput() { throw new Error('nao usado'); },
    };
    createMonitor(db, { label: 'o', source: 'olx', query: 'o', category: null, params: {}, intervalMinutes: 30 });

    vi.useFakeTimers();
    const passadas: number[] = [];
    const handle = startScheduler(
      { db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, now: () => new Date(), adapters: { olx: lenta } },
      1_000,
      (summaries) => passadas.push(summaries.length),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(buscas).toBe(1);
    expect(passadas).toEqual([]);

    handle.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(passadas).toEqual([1]);
    expect(buscas).toBe(1);
    expect(nRuns()).toBe(1);
    vi.useRealTimers();
  });
});
