import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, loadSettings, type Db } from '../src/db/client-helpers';
import { settings } from '../src/db/schema';
import { healthNoticeDue, healthSettingKey, markHealthNotice } from '../src/source-health-notifier';

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); seedSettings(db, DEFAULT_SETTINGS); });

const now = new Date('2026-11-02T12:00:00Z');
const degraded = (reason: 'zero-novos' | 'yield-caiu', detail = 'detalhe') => ({
  degraded: true, reason, detail,
});
const recovered = { degraded: false, reason: null, detail: 'ok' };
const mark = (source: 'olx' | 'meli', health: ReturnType<typeof degraded>) => markHealthNotice(db, source, health, now);

describe('dedupe de aviso de fonte degradada', () => {
  it('notifica uma vez por fonte e motivo', () => {
    const health = degraded('zero-novos');
    expect(healthNoticeDue(db, 'olx', health).shouldNotify).toBe(true);
    mark('olx', health);
    expect(healthNoticeDue(db, 'olx', health).shouldNotify).toBe(false);
    expect(healthNoticeDue(db, 'olx', degraded('zero-novos', 'detalhe diferente')).shouldNotify).toBe(false);
  });

  it('entrega falha não marca a chave e pode tentar de novo', () => {
    const health = degraded('zero-novos');
    expect(healthNoticeDue(db, 'olx', health).shouldNotify).toBe(true);
    expect(healthNoticeDue(db, 'olx', health).shouldNotify).toBe(true);
    mark('olx', health);
    expect(healthNoticeDue(db, 'olx', health).shouldNotify).toBe(false);
  });

  it('mesmo motivo em outra fonte é aviso independente', () => {
    const health = degraded('zero-novos');
    mark('olx', health);
    expect(healthNoticeDue(db, 'meli', health).shouldNotify).toBe(true);
  });

  it('recuperação limpa a chave; nova degradação do mesmo motivo avisa de novo', () => {
    const health = degraded('zero-novos');
    mark('olx', health);
    expect(healthNoticeDue(db, 'olx', recovered).shouldNotify).toBe(false);
    expect(db.select().from(settings).where(eq(settings.key, healthSettingKey('olx', 'zero-novos'))).all()).toHaveLength(0);
    expect(healthNoticeDue(db, 'olx', health).shouldNotify).toBe(true);
  });

  it('motivo diferente não é sufocado pelo anterior', () => {
    mark('olx', degraded('zero-novos'));
    expect(healthNoticeDue(db, 'olx', degraded('yield-caiu')).shouldNotify).toBe(true);
  });

  it('chave namespaced não entra em loadSettings', () => {
    mark('olx', degraded('zero-novos'));
    expect(loadSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});
