import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/db/seed-settings';
import { scoreOpportunity } from '../src/score/score';
import { costsIn, netRealizable } from '../src/score/costs';
import type { Settings, Valuation } from '../src/types';

const NOW = new Date('2026-10-05T12:00:00Z');
const valuation = (over: Partial<Valuation> = {}): Valuation => ({
  fingerprintId: 1, sampleSize: 10, medianCents: 176_470, p25Cents: 170_000, p75Cents: 180_000,
  fairGrossCents: 150_000, delta: 0.85, liquidityDays: 10, liquiditySource: 'market',
  confidence: 'high', variantAgnostic: false, computedAt: NOW, ...over,
});

describe('custos', () => {
  it('costsIn soma frete de entrada e reparo ponderado pela grade', () => {
    // celular: shippingIn 0, repair 2000; fator B = 0,5  ->  85.000 + 0 + 1.000
    expect(costsIn(85_000, 'celular', 'B', DEFAULT_SETTINGS)).toBe(86_000);
    expect(costsIn(85_000, 'celular', 'A', DEFAULT_SETTINGS)).toBe(85_000);
    expect(costsIn(85_000, 'celular', 'C', DEFAULT_SETTINGS)).toBe(87_000);
    expect(costsIn(85_000, 'celular', 'D', DEFAULT_SETTINGS)).toBe(91_000);
    // bicicleta: shippingIn 3000, repair 5000 -> B: 85.000 + 3.000 + 2.500
    expect(costsIn(85_000, 'bicicleta', 'B', DEFAULT_SETTINGS)).toBe(90_500);
  });

  it('netRealizable desconta taxa de plataforma, imposto e frete de saída', () => {
    // meli: fee 0,16, tax 0 -> 150.000 * 0,84 = 126.000; menos frete de saída de celular (2.500)
    expect(netRealizable(150_000, 'meli', DEFAULT_SETTINGS, 'celular')).toBe(123_500);
    expect(netRealizable(150_000, 'olx', DEFAULT_SETTINGS, 'celular')).toBe(147_500);
    expect(netRealizable(null, 'meli', DEFAULT_SETTINGS, 'celular')).toBeNull();
  });

  it('netRealizable devolve null quando a saída não cobra nem o frete', () => {
    const carissimo: Settings = { ...DEFAULT_SETTINGS, shippingOutDefaultCents: { ...DEFAULT_SETTINGS.shippingOutDefaultCents, celular: 200_000 } };
    expect(netRealizable(150_000, 'meli', carissimo, 'celular')).toBeNull();
  });
});

