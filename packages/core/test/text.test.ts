import { describe, it, expect } from 'vitest';
import { normalizeCase, stripAccents, stripSymbols, cleanTitle, shingles, jaccard } from '../src/text';

describe('cleanTitle', () => {
  it('remove tokens de urgencia e emoji, preservando o produto', () => {
    expect(cleanTitle('🔥 URGENTE!! iPhone 12 128GB — Desbloqueado')).toBe('iphone 12 128gb desbloqueado');
    expect(cleanTitle('VENDO RÁPIDO, NÃO FICO ATÉ AMANHÃ Bike Caloi Elite 29')).toBe('bike caloi elite 29');
  });

  it('colapsa espacos e pontuacao', () => {
    expect(cleanTitle('Notebook   i5, 8GB/256SSD!!')).toBe('notebook i5 8gb 256ssd');
  });

  it('remove a frase de urgencia inteira, nao so a primeira palavra', () => {
    expect(cleanTitle('CORRA ANTES QUE SUMA!! iPhone 12')).toBe('iphone 12');
    expect(cleanTitle('VENDO RÁPIDO, NÃO FICO, ATÉ AMANHÃ: Bike Caloi 29')).toBe('bike caloi 29');
    expect(cleanTitle('VENDO RÁPIDO, NÃO FICO AMANHÃ Bike Caloi 29')).toBe('bike caloi 29');
  });

  it('stripSymbols troca simbolo por espaco e nao faz mais nada', () => {
    expect(stripSymbols('iPhone 12 (não liga)')).toBe('iPhone 12  não liga ');
  });

  it('nao parte palavra ao purgar urgencia', () => {
    expect(cleanTitle('CORRAM ANTES QUE SUMA!! iPhone 12')).toBe('corram antes que suma iphone 12');
    expect(cleanTitle('iphone 12 128gb urgentissimo')).toBe('iphone 12 128gb urgentissimo');
  });

  it('remove urgencia acentuada sem partir a palavra', () => {
    expect(cleanTitle('🔥 URGÊNCIA!! iPhone 12 128GB')).toBe('iphone 12 128gb');
    expect(cleanTitle('URGENCIA: note i5 8gb')).toBe('note i5 8gb');
  });

  it('normalizeCase faz NFD e minusculas', () => {
    expect(normalizeCase('Câmera PRO')).toBe('camera pro');
    expect(stripAccents('Câmera PRO')).toBe('Camera PRO'); // stripAccents só remove diacrítico: quem baixa a caixa é normalizeCase
  });
});

describe('shingles/jaccard', () => {
  it('mede similaridade de titulos parecidos', () => {
    const a = shingles(cleanTitle('iPhone 12 128gb desbloqueado preto'));
    const b = shingles(cleanTitle('iphone 12 128gb desbloqueado'));
    expect(jaccard(a, b)).toBeGreaterThan(0.5);
    const c = shingles(cleanTitle('geladeira brastemp 340 litros'));
    expect(jaccard(a, c)).toBeLessThan(0.1);
  });

  it('titulo curto e comparado inteiro', () => {
    expect(shingles('iphone 12')).toEqual(new Set(['iphone 12']));
    expect(jaccard(shingles('iphone 12'), shingles('iphone 12 preto'))).toBe(0);
  });
});
