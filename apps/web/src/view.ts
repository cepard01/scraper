import { formatBRL } from '@brique/core/money';
import type { AlertStatus } from '@brique/core/types';

export const money = (cents: number | null): string => cents === null ? 'n/d' : formatBRL(cents);
export const pct = (value: number | null): string => value === null ? 'n/d' : `${Math.round(value * 100)}%`;

export function dateTime(value: Date | null, tz: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(value);
}

export const dateOnly = (value: Date | null, tz: string): string =>
  value ? new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(value) : '—';

const BREAKDOWN_LABELS: Record<string, string> = {
  profitFactor: 'lucro', liquidityFactor: 'liquidez',
  confidenceFactor: 'confiança', freshnessFactor: 'frescor',
};

// Ordem fixa: um objeto JSON mudar de ordem não pode reordenar a explicação do score.
export function breakdownText(breakdown: Record<string, number>): string {
  return Object.entries(BREAKDOWN_LABELS)
    .map(([key, label]) => `${label} ${pct(breakdown[key] ?? null)}`)
    .join(' · ');
}

export function verdictText(verdict: 'pass' | 'veto' | 'unavailable' | null, reasons: string[]): string {
  if (verdict === null) return 'sem auditoria';
  const label = { pass: 'passou', veto: 'veto', unavailable: 'indisponível' }[verdict];
  return reasons.length > 0 ? `${label}: ${reasons.join('; ')}` : label;
}

export function alertText(status: AlertStatus | null, reason: string | null): string {
  if (status === null) return 'sem alerta';
  const label = { pending: 'pendente', sent: 'entregue', failed: 'falhou', suppressed: 'suprimido' }[status];
  return reason ? `${label} (${reason})` : label;
}

export function healthText(row: { source: string; degraded: boolean; detail: string }): string {
  return `${row.source}: ${row.degraded ? 'degradado' : 'ok'} — ${row.detail}`;
}

export function notice(search: { error?: string | string[]; ok?: string | string[] }): { text: string; bad: boolean } | null {
  const error = Array.isArray(search.error) ? search.error[0] : search.error;
  if (error) return { text: error, bad: true };
  const ok = Array.isArray(search.ok) ? search.ok[0] : search.ok;
  return ok ? { text: 'Salvo.', bad: false } : null;
}
