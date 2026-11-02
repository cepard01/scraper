import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb, type Db } from '../src/db/client-helpers';
import { createMonitor } from '../src/db/repo/monitors';
import { startRun, finishRun } from '../src/db/repo/runs';
import { checkSourceHealth } from '../src/source-health';

let db: Db;
let monitorId: number;
let tick = 0;

const addRun = (over: Partial<{ fetched: number; created: number; unmatched: number; rejected: Record<string, number> }> = {}) => {
  const at = new Date(Date.UTC(2026, 9, 1, 12, tick++));
  const id = startRun(db, monitorId, at);
  finishRun(db, id, at, {
    outcome: 'ok',
    fetched: over.fetched ?? 1_000,
    created: over.created ?? 1,
    repriced: 0,
    unchanged: 0,
    rejected: over.rejected ?? {},
    unmatched: over.unmatched ?? 500,
    aiCalls: 0,
  });
};

beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
  tick = 0;
  monitorId = createMonitor(db, { label: 'olx', source: 'olx', query: 'q', category: null, params: {}, intervalMinutes: 30 });
});

describe('checkSourceHealth', () => {
  it('sem passada nenhuma nao inventa degradacao', () => {
    expect(checkSourceHealth(db, 'olx')).toMatchObject({ degraded: false, reason: null, detail: 'sem passadas' });
  });

  it('tres passadas seguidas com zero novos degradam a fonte', () => {
    addRun({ created: 5, unmatched: 100 });
    addRun({ created: 0, unmatched: 100 });
    addRun({ created: 0, unmatched: 100 });
    addRun({ created: 0, unmatched: 100 });

    const h = checkSourceHealth(db, 'olx');
    expect(h.degraded).toBe(true);
    expect(h.reason).toBe('zero-novos');
  });

  it('duas passadas com zero novos nao bastam', () => {
    addRun({ created: 1, unmatched: 100 });
    addRun({ created: 0, unmatched: 100 });
    addRun({ created: 0, unmatched: 100 });
    expect(checkSourceHealth(db, 'olx').degraded).toBe(false);
  });

  it('queda de 61% do yield contra a media movel de 10 degrada', () => {
    for (let i = 0; i < 10; i++) addRun({ unmatched: 500 });
    addRun({ unmatched: 195 });

    const h = checkSourceHealth(db, 'olx');
    expect(h.degraded).toBe(true);
    expect(h.reason).toBe('yield-caiu');
    expect(h.detail).toContain('61%');
  });

  it('queda de exatamente 60% ainda nao degrada', () => {
    for (let i = 0; i < 10; i++) addRun({ unmatched: 500 });
    addRun({ unmatched: 200 });
    expect(checkSourceHealth(db, 'olx')).toMatchObject({ degraded: false, reason: null });
  });

  it('a media movel exclui a passada atual, nao inclui', () => {
    for (let i = 0; i < 10; i++) addRun({ unmatched: 500 });
    addRun({ unmatched: 190 });

    const h = checkSourceHealth(db, 'olx');
    expect(h.degraded).toBe(true);
    expect(h.reason).toBe('yield-caiu');
  });

  it('yield sem denominador nao vira queda de 100%', () => {
    for (let i = 0; i < 10; i++) addRun({ unmatched: 500 });
    addRun({ fetched: 0, unmatched: 0 });

    expect(checkSourceHealth(db, 'olx')).toMatchObject({ degraded: false, reason: null });
  });

  it('passadas de outra fonte nao entram na conta', () => {
    const meli = createMonitor(db, { label: 'meli', source: 'meli', query: 'q', category: null, params: {}, intervalMinutes: 30 });
    for (let i = 0; i < 3; i++) {
      const at = new Date(Date.UTC(2026, 9, 2, 12, i));
      const id = startRun(db, meli, at);
      finishRun(db, id, at, { outcome: 'ok', fetched: 10, created: 0, repriced: 0, unchanged: 0, rejected: {}, unmatched: 0, aiCalls: 0 });
    }
    expect(checkSourceHealth(db, 'olx').degraded).toBe(false);
  });
});
