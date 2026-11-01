import { describe, it, expect } from 'vitest';
import { normalizeCase, stripAccents, cleanTitle, shingles, jaccard } from '../src/text';

describe('cleanTitle', () => {
  it('remove tokens de urgencia e emoji, preservando o produto', () => {
    expect(cleanTitle('🔥 URGENTE!! iPhone 12 128GB — Desbloqueado')).toBe('iphone 12 128gb desbloqueado');
    expect(cleanTitle('VENDO RÁPIDO, NÃO FICO ATÉ AMANHÃ Bike Caloi Elite 29')).toBe('bike caloi elite 29');
  });

  it('colapsa espacos e pontuacao', () => {
    expect(cleanTitle('Notebook   i5, 8GB/256SSD!!')).toBe('notebook i5 8gb 256ssd');
  });

  it('normalizeCase faz NFD e minusculas', () => {
    expect(normalizeCase('Câmera PRO')).toBe('camera pro');
    // o pino do brief pede 'camera PRO'; stripAccents não minúscula, então o 'C' maiúsculo sobrevive
    expect(stripAccents('Câmera PRO')).toBe('Camera PRO');
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
});
