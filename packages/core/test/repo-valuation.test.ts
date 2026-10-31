import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import type { Db } from '../src/db/client';
import { comparableRefs } from '../src/db/schema';
import { getOrCreateFingerprint } from '../src/db/repo/fingerprints';
import { insertValuation, latestValuationFor } from '../src/db/repo/valuations';
import { insertOpportunity, listShortlistedRanked } from '../src/db/repo/opportunities';
import { upsertFromSource } from '../src/db/repo/listings';
import { createMonitor } from '../src/db/repo/monitors';
import type { ListingInput, OpportunityMath, ParsedProduct, Valuation } from '../src/types';

const product: ParsedProduct = { category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true };
const input = (externalId: string, askingCents: number): ListingInput => ({
  source: 'olx', externalId, url: `https://olx/a/${externalId}`, title: 'iPhone 12 128gb',
  description: '', askingCents, askingRaw: String(askingCents), city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null,
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
});

describe('opportunities', () => {
  it('rank lista apenas gatePassed, por score desc, com dados do listing', () => {
    const fp = getOrCreateFingerprint(db, product);
    const monitorId = createMonitor(db, { label: 'x', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
    const mk = (id: string, ask: number, score: number) => {
      const l = upsertFromSource(db, input(id, ask), { parserVersion: 'olx-1', monitorId, fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
      const math: OpportunityMath = {
        askingCents: ask, fairGrossCents: 150_000, netRealizableCents: 126_000, costsInCents: ask,
        marginCents: 126_000 - ask, marginPct: (126_000 - ask) / ask, expectedPerDayCents: 4_000,
        liquidityDays: 10, score, breakdown: { profitFactor: score, liquidityFactor: 0.5, confidenceFactor: 1, freshnessFactor: 0.5 },
      };
      insertOpportunity(db, l.id, math, { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });
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
    const v: Valuation = {
      fingerprintId: fp.id, sampleSize: 7, medianCents: 170_000, p25Cents: 160_000, p75Cents: 179_000,
      fairGrossCents: 143_600, delta: 0.85, liquidityDays: 10, liquiditySource: 'category-default',
      confidence: 'high', variantAgnostic: false, computedAt: new Date('2026-10-01T12:00:00Z'),
    };
    const { id: valuationId } = insertValuation(db, fp.id, v, [{ listingId: l.id, askingCents: 98_000, role: 'kept' }]);
    const math: OpportunityMath = {
      askingCents: 98_000, fairGrossCents: 143_600, netRealizableCents: 119_124, costsInCents: 99_000,
      marginCents: 20_124, marginPct: 0.2033, expectedPerDayCents: 2_012, liquidityDays: 10, score: 0.5,
      breakdown: { profitFactor: 0.5, liquidityFactor: 0.5, confidenceFactor: 1, freshnessFactor: 0.5 },
    };
    insertOpportunity(db, l.id, math, { valuationId, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });

    const row = listShortlistedRanked(db, 10)[0]!;
    expect(row.confidence).toBe('high');
    expect(row.sampleSize).toBe(7);
  });

  it('rank deixa fora a oportunidade que reprovou no gate', () => {
    const fp = getOrCreateFingerprint(db, product);
    const aprovado = upsertFromSource(db, input('gate-ok', 90_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const vetado = upsertFromSource(db, input('gate-no', 1_000), { parserVersion: 'olx-1', fingerprintId: fp.id, grade: 'B', seenAt: new Date('2026-10-01T12:00:00Z') });
    const math = (askingCents: number, score: number): OpportunityMath => ({
      askingCents, fairGrossCents: 150_000, netRealizableCents: 126_000, costsInCents: askingCents,
      marginCents: 126_000 - askingCents, marginPct: (126_000 - askingCents) / askingCents,
      expectedPerDayCents: 4_000, liquidityDays: 10, score,
      breakdown: { profitFactor: score, liquidityFactor: 0.5, confidenceFactor: 1, freshnessFactor: 0.5 },
    });
    insertOpportunity(db, aprovado.id, math(90_000, 0.4), { valuationId: null, gatePassed: true, gateReason: 'ok', createdAt: new Date('2026-10-01T12:00:00Z') });
    insertOpportunity(db, vetado.id, math(1_000, 0.99), { valuationId: null, gatePassed: false, gateReason: 'preco-rejeitado', createdAt: new Date('2026-10-01T12:00:00Z') });

    expect(listShortlistedRanked(db, 10).map((r) => r.externalId)).toEqual(['gate-ok']);
  });
});

describe('valuations', () => {
  const valuation = (fpId: number, over: Partial<Valuation>): Valuation => ({
    fingerprintId: fpId, sampleSize: 3, medianCents: 150_000, p25Cents: 140_000, p75Cents: 160_000,
    fairGrossCents: 127_500, delta: 0.85, liquidityDays: 10, liquiditySource: 'own',
    confidence: 'med', variantAgnostic: false, computedAt: new Date('2026-10-01T12:00:00Z'), ...over,
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
});
