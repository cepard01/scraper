import { z } from 'zod';
import type { TriageVerdict } from '@brique/core/ai-port';

const VerdictSchema = z.object({
  verdicts: z.array(z.object({
    listingId: z.number().int(),
    verdict: z.enum(['pass', 'veto', 'unavailable']),
    reasons: z.array(z.string()).default([]),
  })),
});

export type ParseLevel = 'schema' | 'repair' | 'regex' | 'unparsed';

export interface ParsedVerdicts {
  level: ParseLevel;
  verdicts: Map<number, TriageVerdict>;
}

function jsonCandidate(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try { return JSON.parse(trimmed); } catch { /* modelos gratuitos cercam JSON de prosa */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1]); } catch { /* segue para os delimitadores */ }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* regex abaixo */ }
  }
  return null;
}

function normalize(parsed: z.infer<typeof VerdictSchema>, expected: number[]): Map<number, TriageVerdict> {
  const out = new Map<number, TriageVerdict>();
  for (const id of expected) out.set(id, { verdict: 'unavailable', reasons: [] });
  for (const v of parsed.verdicts) {
    if (!out.has(v.listingId)) continue;
    out.set(v.listingId, { verdict: v.verdict, reasons: v.reasons });
  }
  return out;
}

export function parseVerdicts(text: string, expected: number[]): ParsedVerdicts | null {
  const result = VerdictSchema.safeParse(jsonCandidate(text));
  return result.success
    ? { level: 'schema', verdicts: normalize(result.data, expected) }
    : null;
}

// Último degrau antes de declarar "sem opinião": um objeto por anúncio, mesmo
// que o array inteiro venha quebrado. Item não reconhecido fica unavailable.
export function regexVerdicts(text: string, expected: number[]): ParsedVerdicts | null {
  const out = normalize({ verdicts: [] }, expected);
  const objects = text.match(/\{[^{}]*\}/g) ?? [];
  let found = 0;
  for (const chunk of objects) {
    // Chaves vêm entre aspas num JSON quase válido; o degrau de regex precisa ler
    // esse objeto também, não só o formato `{listingId: 2, verdict: "veto"}`.
    const id = /["']?(?:listingId|listing_id)["']?\s*:\s*(\d+)/.exec(chunk)?.[1];
    const verdict = /["']?verdict["']?\s*:\s*["']?(pass|veto|unavailable)/.exec(chunk)?.[1];
    if (!id || !verdict || !out.has(Number(id))) continue;
    const reasons = /\[([^\]]*)\]/.exec(chunk)?.[1]
      ?.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter((s) => s.length > 0) ?? [];
    out.set(Number(id), { verdict: verdict as TriageVerdict['verdict'], reasons });
    found++;
  }
  return found > 0 ? { level: 'regex', verdicts: out } : null;
}

export const REPAIR_INSTRUCTION = 'O JSON anterior é inválido. Devolva somente o JSON corrigido, sem comentários, no formato {"verdicts":[{"listingId":n,"verdict":"pass|veto|unavailable","reasons":["..."]}]}. Texto recebido:';
