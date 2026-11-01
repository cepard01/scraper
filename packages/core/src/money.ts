import type { Cents } from './types';

export type PriceReject =
  | 'empty' | 'not-a-price' | 'zero' | 'gratuito' | 'troco' | 'a-combinar' | 'negativo' | 'absurdo';

export type PriceResult = { ok: true; cents: Cents } | { ok: false; reason: PriceReject };

const REJECT_PREFIX: Array<[string, PriceReject]> = [
  ['gratis', 'gratuito'], ['free', 'gratuito'],
  ['troco', 'troco'], ['troca', 'troco'],
  ['a combinar', 'a-combinar'], ['combinar', 'a-combinar'], ['sob consulta', 'a-combinar'],
  ['consultar', 'a-combinar'],
];

const DEFAULT_MAX_CENTS = 200_000_000;

// "R$ 2 mil" e "1,5 mil" virariam R$ 2,00 e R$ 1,50 sem esta guarda: um erro de 1000x silencioso
const WORD_MULTIPLIER = /\b(mil|milhao|milhoes|kk)\b/;

export function parsePriceBRL(input: string, opts: { maxCents?: Cents } = {}): PriceResult {
  const max = opts.maxCents ?? DEFAULT_MAX_CENTS;
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  const lowered = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [word, reason] of REJECT_PREFIX) {
    if (lowered === word || lowered.startsWith(`${word} `)) return { ok: false, reason };
  }
  if (lowered.startsWith('-') || /\bmenos\b/.test(lowered)) return { ok: false, reason: 'negativo' };
  if (WORD_MULTIPLIER.test(lowered)) return { ok: false, reason: 'not-a-price' };

  const digitsOnly = lowered
    .replace(/\s/g, '')
    .replace(/[^\d.,]/g, '');
  if (!/[1-9]/.test(digitsOnly)) return digitsOnly ? { ok: false, reason: 'zero' } : { ok: false, reason: 'not-a-price' };

  const parsed = splitSeparators(digitsOnly);
  if (!parsed) return { ok: false, reason: 'not-a-price' };

  const cents = Math.round(parsed.integer * 100 + parsed.fracCents);
  if (cents === 0) return { ok: false, reason: 'zero' };
  if (cents > max) return { ok: false, reason: 'absurdo' };
  return { ok: true, cents };
}

function splitSeparators(s: string): { integer: number; fracCents: number } | null {
  const seps = [...s.matchAll(/[.,]/g)];
  if (seps.length === 0) return { integer: Number(s), fracCents: 0 };

  const last = seps[seps.length - 1]!;
  const tail = s.slice(last.index + 1);
  if (!/^\d+$/.test(tail)) return null;

  const intPart = s.slice(0, last.index).replace(/[^0-9]/g, '');

  if (tail.length === 3) {
    const merged = intPart + tail;
    return { integer: Number(merged.length > 0 ? merged : '0'), fracCents: 0 };
  }
  return { integer: Number(intPart.length > 0 ? intPart : '0'), fracCents: Number(tail.padEnd(2, '0').slice(0, 2)) };
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  // ICU em pt-BR separa o símbolo do valor com um espaço não-ASCII (U+00A0 hoje; CLDR já migrou locates para U+202F)
  const body = BRL.format(Math.abs(cents) / 100).replace(/[\u00a0\u2007\u202f\u2009]/g, ' ');
  return `${sign}${body}`;
}
