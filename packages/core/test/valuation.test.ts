import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { openDb, migrateDb, seedSettings, loadSettings, DEFAULT_SETTINGS } from '../src/db/client-helpers';
import { getOrCreateFingerprint } from '../src/db/repo/fingerprints';
import { upsertFromSource, setStatus } from '../src/db/repo/listings';
import { valueFingerprint, confidenceFor } from '../src/valuation/valuation';
import { liquidityFor } from '../src/valuation/liquidity';
import { localAskingProvider } from '../src/valuation/comparables';
import type { ListingInput, ParsedProduct } from '../src/types';

const product: ParsedProduct = { category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true };
const listing = (id: string, ask: number): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx/a/${id}`, title: 'iPhone 12 128GB Desbloqueado',
  description: 'usado', askingCents: ask, askingRaw: String(ask), city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null,
});

let db: ReturnType<typeof openDb>['db'];
const NOW = new Date('2026-10-05T12:00:00Z');

beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
  seedSettings(db, DEFAULT_SETTINGS);
});

const seedComparables = (asks: number[]) => {
  const fp = getOrCreateFingerprint(db, product);
  const seenAt = new Date('2026-10-01T12:00:00Z');
  asks.forEach((ask, i) => {
    upsertFromSource(db, listing(`c${i}`, ask), { parserVersion: 'olx-1', fingerprintId: fp.id, seenAt });
  });
  return fp;
};

const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);
// o externalId carrega o fingerprintId: upsertFromSource casa por (source, externalId),
// entao dois grupos com o mesmo id nao seriam dois anuncios, seriam o mesmo anuncio
// migando de fingerprint a cada chamada.
const seedGone = (fingerprintId: number, i: number, firstSeen: Date, lastSeen: Date) => {
  const l = listing(`g${fingerprintId}-${i}`, 100_000);
  const { id } = upsertFromSource(db, l, { parserVersion: 'olx-1', fingerprintId, seenAt: firstSeen });
  upsertFromSource(db, l, { parserVersion: 'olx-1', fingerprintId, seenAt: lastSeen });
  setStatus(db, id, 'gone');
};

describe('confidenceFor', () => {
  it('espelha a guarda de amostra da spec', () => {
    expect(confidenceFor(9, false)).toBe('high');
    expect(confidenceFor(6, false)).toBe('med');
    // a fronteira do med e 5: `sampleSize >= 5` -> `>= 6` passava verde com 9/6/4/2
    // porque nenhum outro teste do plano cai com exatamente cinco comparaveis mantidos.
    expect(confidenceFor(5, false)).toBe('med');
    expect(confidenceFor(4, false)).toBe('low');
    expect(confidenceFor(2, false)).toBeNull();
  });
  it('fallback variant-agnostic no maximo med', () => {
    expect(confidenceFor(20, true)).toBe('med');
  });
});

describe('loadSettings', () => {
  it('reconstrui as settings do banco e casa com o objeto padrao', () => {
    expect(loadSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('o que esta gravado no banco vence o default', () => {
    db.run(sql`update setting set value = '0.9' where key = 'delta'`);
    expect(loadSettings(db).delta).toBe(0.9);
    expect(loadSettings(db).metaDays).toBe(DEFAULT_SETTINGS.metaDays);
  });
});

describe('valueFingerprint', () => {
  it('mediana aparada x delta gera fairGross', () => {
    const fp = seedComparables([90_000, 95_000, 98_000, 100_000, 102_000, 105_000, 108_000, 110_000, 120_000, 900_000]);
    const res = valueFingerprint(db, fp.id, { settings: DEFAULT_SETTINGS, now: NOW, provider: localAskingProvider, category: 'celular' });
    expect(res.sampleGate).toBe('ok');
    expect(res.valuation.medianCents).toBeGreaterThan(95_000);
    expect(res.valuation.medianCents).toBeLessThan(115_000);
    expect(res.valuation.fairGrossCents).toBe(Math.round(res.valuation.medianCents! * 0.85));
    expect(res.valuation.confidence).toBe('high');
    expect(res.comparables.some((c) => c.role === 'trimmed')).toBe(true);
  });

  it('o role e do anuncio, nao de "existe um aparado em algum lugar"', () => {
    const fp = seedComparables([90_000, 95_000, 98_000, 100_000, 102_000, 105_000, 108_000, 110_000, 120_000, 900_000]);
    const res = valueFingerprint(db, fp.id, { settings: DEFAULT_SETTINGS, now: NOW, provider: localAskingProvider, category: 'celular' });
    // mediana e sampleSize nascem de kept, nunca desta lista: `flags[i]` -> `flags[i + 1]`
    // desloca o rotulo dos dez anuncios com a matematica intacta e o some() de cima verde.
    // O que o painel grava em comparable_ref e o rotulo, entao ele e que tem de ser preso.
    const roleDe = (ask: number) => res.comparables.find((c) => c.askingCents === ask)!.role;
    expect(res.comparables).toHaveLength(10);
    expect(new Set(res.comparables.map((c) => c.listingId)).size).toBe(10);
    expect(roleDe(90_000)).toBe('trimmed');   // a cauda de baixo
    expect(roleDe(900_000)).toBe('trimmed');  // a cauda de cima
    expect(roleDe(102_000)).toBe('kept');
    expect(roleDe(120_000)).toBe('kept');     // vizinho do aparado: decide por indice, nao por valor
  });

  it('n<3: sampleGate insufficient, mas fair e calculado igual', () => {
    const fp = seedComparables([98_000, 100_000]);
    const res = valueFingerprint(db, fp.id, { settings: DEFAULT_SETTINGS, now: NOW, provider: localAskingProvider, category: 'celular' });
    expect(res.sampleGate).toBe('insufficient');
    expect(res.valuation.fairGrossCents).not.toBeNull();
    expect(res.valuation.confidence).toBe('low');
  });

  it('sem comparaveis devolve null e gate insufficient', () => {
    const fp = getOrCreateFingerprint(db, product);
    const res = valueFingerprint(db, fp.id, { settings: DEFAULT_SETTINGS, now: NOW, provider: localAskingProvider, category: 'celular' });
    expect(res.sampleGate).toBe('insufficient');
    expect(res.valuation.medianCents).toBeNull();
    expect(res.valuation.fairGrossCents).toBeNull();
    expect(res.valuation.confidence).toBe('low');
  });

  it('liquidez usa default de categoria no cold start', () => {
    const fp = getOrCreateFingerprint(db, product);
    const liq = liquidityFor(db, fp.id, 'celular', DEFAULT_SETTINGS, NOW);
    expect(liq).toEqual({ days: 10, source: 'category-default' });
    const bic = liquidityFor(db, fp.id, 'bicicleta', DEFAULT_SETTINGS, NOW);
    expect(bic.days).toBe(25);
  });

  it('liquidez de mercado usa a media dos spans quando ha 5 saidas', () => {
    const fp = getOrCreateFingerprint(db, product);
    for (let i = 0; i < 5; i++) seedGone(fp.id, i, daysBefore(NOW, 20), daysBefore(NOW, 14));
    expect(liquidityFor(db, fp.id, 'celular', DEFAULT_SETTINGS, NOW)).toEqual({ days: 6, source: 'market' });
  });

  it('quatro saidas nao bastam e o default de categoria ganha', () => {
    const fp = getOrCreateFingerprint(db, product);
    for (let i = 0; i < 4; i++) seedGone(fp.id, i, daysBefore(NOW, 20), daysBefore(NOW, 14));
    expect(liquidityFor(db, fp.id, 'celular', DEFAULT_SETTINGS, NOW)).toEqual({ days: 10, source: 'category-default' });
  });

  it('saida fora da janela de 180 dias nao conta para o mercado', () => {
    const fp = getOrCreateFingerprint(db, product);
    for (let i = 0; i < 5; i++) seedGone(fp.id, i, daysBefore(NOW, 260), daysBefore(NOW, 200));
    expect(liquidityFor(db, fp.id, 'celular', DEFAULT_SETTINGS, NOW)).toEqual({ days: 10, source: 'category-default' });
  });

  it('span virgula zero vira um dia e span gigante e aparado no teto de 120', () => {
    const fp = getOrCreateFingerprint(db, product);
    const mesmo = daysBefore(NOW, 30);
    for (let i = 0; i < 5; i++) seedGone(fp.id, i, mesmo, mesmo);
    expect(liquidityFor(db, fp.id, 'celular', DEFAULT_SETTINGS, NOW)).toEqual({ days: 1, source: 'market' });
    const fp2 = getOrCreateFingerprint(db, { ...product, variant: '64gb-desbloqueado' });
    for (let i = 0; i < 5; i++) seedGone(fp2.id, i, daysBefore(NOW, 175), daysBefore(NOW, 20));
    expect(liquidityFor(db, fp2.id, 'celular', DEFAULT_SETTINGS, NOW).days).toBe(120);
  });
});

describe('localAskingProvider', () => {
  it('provider de asking nunca afirma venda: sold e false em toda linha', () => {
    const fp = seedComparables([90_000, 95_000, 100_000]);
    const rows = localAskingProvider.collect(db, { fingerprintId: fp.id, windowDays: 90, variantAgnostic: false, now: NOW });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.sold === false)).toBe(true);
  });

  it('excludeListingId chega ao repo: o anuncio avaliado fica fora da propria mediana', () => {
    const fp = seedComparables([90_000, 95_000, 100_000]);
    const ctx = { fingerprintId: fp.id, windowDays: 90, variantAgnostic: false, now: NOW };
    const todos = localAskingProvider.collect(db, ctx);
    const excluido = todos[1]!.listingId;
    const sem = localAskingProvider.collect(db, { ...ctx, excludeListingId: excluido });
    expect(todos).toHaveLength(3);
    expect(sem).toHaveLength(2);
    expect(sem.map((r) => r.listingId)).not.toContain(excluido);
  });

  it('windowDays do ctx e a janela do repo: o que esta fora nao volta', () => {
    const fp = seedComparables([90_000, 95_000, 100_000]);
    const apertado = localAskingProvider.collect(db, { fingerprintId: fp.id, windowDays: 1, variantAgnostic: false, now: NOW });
    const folgado = localAskingProvider.collect(db, { fingerprintId: fp.id, windowDays: 30, variantAgnostic: false, now: NOW });
    expect(apertado).toEqual([]);
    expect(folgado).toHaveLength(3);
  });
});
