import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { fingerprints } from '../schema';
import type { Category, ParsedProduct } from '../../types';

function seg(value: string | null): string {
  if (value === null) return '?';
  const flat = value.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  return flat === '' ? '?' : flat;
}

export function fingerprintKey(p: ParsedProduct): string {
  return [p.category, p.brand, p.model, p.variant, p.grade].map(seg).join('|');
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

function selectFingerprint(db: Db, key: string) {
  return db.select({ id: fingerprints.id, key: fingerprints.key, label: fingerprints.label })
    .from(fingerprints).where(eq(fingerprints.key, key)).get() ?? null;
}

export function getOrCreateFingerprint(db: Db, p: ParsedProduct): { id: number; key: string; label: string } {
  const key = fingerprintKey(p);
  const existing = selectFingerprint(db, key);
  if (existing) return existing;
  db.insert(fingerprints)
    .values({ key, category: p.category, brand: p.brand, model: p.model, variant: p.variant, grade: p.grade, label: fingerprintLabel(p) })
    .onConflictDoNothing({ target: fingerprints.key })
    .run();
  const row = selectFingerprint(db, key);
  if (!row) throw new Error(`fingerprint ${key} não está no banco depois do insert`);
  return row;
}

export function listFingerprintIdsByCategory(db: Db, category: Category): number[] {
  return db.select({ id: fingerprints.id }).from(fingerprints).where(eq(fingerprints.category, category)).all().map((r) => r.id);
}
