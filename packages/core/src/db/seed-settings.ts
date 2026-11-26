import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { settings } from './schema';
import type { Db } from './client';
import type { Category, Settings } from '../types';

const categoryRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    celular: value, notebook: value, console: value,
    bicicleta: value, autopeca: value, outro: value,
  }).strict() as unknown as z.ZodType<Record<Category, z.infer<T>>>;

const cents = z.number().int().nonnegative();
const pct = z.number().min(0);

// A tabela setting também guarda chaves namespaced de dedupe de health. Só as
// chaves conhecidas entram em Settings: um `health.*` ali não é config e não
// pode contaminar o objeto que alimenta valuation/gate/alerta.
export const SettingsSchema = z.object({
  delta: pct,
  deltaMode: z.enum(['fixed', 'measured']),
  floorMarginPct: pct,
  floorMarginCents: cents,
  metaPerDayCents: cents,
  metaDays: z.number().int().positive(),
  metaStaleDays: z.number().int().positive(),
  weights: z.object({ profit: pct, liquidity: pct, confidence: pct, freshness: pct }).strict(),
  platformFeePct: z.record(z.string(), pct),
  taxPct: pct,
  shippingInDefaultCents: categoryRecord(cents),
  shippingOutDefaultCents: categoryRecord(cents),
  repairDefaultCents: categoryRecord(cents),
  liquidityDefaults: categoryRecord(z.number().positive()),
  maxPriceCents: cents,
  digestHourLocal: z.number().int().min(0).max(23),
  lastDigestAt: z.coerce.date().nullable(),
}).strict() satisfies z.ZodType<Settings>;

export class SettingsError extends Error {
  override readonly name = 'SettingsError';
}

export const DEFAULT_SETTINGS: Settings = {
  delta: 0.85,
  deltaMode: 'fixed',
  floorMarginPct: 0.35,
  floorMarginCents: 6000,
  metaPerDayCents: 4000,
  metaDays: 14,
  metaStaleDays: 30,
  weights: { profit: 0.45, liquidity: 0.25, confidence: 0.15, freshness: 0.15 },
  platformFeePct: { meli: 0.16, olx: 0, pagofio: 0.05 },
  taxPct: 0,
  shippingInDefaultCents: { celular: 0, notebook: 0, console: 0, bicicleta: 3000, autopeca: 4000, outro: 0 },
  shippingOutDefaultCents: { celular: 2500, notebook: 3500, console: 3000, bicicleta: 6000, autopeca: 4500, outro: 3000 },
  repairDefaultCents: { celular: 2000, notebook: 3000, console: 1500, bicicleta: 5000, autopeca: 2000, outro: 1000 },
  liquidityDefaults: { celular: 10, notebook: 18, console: 12, bicicleta: 25, autopeca: 40, outro: 30 },
  maxPriceCents: 200_000_000,
  digestHourLocal: 9,
  lastDigestAt: null,
};

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

export function settingsToRows(s: Settings): { key: string; value: string }[] {
  return Object.entries(s).map(([key, value]) => ({ key, value: JSON.stringify(value) }));
}

export function seedSettings(db: Db, s: Settings): void {
  const now = new Date();
  for (const { key, value } of settingsToRows(s)) {
    db.run(sql`insert into setting (key, value, updated_at) values (${key}, ${value}, ${now.getTime()})
              on conflict(key) do nothing`);
  }
}

function parse(value: unknown): Settings {
  const result = SettingsSchema.safeParse(value);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.') || 'raiz').join(', ');
    throw new SettingsError(`settings inválidos: ${paths}`);
  }
  return result.data;
}

export function loadSettings(db: Db): Settings {
  const rows = db.select({ key: settings.key, value: settings.value }).from(settings).all();
  const found: Record<string, unknown> = {};
  for (const r of rows) {
    if (!KNOWN_KEYS.has(r.key)) continue;
    try { found[r.key] = JSON.parse(r.value); } catch { found[r.key] = r.value; }
  }
  return parse({ ...DEFAULT_SETTINGS, ...found });
}

/** Atualiza um subconjunto de settings, preservando o resto e validando o resultado. */
export function setSettings(db: Db, patch: Partial<Settings>): Settings {
  const next = parse({ ...loadSettings(db), ...patch });
  const now = new Date();
  for (const { key, value } of settingsToRows(next)) {
    db.run(sql`insert into setting (key, value, updated_at) values (${key}, ${value}, ${now.getTime()})
              on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`);
  }
  return next;
}
