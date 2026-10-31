import { sql } from 'drizzle-orm';
import type { Db } from './client';
import type { Settings } from '../types';

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
};

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
