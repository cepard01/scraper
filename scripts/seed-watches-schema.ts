import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { classifyCategory } from '../packages/core/src/category';
import type { MonitorParams } from '../packages/core/src/types';

// Formato de IMPORTAÇÃO, não config de runtime. O worker continua lendo só .env
// e banco; este schema existe para converter o watches.yaml validado do
// Scrapelytics em linhas de search_monitor.

export const filtersSchema = z.object({
  minPrice: z.number().int().nonnegative().default(0),
  maxPrice: z.number().int().positive().optional(),
  blacklist: z.array(z.string()).default([]),
  requireWords: z.array(z.string()).default([]),
  requireImage: z.boolean().default(true),
  ignoreProfessional: z.boolean().default(false),
});

export const dealSchema = z.object({
  belowMedianPct: z.number().min(1).max(95).default(35),
  minSamples: z.number().int().min(1).default(15),
});

export const watchSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id do watch deve ser slug (a-z, 0-9, -)'),
  query: z.string().trim().min(1),
  state: z.string().regex(/^[a-z]{2}$/, 'state deve ser a UF em minúsculas (ex: rj)'),
  filters: filtersSchema.prefault({}),
  deal: dealSchema.prefault({}),
});

export const settingsSchema = z.object({
  pollIntervalMin: z.number().int().min(1).max(60).default(3),
  maxPages: z.number().int().min(1).max(6).default(2),
  pageDelayMs: z.number().int().min(500).max(10_000).default(1500),
});

export const watchesYamlSchema = z.object({
  settings: settingsSchema.prefault({}),
  watches: z.array(watchSchema).min(1, 'defina ao menos um watch'),
});

export type WatchYaml = z.infer<typeof watchSchema>;
export type WatchesYaml = z.infer<typeof watchesYamlSchema>;

export function parseWatchesYaml(text: string): WatchesYaml {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new Error(`não foi possível ler watches.yaml: ${(err as Error).message}`);
  }
  const parsed = watchesYamlSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `- ${i.path.join('.') || '<raiz>'}: ${i.message}`).join('\n');
    throw new Error(`watches.yaml inválido:\n${issues}`);
  }
  return parsed.data;
}

export interface MonitorSeed {
  label: string;
  source: 'olx';
  query: string;
  category: ReturnType<typeof classifyCategory>;
  params: MonitorParams;
  intervalMinutes: number;
}

export function toMonitorSeed(watch: WatchYaml, settings: WatchesYaml['settings']): MonitorSeed {
  const params: MonitorParams = {
    uf: watch.state.toUpperCase(),
    pages: settings.maxPages,
    pageDelayMs: settings.pageDelayMs,
    extraQuery: 'sf=1',
    requireWords: watch.filters.requireWords,
    belowMedianPct: watch.deal.belowMedianPct,
    minSamples: watch.deal.minSamples,
  };
  if (watch.filters.minPrice > 0) params.minCents = watch.filters.minPrice * 100;
  if (watch.filters.maxPrice != null) {
    params.maxCents = watch.filters.maxPrice * 100;
    // Cold start: teto manual do watch enquanto a amostra própria não existe.
    params.manualCeilingCents = watch.filters.maxPrice * 100;
  }
  return {
    label: watch.id,
    source: 'olx',
    query: watch.query,
    category: classifyCategory(watch.query, ''),
    params,
    // Política persistida do Brique: cadência mínima de 15 min, mesmo que o
    // arquivo importado peça 3. O valor do YAML é transportado como intenção.
    intervalMinutes: Math.max(15, settings.pollIntervalMin),
  };
}
