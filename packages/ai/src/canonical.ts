import { createHash } from 'node:crypto';
import type { AiTask } from '@brique/core/types';

/** Serialização estável: ordem de chaves de JSON não pode virar cobrança duplicada. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function cacheKey(task: AiTask, combo: string, input: unknown): string {
  return createHash('sha256').update(`${task}|${combo}|${canonicalJson(input)}`).digest('hex');
}
