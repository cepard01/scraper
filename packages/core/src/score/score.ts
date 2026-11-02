import type { Category, Grade, OpportunityMath, Settings, Valuation } from '../types';
import { costsIn, netRealizable } from './costs';

const CONFIDENCE_FACTOR = { low: 0.3, med: 0.7, high: 1.0 } as const;

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

export function scoreOpportunity(args: {
  askingCents: number;
  valuation: Valuation;
  category: Category;
  grade: Grade;
  outPlatform: string;
  seenAt: Date;
  now: Date;
  settings: Settings;
}): OpportunityMath {
  const s = args.settings;
  const v = args.valuation;
  const costs = costsIn(args.askingCents, args.category, args.grade, s);
  const net = netRealizable(v.fairGrossCents, args.outPlatform, s, args.category);
  const margin = net === null ? null : net - costs;
  const marginPct = margin === null || costs === 0 ? null : margin / costs;
  const rawLiquidityDays = v.liquidityDays;
  const liquidityDays = Number.isFinite(rawLiquidityDays) ? Math.max(rawLiquidityDays, 1) : 1;
  const expectedPerDay = margin === null || margin <= 0 ? null : Math.round(margin / liquidityDays);

  const profitFactor = clamp01((expectedPerDay ?? 0) / s.metaPerDayCents);
  const liquidityFactor = clamp01(s.metaDays / liquidityDays);
  const confidenceFactor = CONFIDENCE_FACTOR[v.confidence];
  const ageDays = Math.max(0, (args.now.getTime() - args.seenAt.getTime()) / 86_400_000);
  const freshnessFactor = Math.exp(-ageDays / 3);

  const composed = s.weights.profit * profitFactor
    + s.weights.liquidity * liquidityFactor
    + s.weights.confidence * confidenceFactor
    + s.weights.freshness * freshnessFactor;
  // `!Number.isFinite(composed)` e a R98: um `weights` vindo torto de uma linha `setting`
  // corrompida produziria NaN nesta linha, e NaN ordenado numa lista e posicao
  // imprevisivel, nao "ultimo lugar". 0 e o valor que ja significa "nao recomendo".
  // Ja `weights` null estoura TypeError acima, de proposito: ai o erro e um sinal.
  const score = v.sampleSize === 0 || margin === null || !Number.isFinite(composed)
    ? 0
    : clamp01(composed);

  return {
    askingCents: args.askingCents,
    fairGrossCents: v.fairGrossCents,
    netRealizableCents: net,
    costsInCents: costs,
    marginCents: margin,
    marginPct,
    expectedPerDayCents: expectedPerDay,
    liquidityDays,
    score,
    breakdown: { profitFactor, liquidityFactor, confidenceFactor, freshnessFactor },
  };
}

export { costsIn, netRealizable };
