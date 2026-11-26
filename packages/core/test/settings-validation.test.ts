import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, DEFAULT_SETTINGS, loadSettings, setSettings, seedSettings, SettingsError, type Db } from '../src/db/client-helpers';
import { settings } from '../src/db/schema';

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); seedSettings(db, DEFAULT_SETTINGS); });

describe('settings validados', () => {
  it('defaults incluem hora do digest e nenhum envio anterior', () => {
    const s = loadSettings(db);
    expect(s.digestHourLocal).toBe(9);
    expect(s.lastDigestAt).toBeNull();
    expect(s.floorMarginCents).toBe(6000);
  });

  it('setSettings persiste hora e último digest como Date', () => {
    const at = new Date('2026-11-02T12:00:00Z');
    const next = setSettings(db, { digestHourLocal: 7, lastDigestAt: at });
    expect(next.lastDigestAt).toEqual(at);
    expect(loadSettings(db)).toMatchObject({ digestHourLocal: 7, lastDigestAt: at });
  });

  it('chave namespaced de health não vira setting de domínio', () => {
    db.insert(settings).values({ key: 'health:olx:zero-novos', value: '{"detail":"x"}', updatedAt: new Date() }).run();
    expect(loadSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('valor corrompido falha com o nome da chave, sem cast silencioso', () => {
    db.update(settings).set({ value: '{"delta":"errado"}' }).where(eq(settings.key, 'delta')).run();
    expect(() => loadSettings(db)).toThrow(SettingsError);
    expect(() => loadSettings(db)).toThrow(/delta/);
  });

  it('fora da hora 0-23 é rejeitado', () => {
    expect(() => setSettings(db, { digestHourLocal: 24 })).toThrow(SettingsError);
    expect(loadSettings(db).digestHourLocal).toBe(9);
  });

  it('seed não sobrescreve valor já persistido', () => {
    setSettings(db, { delta: 0.5 });
    seedSettings(db, DEFAULT_SETTINGS);
    expect(loadSettings(db).delta).toBe(0.5);
  });
});
