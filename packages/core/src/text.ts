const URGENCY = [
  'urgente', 'urgência', 'urgen', 'não fico até amanhã', 'nao fico amanha', 'vendo rápido',
  'vendo rapido', 'última chance', 'ultima chance', 'corra', 'corra antes que suma',
  'não perca', 'nao perca', 'promoção relâmpago', 'frete grátis só hoje',
];

const STOP_SYMBOLS = /[^\p{L}\p{N}\s]+/gu;

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeCase(s: string): string {
  return stripAccents(s.toLowerCase());
}

export function cleanTitle(s: string): string {
  let out = normalizeCase(s ?? '');
  out = out.replace(new RegExp(URGENCY.map((u) => escapeRe(normalizeCase(u))).join('|'), 'g'), ' ');
  out = out.replace(STOP_SYMBOLS, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function shingles(s: string, n = 3): Set<string> {
  const tokens = cleanTitle(s).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (tokens.length === 0) return out;
  if (tokens.length <= n) {
    out.add(tokens.join(' '));
    return out;
  }
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter++;
  return inter / (a.size + b.size - inter);
}
