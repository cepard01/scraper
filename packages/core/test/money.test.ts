import { describe, it, expect } from 'vitest';
import { parsePriceBRL, formatBRL } from '../src/money';

describe('parsePriceBRL', () => {
  it('lida com o formato padrão brasileiro', () => {
    expect(parsePriceBRL('R$ 1.234,56')).toEqual({ ok: true, cents: 123_456 });
    expect(parsePriceBRL('1.234,56')).toEqual({ ok: true, cents: 123_456 });
    expect(parsePriceBRL('R$ 980')).toEqual({ ok: true, cents: 98_000 });
    expect(parsePriceBRL('R$ 980,00')).toEqual({ ok: true, cents: 98_000 });
  });

  it('interpreta grupo final de 3 dígitos como milhar, não como decimal', () => {
    expect(parsePriceBRL('1.234')).toEqual({ ok: true, cents: 123_400 });
    expect(parsePriceBRL('1.234.567')).toEqual({ ok: true, cents: 123_456_700 });
    expect(parsePriceBRL('980.000')).toEqual({ ok: true, cents: 98_000_000 });
  });

  it('interpreta grupo final de 1 ou 2 dígitos como decimal', () => {
    expect(parsePriceBRL('980.50')).toEqual({ ok: true, cents: 98_050 });
    expect(parsePriceBRL('1,234.56')).toEqual({ ok: true, cents: 123_456 });
    expect(parsePriceBRL('99.9')).toEqual({ ok: true, cents: 9_990 });
  });

  it('trata milhar com espaço e sem separador', () => {
    expect(parsePriceBRL('R$ 1 234')).toEqual({ ok: true, cents: 123_400 });
    expect(parsePriceBRL('12345')).toEqual({ ok: true, cents: 1_234_500 });
  });

  it('rejeita o que não é preço, com motivo nomeado', () => {
    expect(parsePriceBRL('')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePriceBRL('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePriceBRL('Grátis')).toEqual({ ok: false, reason: 'gratuito' });
    expect(parsePriceBRL('grátis')).toEqual({ ok: false, reason: 'gratuito' });
    expect(parsePriceBRL('Troco por um celular')).toEqual({ ok: false, reason: 'troco' });
    expect(parsePriceBRL('A combinar')).toEqual({ ok: false, reason: 'a-combinar' });
    expect(parsePriceBRL('Sob consulta')).toEqual({ ok: false, reason: 'a-combinar' });
    expect(parsePriceBRL('R$ 0')).toEqual({ ok: false, reason: 'zero' });
    expect(parsePriceBRL('0,00')).toEqual({ ok: false, reason: 'zero' });
    expect(parsePriceBRL('sem preço')).toEqual({ ok: false, reason: 'not-a-price' });
    expect(parsePriceBRL('R$ 12,')).toEqual({ ok: false, reason: 'not-a-price' });
    expect(parsePriceBRL('-R$ 100')).toEqual({ ok: false, reason: 'negativo' });
  });

  it('rejeita acima do teto configurável', () => {
    expect(parsePriceBRL('R$ 2.500.000', { maxCents: 200_000_000 })).toEqual({ ok: false, reason: 'absurdo' });
    expect(parsePriceBRL('R$ 1.500.000', { maxCents: 200_000_000 })).toEqual({ ok: true, cents: 150_000_000 });
    expect(parsePriceBRL('R$ 150.000', { maxCents: 200_000_000 })).toEqual({ ok: true, cents: 15_000_000 });
    expect(parsePriceBRL('R$ 3.000', { maxCents: 2_000_00 })).toEqual({ ok: false, reason: 'absurdo' });
  });

  it('não deixa 3 dígitos após vírgula virarem centavos de 3 casas', () => {
    expect(parsePriceBRL('1.000,5')).toEqual({ ok: true, cents: 100_050 });
  });
});

describe('formatBRL', () => {
  it('formata centavos como moeda brasileira', () => {
    expect(formatBRL(123_456)).toBe('R$ 1.234,56');
    expect(formatBRL(98_000)).toBe('R$ 980,00');
    expect(formatBRL(-5_000)).toBe('-R$ 50,00');
  });

  it('nao devolve NBSP entre o simbolo e o numero', () => {
    expect(formatBRL(123_456)).not.toContain('\u00a0');
  });
});
