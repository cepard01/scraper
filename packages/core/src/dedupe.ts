import type { Cents } from './types';
import { jaccard, shingles } from './text';

export function samePriceWindow(a: Cents, b: Cents, tolerancePct = 0.05): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= tolerancePct;
}

export function findDupe(
  candidates: { listingId: number; title: string; askingCents: Cents }[],
  target: { title: string; askingCents: Cents },
): number | null {
  const targetSet = shingles(target.title);
  if (targetSet.size === 0) return null;
  let bestId: number | null = null;
  let bestScore = 0.55;
  for (const c of candidates) {
    if (!samePriceWindow(c.askingCents, target.askingCents)) continue;
    const score = jaccard(targetSet, shingles(c.title));
    if (score > bestScore) { bestScore = score; bestId = c.listingId; }
  }
  return bestId;
}
