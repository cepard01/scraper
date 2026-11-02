import type { RankedRow } from '@brique/core/db/repo/opportunities';
import { formatBRL } from '@brique/core/money';

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

export function printShortlist(rows: RankedRow[]): string {
  if (rows.length === 0) return 'sem finalistas: nenhum anuncio cruzou o floor de margem nesta passada.';
  const head = `${pad('score', 6)}${pad('item', 40)}${pad('pedido', 12)}${pad('justo', 12)}${pad('margem', 12)}${pad('R$/dia', 10)}${pad('n', 4)}${pad('conf', 6)}cidade`;
  const lines = rows.map((r) => [
    pad(r.score.toFixed(2), 6),
    pad(r.title, 40),
    pad(formatBRL(r.askingCents), 12),
    pad(r.fairGrossCents === null ? '-' : formatBRL(r.fairGrossCents), 12),
    pad(r.marginCents === null ? '-' : formatBRL(r.marginCents), 12),
    pad(r.expectedPerDayCents === null ? '-' : formatBRL(r.expectedPerDayCents), 10),
    pad(String(r.sampleSize), 4),
    pad(r.confidence, 6),
    r.city ?? '-',
  ].join(''));
  return [head, '-'.repeat(head.length), ...lines].join('\n');
}
