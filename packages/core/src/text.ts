const URGENCY = [
  'urgente', 'urgência', 'não fico até amanhã', 'não fico amanhã', 'vendo rápido', 'última chance',
  'corra', 'corra antes que suma', 'não perca', 'promoção relâmpago', 'frete grátis só hoje',
];

const STOP_SYMBOLS = /[^\p{L}\p{N}\s]+/gu;

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeCase(s: string): string {
  return stripAccents(s.toLowerCase());
}

export function stripSymbols(s: string): string {
  return s.replace(STOP_SYMBOLS, ' ');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

const URGENCY_RE = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' +
    URGENCY
      .map((u) => normalizeCase(u).split(' ').map(escapeRe).join('\\s+'))
      .sort((a, b) => b.length - a.length)
      .join('|') +
    ')(?![\\p{L}\\p{N}])',
  'gu',
);

export function cleanTitle(s: string): string {
  const out = stripSymbols(normalizeCase(s)).replace(URGENCY_RE, ' ');
  return out.replace(/\s+/g, ' ').trim();
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
