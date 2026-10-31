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

  it('string vazia cai no default documentado, não em ""', () => {
    const cfg = loadConfig({ ...base, MELI_UNIT: '', TZ_DISPLAY: '', NTFY_BASE_URL: '' });
    expect(cfg.meliUnit).toBe('MLB');
    expect(cfg.tz).toBe('America/Sao_Paulo');
    expect(cfg.ntfy.baseUrl).toBe('https://ntfy.sh');
  });

  it('não vaza credencial de DATABASE_URL na mensagem de erro', () => {
    let msg = '';
    try {
      loadConfig({ DATABASE_URL: 'postgres://usuario:senha@host/db' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('postgres');
    expect(msg).toContain('DATABASE_URL');
    expect(msg).not.toContain('senha');
  });

  it('falha em sqlite:// sem caminho, nomeando DATABASE_URL', () => {
    let err: unknown;
    try {
      loadConfig({ DATABASE_URL: 'sqlite://' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).name).toBe('ConfigError');
    expect((err as Error).message).toContain('DATABASE_URL');
  });
});
