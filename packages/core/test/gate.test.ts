import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/db/seed-settings';
import { gate } from '../src/score/gate';
import type { OpportunityMath, Settings } from '../src/types';

const math = (over: Partial<OpportunityMath> = {}): OpportunityMath => ({
  askingCents: 85_000, fairGrossCents: 150_000, netRealizableCents: 123_500, costsInCents: 86_000,
  marginCents: 37_500, marginPct: 37_500 / 86_000, expectedPerDayCents: 3_750, liquidityDays: 10, score: 0.97,
  breakdown: { profitFactor: 0.94, liquidityFactor: 1, confidenceFactor: 1, freshnessFactor: 1 }, ...over,
});

const OK = { sampleGate: 'ok' as const, hasFingerprint: true, settings: DEFAULT_SETTINGS };

describe('gate', () => {
  it('passa só quando os dois floors são superados', () => {
    expect(gate({ math: math({ marginPct: 0.40, marginCents: 7_000 }), ...OK })).toEqual({ passed: true, reason: 'ok' });
    expect(gate({ math: math({ marginPct: 0.36, marginCents: 5_000 }), ...OK }).reason).toBe('abaixo-do-floor');
    expect(gate({ math: math({ marginPct: 0.34, marginCents: 7_000 }), ...OK }).reason).toBe('abaixo-do-floor');
  });

  it('sem margem calculável bloqueia com o mesmo motivo, sem NaN', () => {
    expect(gate({ math: math({ marginPct: null, marginCents: null }), ...OK }).reason).toBe('abaixo-do-floor');
    expect(gate({ math: math({ marginPct: null, marginCents: null }), ...OK }).passed).toBe(false);
  });

  it('margem NaN bloqueia igual: o gate nunca devolve true para um numero que nao existe', () => {
    // P5 da sonda: hoje `NaN >= pctFloor` e false e o item cai em abaixo-do-floor por
    // acidente. O mutante que este expect mata e a reescrita `pct >= floor` ->
    // `!(pct < floor)`, o jeito mais plausivel de alguem "tornar a condicao mais
    // explicita" e abrir um buraco para o NaN (NaN < floor tambem e false, entao passaria).
    // Registrado o que este expect NAO distingue: afrouxar a guarda para `pct == null` foi
    // medido como VIVEU, porque NaN continua bloqueando pela comparacao — os dois fontes
    // tem comportamento observavel identico, e pino sem diferenca observavel e decoracao.
    expect(gate({ math: math({ marginPct: NaN }), ...OK }).passed).toBe(false);
    expect(gate({ math: math({ marginPct: NaN }), ...OK }).reason).toBe('abaixo-do-floor');
    expect(gate({ math: math({ marginCents: NaN }), ...OK }).passed).toBe(false);
  });

  it('amostra insuficiente bloqueia mesmo com margem altíssima', () => {
    expect(gate({ math: math({ marginPct: 3, marginCents: 900_000 }), sampleGate: 'insufficient', hasFingerprint: true, settings: DEFAULT_SETTINGS }).reason)
      .toBe('amostra-insuficiente');
  });

  it('confiança low exige o dobro do floor percentual', () => {
    expect(gate({ math: math({ marginPct: 0.70, marginCents: 7_000 }), ...OK, confidence: 'low' }).passed).toBe(true);
    expect(gate({ math: math({ marginPct: 0.65, marginCents: 7_000 }), ...OK, confidence: 'low' }).passed).toBe(false);
  });

  it('sem fingerprint bloqueia antes de tudo', () => {
    expect(gate({ math: math(), sampleGate: 'ok', hasFingerprint: false, settings: DEFAULT_SETTINGS }).reason).toBe('sem-fingerprint');
  });

  it('lê os floors das settings recebidas, não de constantes', () => {
    const exigente: Settings = { ...DEFAULT_SETTINGS, floorMarginPct: 0.9, floorMarginCents: 50_000 };
    expect(gate({ math: math(), ...OK, settings: exigente }).reason).toBe('abaixo-do-floor');

    const folgado: Settings = { ...DEFAULT_SETTINGS, floorMarginPct: 0.05, floorMarginCents: 1_000 };
    expect(gate({ math: math({ marginPct: 0.06, marginCents: 1_200 }), ...OK, settings: folgado }).passed).toBe(true);
    expect(gate({ math: math({ marginPct: 0.06, marginCents: 1_200 }), ...OK, settings: folgado, confidence: 'low' }).passed).toBe(false);
  });
});
