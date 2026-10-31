import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../src/config';

const base = { DATABASE_URL: 'sqlite://./data/brique.db' };

describe('loadConfig', () => {
  it('aceita o mínimo absoluto', () => {
    const cfg = loadConfig(base);
    expect(cfg.sqlitePath).toBe('./data/brique.db');
    expect(cfg.meliToken).toBeNull();
    expect(cfg.omniRoute.apiKey).toBeNull();
  });

  it('falha nomeando a variável ausente', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('falha em WEB_PORT não numérico', () => {
    expect(() => loadConfig({ ...base, WEB_PORT: 'abc' })).toThrow(/WEB_PORT/);
  });

  it('trata string vazia como ausência de segredo, não como segredo presente', () => {
    const cfg = loadConfig({ ...base, MELI_ACCESS_TOKEN: '' });
    expect(cfg.meliToken).toBeNull();
  });
});
