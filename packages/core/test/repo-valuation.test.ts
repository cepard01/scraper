import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import type { Db } from '../src/db/client';
import { comparableRefs, fingerprints, listings } from '../src/db/schema';
import { getOrCreateFingerprint, fingerprintKey } from '../src/db/repo/fingerprints';
import { insertValuation, latestValuationFor } from '../src/db/repo/valuations';
import { insertOpportunity, listShortlistedRanked } from '../src/db/repo/opportunities';
import { upsertFromSource, attachDupe } from '../src/db/repo/listings';
import { createMonitor } from '../src/db/repo/monitors';
import type { ListingInput, ListingStatus, OpportunityMath, ParsedProduct, Valuation } from '../src/types';

const product: ParsedProduct = { category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true };
const input = (externalId: string, askingCents: number): ListingInput => ({
  source: 'olx', externalId, url: `https://olx/a/${externalId}`, title: 'iPhone 12 128gb',
  description: '', askingCents, askingRaw: String(askingCents), city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null,
});

// fábricas compartilhadas: cada teste sobrescreve só o campo que ele está provando
const math = (askingCents: number, score: number): OpportunityMath => ({
  askingCents, fairGrossCents: 150_000, netRealizableCents: 126_000, costsInCents: askingCents,
  marginCents: 126_000 - askingCents, marginPct: (126_000 - askingCents) / askingCents,
  expectedPerDayCents: 4_000, liquidityDays: 10, score,
  breakdown: { profitFactor: score, liquidityFactor: 0.5, confidenceFactor: 1, freshnessFactor: 0.5 },
});

const valuation = (fingerprintId: number, over: Partial<Valuation> = {}): Valuation => ({
  fingerprintId, sampleSize: 5, medianCents: 160_000, p25Cents: 150_000, p75Cents: 170_000,
  fairGrossCents: 136_000, delta: 0.85, liquidityDays: 10, liquiditySource: 'category-default',
  confidence: 'med', variantAgnostic: false, computedAt: new Date('2026-10-01T12:00:00Z'),
  ...over,
});

let db: Db;
beforeEach(() => { db = openDb(':memory:').db; migrateDb(db); });

describe('fingerprints', () => {
  it('é idempotente por key e monta label legivel', () => {
    const a = getOrCreateFingerprint(db, product);
    const b = getOrCreateFingerprint(db, product);
    expect(b.id).toBe(a.id);
    expect(a.key).toBe('celular|apple|iphone 12|128gb-desbloqueado|B');
    expect(a.label).toBe('iPhone 12 128GB Desbloqueado (B)');
  });

  it('monta label com siglas e unidades no case certo', () => {
    expect(getOrCreateFingerprint(db, { category: 'console', brand: 'sony', model: 'ps4 slim', variant: '1tb', grade: 'C', matched: true }).label)
      .toBe('PS4 Slim 1TB (C)');
    expect(getOrCreateFingerprint(db, { category: 'bicicleta', brand: null, model: 'aro 29 mtb', variant: null, grade: 'B', matched: false }).label)
      .toBe('Aro 29 MTB (B)');
  });

  it('key não ganha campo fantasma quando um atributo traz barra vertical', () => {
    expect(fingerprintKey({ category: 'celular', brand: 'apple', model: 'iphone|12', variant: '128gb', grade: 'B', matched: true }))
      .toBe('celular|apple|iphone 12|128gb|B');
    const a = fingerprintKey({ ...product, model: 'x|y', variant: 'z' });
    const b = fingerprintKey({ ...product, model: 'x', variant: 'y|z' });
    expect(a).toBe('celular|apple|x y|z|B');
    expect(a).not.toBe(b);
  });

  it('reaproveita a linha quando outra via gravou a key primeiro', () => {
    db.insert(fingerprints).values({
      key: fingerprintKey(product), category: 'celular', brand: 'apple', model: 'iphone 12',
      variant: '128gb-desbloqueado', grade: 'B', label: 'gravada por outro processo',
    }).run();

    const got = getOrCreateFingerprint(db, product);
    expect(got.label).toBe('gravada por outro processo');
    expect(db.select().from(fingerprints).all()).toHaveLength(1);
  });
});

