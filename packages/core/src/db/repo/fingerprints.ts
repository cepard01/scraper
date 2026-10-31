import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { fingerprints } from '../schema';
import type { ParsedProduct } from '../../types';

export function fingerprintKey(p: ParsedProduct): string {
  return [p.category, p.brand ?? '?', p.model ?? '?', p.variant ?? '?', p.grade].join('|');
}

const ACRONYMS: Record<string, string> = {
  iphone: 'iPhone', ipad: 'iPad', ipod: 'iPod', imac: 'iMac',
  ps3: 'PS3', ps4: 'PS4', ps5: 'PS5', xbox: 'Xbox', nintendo: 'Nintendo',
  tv: 'TV', led: 'LED', lcd: 'LCD', oled: 'OLED', amoled: 'AMOLED',
  mtb: 'MTB', aro: 'Aro', gta: 'GTA', fifa: 'FIFA',
};

function labelToken(token: string): string {
  const lower = token.toLowerCase();
  const acronym = ACRONYMS[lower];
  if (acronym) return acronym;
  const unit = /^(\d+)(gb|tb|mb)$/.exec(lower);
  if (unit?.[1] && unit[2]) return unit[1] + unit[2].toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function fingerprintLabel(p: ParsedProduct): string {
  const tokens = `${p.model ?? p.category} ${p.variant ?? ''}`
    .split(/[\s-]+/)
    .map(labelToken)
    .filter((t) => t.length > 0);
  return `${tokens.join(' ')} (${p.grade})`;
}

export function getOrCreateFingerprint(db: Db, p: ParsedProduct): { id: number; key: string; label: string } {
  const key = fingerprintKey(p);
  const existing = db.select().from(fingerprints).where(eq(fingerprints.key, key)).get();
  if (existing) return { id: existing.id, key: existing.key, label: existing.label };
  return db.insert(fingerprints)
    .values({ key, category: p.category, brand: p.brand, model: p.model, variant: p.variant, grade: p.grade, label: fingerprintLabel(p) })
    .returning({ id: fingerprints.id, key: fingerprints.key, label: fingerprints.label })
    .get();
}
