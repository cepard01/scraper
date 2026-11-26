import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { openDb, migrateDb, type Db } from '../packages/core/src/db/client';
import { seedMonitors } from '../scripts/seed-watches-store';
import { parseWatchesYaml, toMonitorSeed, watchSchema, watchesYamlSchema } from '../scripts/seed-watches-schema';

const minimal = `
watches:
  - id: teste-rj
    query: notebook
    state: rj
`;

const realFile = '../Scrapelytics/watches.yaml';

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); });

describe('watches.yaml como formato de importação', () => {
  it('aplica defaults de filters/deal/settings', () => {
    const cfg = watchesYamlSchema.parse({ watches: [{ id: 'teste-rj', query: 'notebook', state: 'rj' }] });
    const w = cfg.watches[0]!;
    expect(w.filters.requireImage).toBe(true);
    expect(w.filters.ignoreProfessional).toBe(false);
    expect(w.filters.requireWords).toEqual([]);
    expect(w.deal.belowMedianPct).toBe(35);
    expect(w.deal.minSamples).toBe(15);
    expect(cfg.settings).toEqual({ pollIntervalMin: 3, maxPages: 2, pageDelayMs: 1500 });
  });

  it('rejeita watch sem query, UF inválida e lista vazia', () => {
    expect(() => watchSchema.parse({ id: 'x-rj', state: 'rj' })).toThrow();
    expect(() => watchSchema.parse({ id: 'x', query: 'q', state: 'RIO' })).toThrow();
    expect(() => watchesYamlSchema.parse({ watches: [] })).toThrow(/ao menos um watch/);
  });

  it('falha com mensagem clara em arquivo inválido', () => {
    expect(() => parseWatchesYaml('watches: não é lista')).toThrow(/watches.yaml inválido/);
  });

  it('importa os dois watches do repositório validado', () => {
    const cfg = parseWatchesYaml(readFileSync(realFile, 'utf8'));
    expect(cfg.watches.map((w) => w.id)).toEqual(['iphone-15-rj', 'ps5-slim-rj']);
  });
});

describe('toMonitorSeed', () => {
  it('transporta cidade/uf/preço/requireWords/pages e o teto manual', () => {
    const cfg = parseWatchesYaml(readFileSync(realFile, 'utf8'));
    const seed = toMonitorSeed(cfg.watches[0]!, cfg.settings);
    expect(seed).toEqual({
      label: 'iphone-15-rj', source: 'olx', query: 'iphone 15', category: 'celular',
      params: {
        uf: 'RJ', pages: 2, pageDelayMs: 1500, extraQuery: 'sf=1',
        requireWords: ['iphone 15'], minCents: 80_000, maxCents: 450_000, manualCeilingCents: 450_000,
      },
      // a política de 15 min do Brique prevalece sobre os 3 min do YAML
      intervalMinutes: 15,
    });
    expect(toMonitorSeed(cfg.watches[1]!, cfg.settings).category).toBe('console');
  });

  it('seed mínimo não inventa filtros de preço', () => {
    const cfg = parseWatchesYaml(minimal);
    expect(toMonitorSeed(cfg.watches[0]!, cfg.settings).params).toEqual({
      uf: 'RJ', pages: 2, pageDelayMs: 1500, extraQuery: 'sf=1', requireWords: [],
    });
  });
});

describe('seedMonitors', () => {
  it('insere uma vez e é idempotente na segunda importação', () => {
    const cfg = parseWatchesYaml(readFileSync(realFile, 'utf8'));
    const first = seedMonitors(db, cfg);
    expect(first.map((r) => r.inserted)).toEqual([true, true]);
    const second = seedMonitors(db, cfg);
    expect(second.map((r) => r.inserted)).toEqual([false, false]);
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
  });
});