describe('opportunities', () => {
  it('rank lista apenas gatePassed, por score desc, com dados do listing', () => {
    const fp = getOrCreateFingerprint(db, product);
    const monitorId = createMonitor(db, { label: 'x', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const mk = (id: string, ask: number, score: number) => {
      const l = upsertFromSource(db, input(id, ask), { parserVersion: 'olx-1', monitorId, fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
      insertOpportunity(db, l.id, math(ask, score), { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });
    };
    mk('lo', 90_000, 0.4);
    mk('hi', 80_000, 0.9);
    mk('mid', 85_000, 0.7);

    const ranked = listShortlistedRanked(db, 10);
    expect(ranked.map((r) => r.externalId)).toEqual(['hi', 'mid', 'lo']);
    expect(ranked[0]!.title).toBe('iPhone 12 128gb');
    expect(ranked[0]!.confidence).toBe('none');   // nenhuma valuation ligada neste teste
    expect(ranked[0]!.sampleSize).toBe(0);
  });

  it('valuation com comparaveis fica consultavel pelo fingerprint', () => {
    const fp = getOrCreateFingerprint(db, product);
    const l = upsertFromSource(db, input('v1', 98_000), { parserVersion: 'olx-1', fingerprintId: fp.id, seenAt: new Date('2026-10-01T12:00:00Z') });
    const v: Valuation = { fingerprintId: fp.id, sampleSize: 1, medianCents: 98_000, p25Cents: 98_000, p75Cents: 98_000, fairGrossCents: 83_300, delta: 0.85, liquidityDays: 10, liquiditySource: 'category-default', confidence: 'low', variantAgnostic: false, computedAt: new Date('2026-10-01T12:00:00Z') };
    insertValuation(db, fp.id, v, [{ listingId: l.id, askingCents: 98_000, role: 'kept' }]);
    expect(latestValuationFor(db, fp.id)?.fairGrossCents).toBe(83_300);
  });

  it('rank traz amostra e confiança da valuation ligada', () => {
    const fp = getOrCreateFingerprint(db, product);
    const l = upsertFromSource(db, input('v2', 98_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const { id: valuationId } = insertValuation(db, fp.id, valuation(fp.id, { sampleSize: 7, confidence: 'high' }), [{ listingId: l.id, askingCents: 98_000, role: 'kept' }]);
    insertOpportunity(db, l.id, math(98_000, 0.5), { valuationId, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });

    const row = listShortlistedRanked(db, 10)[0]!;
    expect(row.confidence).toBe('high');
    expect(row.sampleSize).toBe(7);
  });

  it('rank deixa fora a oportunidade que reprovou no gate', () => {
    const fp = getOrCreateFingerprint(db, product);
    const aprovado = upsertFromSource(db, input('gate-ok', 90_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const vetado = upsertFromSource(db, input('gate-no', 1_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    insertOpportunity(db, aprovado.id, math(90_000, 0.4), { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });
    insertOpportunity(db, vetado.id, math(1_000, 0.99), { valuationId: null, gatePassed: false, gateReason: 'preco-rejeitado', createdAt: new Date('2026-10-01T12:00:00Z') });

    expect(listShortlistedRanked(db, 10).map((r) => r.externalId)).toEqual(['gate-ok']);
  });

  it('latestValuationFor devolve a mais recente por computedAt', () => {
    const fp = getOrCreateFingerprint(db, product);
    insertValuation(db, fp.id, valuation(fp.id, { fairGrossCents: 100_000, computedAt: new Date('2026-10-01T12:00:00Z') }), []);
    insertValuation(db, fp.id, valuation(fp.id, { fairGrossCents: 120_000, computedAt: new Date('2026-10-05T12:00:00Z') }), []);
    insertValuation(db, fp.id, valuation(fp.id, { fairGrossCents: 110_000, computedAt: new Date('2026-10-03T12:00:00Z') }), []);
    expect(latestValuationFor(db, fp.id)?.fairGrossCents).toBe(120_000);
    expect(latestValuationFor(db, getOrCreateFingerprint(db, { ...product, model: 'sem valuation' }).id)).toBeNull();
  });

  it('insertValuation grava cada comparável com o papel que a valoração aparou', () => {
    const fp = getOrCreateFingerprint(db, product);
    const mantido = upsertFromSource(db, input('c-keep', 150_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const aparado = upsertFromSource(db, input('c-trim', 12_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const { id } = insertValuation(db, fp.id, valuation(fp.id, {}), [
      { listingId: mantido.id, askingCents: 150_000, role: 'kept' },
      { listingId: aparado.id, askingCents: 12_000, role: 'trimmed' },
    ]);

    const refs = db.select().from(comparableRefs).where(eq(comparableRefs.valuationId, id)).all();
    expect(refs.map((r) => ({ listingId: r.listingId, askingCents: r.askingCents, role: r.role })))
      .toEqual([
        { listingId: mantido.id, askingCents: 150_000, role: 'kept' },
        { listingId: aparado.id, askingCents: 12_000, role: 'trimmed' },
      ]);
  });

  it('rank deixa fora o item comprado, vetado ou sumido', () => {
    const fp = getOrCreateFingerprint(db, product);
    const mk = (id: string, status: ListingStatus) => {
      const l = upsertFromSource(db, input(id, 90_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
      insertOpportunity(db, l.id, math(90_000, 0.5), { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });
      db.update(listings).set({ status }).where(eq(listings.id, l.id)).run();
    };
    mk('ativo', 'shortlisted');
    mk('comprado', 'bought');
    mk('vetado', 'ignored');
    mk('sumido', 'gone');

    expect(listShortlistedRanked(db, 10).map((r) => r.externalId)).toEqual(['ativo']);
  });

  it('rank mostra o veredito mais recente do item, não o melhor', () => {
    const fp = getOrCreateFingerprint(db, product);
    const revisitado = upsertFromSource(db, input('revis', 90_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const caiu = upsertFromSource(db, input('caiu', 90_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const fixo = upsertFromSource(db, input('fixo', 90_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const op = (listingId: number, score: number, gatePassed: boolean, createdAt: string) =>
      insertOpportunity(db, listingId, math(90_000, score), { valuationId: null, gatePassed, gateReason: gatePassed ? 'ok' : 'abaixo-do-floor', createdAt: new Date(createdAt) });

    op(revisitado.id, 0.9, true, '2026-10-01T12:00:00Z');
    op(revisitado.id, 0.2, true, '2026-10-06T12:00:00Z');   // segunda passada: o preço subiu, o score caiu
    op(caiu.id, 0.8, true, '2026-10-01T12:00:00Z');
    op(caiu.id, 0.1, false, '2026-10-06T12:00:00Z');        // segunda passada reprova
    op(fixo.id, 0.5, true, '2026-10-01T12:00:00Z');

    const ranked = listShortlistedRanked(db, 10);
    expect(ranked.map((r) => r.externalId)).toEqual(['fixo', 'revis']);
    expect(ranked[1]!.score).toBe(0.2);
  });

  it('rank é estável quando dois itens empatam no score', () => {
    const fp = getOrCreateFingerprint(db, product);
    const a = upsertFromSource(db, input('empate-a', 90_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const b = upsertFromSource(db, input('empate-b', 95_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    insertOpportunity(db, a.id, math(90_000, 0.6), { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });
    insertOpportunity(db, b.id, math(95_000, 0.6), { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });

    expect(listShortlistedRanked(db, 10).map((r) => r.externalId)).toEqual(['empate-a', 'empate-b']);
  });

  it('rank degrada para none quando a valuation apontada é de outro fingerprint', () => {
    const fp = getOrCreateFingerprint(db, product);
    const outro = getOrCreateFingerprint(db, { ...product, brand: 'samsung', model: 'galaxy s21' });
    const l = upsertFromSource(db, input('trocado', 90_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const { id: valuationId } = insertValuation(db, outro.id, valuation(outro.id, { sampleSize: 9, confidence: 'high' }), []);
    insertOpportunity(db, l.id, math(90_000, 0.5), { valuationId, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });

    const row = listShortlistedRanked(db, 10)[0]!;
    expect(row.confidence).toBe('none');
    expect(row.sampleSize).toBe(0);
  });

  it('latestValuationFor devolve campo por campo o que insertValuation gravou', () => {
    const fp = getOrCreateFingerprint(db, product);
    const v = valuation(fp.id, {
      sampleSize: 12, medianCents: 170_000, p25Cents: 155_000, p75Cents: 179_000,
      fairGrossCents: 143_600, delta: 0.82, liquidityDays: 14, liquiditySource: 'market',
      confidence: 'high', variantAgnostic: true, computedAt: new Date('2026-10-04T09:30:00Z'),
    });
    insertValuation(db, fp.id, v, []);
    expect(latestValuationFor(db, fp.id)).toEqual(v);
  });

  it('insertValuation recusa valuation de outro fingerprint', () => {
    const fp = getOrCreateFingerprint(db, product);
    const outro = getOrCreateFingerprint(db, { ...product, variant: '256gb' });
    expect(() => insertValuation(db, fp.id, valuation(outro.id, {}), [])).toThrow(/fingerprint/i);
    expect(latestValuationFor(db, outro.id)).toBeNull();
  });

  it('rank deixa fora a duplicata cross-source, só o sobrevivente aparece', () => {
    const fp = getOrCreateFingerprint(db, product);
    const sobrevivente = upsertFromSource(db, { ...input('meli-1', 90_000), source: 'meli' }, { parserVersion: 'meli-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const duplicata = upsertFromSource(db, input('olx-1', 91_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    insertOpportunity(db, sobrevivente.id, math(90_000, 0.5), { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });
    insertOpportunity(db, duplicata.id, math(91_000, 0.5), { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });
    attachDupe(db, duplicata.id, sobrevivente.id);

    expect(listShortlistedRanked(db, 10).map((r) => r.externalId)).toEqual(['meli-1']);
  });

  it('insertValuation faz rollback quando um comparavel nao existe', () => {
    const fp = getOrCreateFingerprint(db, product);
    expect(() => insertValuation(db, fp.id, valuation(fp.id, {}), [
      { listingId: 999_999, askingCents: 150_000, role: 'kept' },
    ])).toThrow();
    expect(latestValuationFor(db, fp.id)).toBeNull();
    expect(db.select().from(comparableRefs).all()).toHaveLength(0);
  });
});