describe('scoreOpportunity', () => {
  it('calcula margem, ROI e R$/dia a partir de um caso concreto', () => {
    const m = scoreOpportunity({
      askingCents: 85_000, valuation: valuation(), category: 'celular', grade: 'B',
      outPlatform: 'meli', seenAt: NOW, now: NOW, settings: DEFAULT_SETTINGS,
    });
    expect(m.costsInCents).toBe(86_000);
    expect(m.netRealizableCents).toBe(123_500);
    expect(m.marginCents).toBe(37_500);
    expect(m.marginPct).toBeCloseTo(37_500 / 86_000, 6);
    expect(m.liquidityDays).toBe(10);
    expect(m.expectedPerDayCents).toBe(3_750);
    // 0,45*(3750/4000) + 0,25*1 + 0,15*1 + 0,15*1
    expect(m.score).toBeCloseTo(0.971875, 5);
    expect(m.score).toBeGreaterThanOrEqual(0);
    expect(m.score).toBeLessThanOrEqual(1);
  });

  it('margem maior com resto igual implica score maior', () => {
    const args = (ask: number) => scoreOpportunity({
      askingCents: ask, valuation: valuation(), category: 'celular', grade: 'B',
      outPlatform: 'meli', seenAt: NOW, now: NOW, settings: DEFAULT_SETTINGS,
    });
    expect(args(70_000).score).toBeGreaterThan(args(85_000).score);
  });

  it('liquidez pior derruba o score a margem igual', () => {
    const v10 = valuation({ liquidityDays: 10 });
    const v60 = valuation({ liquidityDays: 60 });
    const mk = (v: Valuation) => scoreOpportunity({ askingCents: 85_000, valuation: v, category: 'celular', grade: 'B', outPlatform: 'meli', seenAt: NOW, now: NOW, settings: DEFAULT_SETTINGS });
    expect(mk(v10).score).toBeGreaterThan(mk(v60).score);
  });

  it('anuncio mais velho pontua menos', () => {
    const mk = (hoursAgo: number) => scoreOpportunity({
      askingCents: 85_000, valuation: valuation(), category: 'celular', grade: 'B', outPlatform: 'meli',
      seenAt: new Date(NOW.getTime() - hoursAgo * 3_600_000), now: NOW, settings: DEFAULT_SETTINGS,
    });
    expect(mk(1).breakdown.freshnessFactor).toBeGreaterThan(mk(48).breakdown.freshnessFactor);
  });

  it('confidence low reduz score sem zerar', () => {
    const m = scoreOpportunity({ askingCents: 85_000, valuation: valuation({ confidence: 'low' }), category: 'celular', grade: 'B', outPlatform: 'meli', seenAt: NOW, now: NOW, settings: DEFAULT_SETTINGS });
    expect(m.breakdown.confidenceFactor).toBe(0.3);
    expect(m.score).toBeGreaterThan(0);
  });

  it('sem comparaveis (fairGross null) gera score 0 e margem null, sem NaN', () => {
    const m = scoreOpportunity({ askingCents: 85_000, valuation: valuation({ fairGrossCents: null, medianCents: null, sampleSize: 0 }), category: 'celular', grade: 'B', outPlatform: 'meli', seenAt: NOW, now: NOW, settings: DEFAULT_SETTINGS });
    expect(m.marginCents).toBeNull();
    expect(m.marginPct).toBeNull();
    expect(m.netRealizableCents).toBeNull();
    expect(m.score).toBe(0);
    expect(Number.isNaN(m.score)).toBe(false);
  });

  it('peso que nao e numero derruba o score para zero, nunca para NaN', () => {
    // P1 da sonda de pre-voo: uma linha `setting` corrompida (loadSettings nao valida,
    // R98/F da Task 13) entrega weights sem uma das chaves, e `undefined * fator` e NaN.
    // NaN em coluna de ordenacao nao e "ultimo da lista": e posicao imprevisivel. Zero ja
    // significa "nao recomendo" neste projeto, então e o unico canto para onde a
    // aritmetica pode cair. Pesar null continua estourando TypeError de proposito — aqui
    // o erro e um sinal, nao um ranking silenciosamente errado.
    const incompleto: Settings = { ...DEFAULT_SETTINGS, weights: { profit: 0.45 } as unknown as Settings['weights'] };
    const m = scoreOpportunity({ askingCents: 85_000, valuation: valuation(), category: 'celular', grade: 'B', outPlatform: 'meli', seenAt: NOW, now: NOW, settings: incompleto });
    expect(m.marginCents).toBe(37_500);
    expect(Number.isFinite(m.score)).toBe(true);
    expect(m.score).toBe(0);
  });

  it('liquidityDays que nao e numero vira 1, nao NaN pela linha inteira', () => {
    // P3: liquidityDefaults carregado como '7' (nao-objeto) devolve undefined para a
    // categoria, e `Math.max(undefined, 1)` e NaN — o NaN entao escorre para
    // expectedPerDay, para o profitFactor e para o score.
    const m = scoreOpportunity({ askingCents: 85_000, valuation: valuation({ liquidityDays: undefined as unknown as number }), category: 'celular', grade: 'B', outPlatform: 'meli', seenAt: NOW, now: NOW, settings: DEFAULT_SETTINGS });
    expect(m.liquidityDays).toBe(1);
    expect(Number.isFinite(m.expectedPerDayCents!)).toBe(true);
    expect(Number.isFinite(m.score)).toBe(true);
  });

  it('fairGross NaN nao escapa como preco realizavel', () => {
    // P4: hoje o `gross > 0` do costs.ts rejeita NaN porque `NaN > 0` e false. Certo por
    // acidente; o expect transforma isso em contrato para a proxima edicao que trocar a
    // saida por `Number.isNaN(gross) ? null : gross` ou por um `!== null` ingenuo.
    expect(netRealizable(NaN as unknown as number, 'meli', DEFAULT_SETTINGS, 'celular')).toBeNull();
  });
});
