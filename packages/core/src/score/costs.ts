import type { Category, Cents, Grade, Settings } from '../types';

const GRADE_REPAIR_FACTOR: Record<Grade, number> = { A: 0, B: 0.5, C: 1, D: 3 };

export function costsIn(askingCents: Cents, category: Category, grade: Grade, s: Settings): Cents {
  return askingCents
    + s.shippingInDefaultCents[category]
    + Math.round(s.repairDefaultCents[category] * GRADE_REPAIR_FACTOR[grade]);
}

export function netRealizable(fairGrossCents: Cents | null, outPlatform: string, s: Settings, category: Category): Cents | null {
  if (fairGrossCents === null) return null;
  const fee = s.platformFeePct[outPlatform] ?? 0;
  const gross = Math.round(fairGrossCents * (1 - fee - s.taxPct)) - s.shippingOutDefaultCents[category];
  return gross > 0 ? gross : null;
}
