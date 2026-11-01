const sortedCopy = (values: number[]): number[] => [...values].sort((a, b) => a - b);

export function medianCents(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = sortedCopy(values);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = sortedCopy(values);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = s[base]!;
  const upper = s[base + 1] ?? lower;
  return Math.round(lower + rest * (upper - lower));
}

export function keepFlags(values: number[], ratio = 0.1): boolean[] {
  const n = values.length;
  if (n === 0) return [];

  if (n < 7) {
    const med = medianCents(values)!;
    const flags = values.map((v) => v <= med * 3 && v >= med / 3);
    return flags.some(Boolean) ? flags : values.map(() => true);
  }

  const cut = Math.floor(n * ratio);
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v).map((x) => x.i);
  const flags: boolean[] = new Array(n).fill(true);
  for (let k = 0; k < cut; k++) {
    flags[order[k]!] = false;
    flags[order[n - 1 - k]!] = false;
  }
  return flags;
}

export function trimOutliers(values: number[], ratio = 0.1): { kept: number[]; trimmed: number[] } {
  const flags = keepFlags(values, ratio);
  const kept: number[] = [];
  const trimmed: number[] = [];
  values.forEach((v, i) => (flags[i] ? kept : trimmed).push(v));
  return { kept: sortedCopy(kept), trimmed: sortedCopy(trimmed) };
}
