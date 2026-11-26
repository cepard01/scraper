// Filtros puros de idioma do monitor. Nenhuma função aqui toca banco, rede ou
// relógio: o pipeline decide o que fazer com o veredito (contar em run.rejected
// e nunca converter em alerta).

export function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function passesRequireWords(title: string, words: readonly string[] | undefined): boolean {
  if (!words || words.length === 0) return true;
  const normalized = normalizeTitle(title);
  return words.some((word) => {
    const needle = normalizeTitle(word);
    return needle.length > 0 && normalized.includes(needle);
  });
}

export type RequireWordsVerdict = { ok: true } | { ok: false; reason: 'require-words' };

export function requireWordsVerdict(title: string, words: readonly string[] | undefined): RequireWordsVerdict {
  return passesRequireWords(title, words) ? { ok: true } : { ok: false, reason: 'require-words' };
}
