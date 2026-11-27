import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AiTask } from '@brique/core/types';

const ComboSchema = z.object({
  name: z.string().min(1),
  strategy: z.enum(['priority', 'round-robin']),
  model: z.string().min(1),
  description: z.string(),
});

const CombosSchema = z.object({
  version: z.number().int().positive(),
  combos: z.object({
    'triage.batch': ComboSchema,
    'normalize.product': ComboSchema,
    'audit.vision': ComboSchema,
    'negotiate.chat': ComboSchema,
  }),
}).strict();

export interface Combo extends z.infer<typeof ComboSchema> {}

export type Combos = Record<AiTask, Combo>;

/** Arquivo único: o mesmo JSON é enviado pelo `omniroute:setup` e usado no request. */
export function loadCombos(path = new URL('../../../config/omniroute.combos.json', import.meta.url)): Combos {
  const parsed = CombosSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`combos OmniRoute inválidos: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  return parsed.data.combos as Combos;
}
