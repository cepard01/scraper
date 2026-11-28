import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, type Db } from '../src/db/client-helpers';
import { runPending, startScheduler, type SchedulerDeps } from '../src/scheduler';
import { createMonitor } from '../src/db/repo/monitors';
import { nullAiPort } from '../src/ai-port';
import { nullNotifier } from '../src/notify-port';
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
      db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, notify: nullNotifier(), now: () => NOW,
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
      db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, notify: nullNotifier(), now: () => NOW,
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
      db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, notify: nullNotifier(), now: () => NOW,
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
      { db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, notify: nullNotifier(), now: () => new Date(), adapters: { olx: lenta } },
      1_000,
      (summaries) => passadas.push(summaries.length),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(buscas).toBe(1);
    expect(passadas).toEqual([]);

    const parando = handle.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await parando;
    expect(passadas).toEqual([1]);
    expect(buscas).toBe(1);
    expect(nRuns()).toBe(1);
    vi.useRealTimers();
  });

  it('stop aguarda a passada em voo mesmo com ticks descartados por busy', async () => {
    vi.useRealTimers();
    let liberar: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { liberar = resolve; });
    let buscas = 0;
    let terminou = false;
    const lenta: SourceAdapter = {
      id: 'olx',
      parserVersion: 'olx-1',
      async health() { return { ok: true }; },
      async search() { buscas++; await gate; terminou = true; return []; },
      async fetchOne() { throw new Error('nao usado'); },
      toListingInput() { throw new Error('nao usado'); },
    };
    createMonitor(db, { label: 'o', source: 'olx', query: 'o', category: null, params: {}, intervalMinutes: 30 });
    const handle = startScheduler(
      { db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, notify: nullNotifier(), now: () => new Date(), adapters: { olx: lenta } },
      5,
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(buscas).toBe(1); // os outros ticks foram engolidos por busy

    let resolvido = false;
    const parando = handle.stop().then(() => { resolvido = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(resolvido).toBe(false); // stop nao pode terminar antes da busca
    expect(terminou).toBe(false);

    liberar!();
    await parando;
    expect(resolvido).toBe(true);
    expect(terminou).toBe(true);
    expect(buscas).toBe(1);
    expect(nRuns()).toBe(1);
  });

  it('stop aguarda a passada em voo e pode ser chamado mais de uma vez', async () => {
    let terminou = false;
    const lenta: SourceAdapter = {
      id: 'olx',
      parserVersion: 'olx-1',
      async health() { return { ok: true }; },
      async search() { await new Promise<void>((r) => setTimeout(r, 1_000)); terminou = true; return []; },
      async fetchOne() { throw new Error('nao usado'); },
      toListingInput() { throw new Error('nao usado'); },
    };
    createMonitor(db, { label: 'o', source: 'olx', query: 'o', category: null, params: {}, intervalMinutes: 30 });

    vi.useFakeTimers();
    const handle = startScheduler(
      { db, settings: DEFAULT_SETTINGS, ai: nullAiPort(), comparables: localAskingProvider, notify: nullNotifier(), now: () => new Date(), adapters: { olx: lenta } },
      5_000,
    );
    let resolvidas = 0;
    const p1 = handle.stop().then(() => { resolvidas++; });
    const p2 = handle.stop().then(() => { resolvidas++; });

    expect(terminou).toBe(false); // o timer é fake; a passada ainda não andou

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([p1, p2]);
    expect(terminou).toBe(true);
    expect(resolvidas).toBe(2);
    expect(nRuns()).toBe(1);
    vi.useRealTimers();
  });
});
