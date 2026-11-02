import { describe, it, expect } from 'vitest';
import { findDupe, samePriceWindow } from '../src/dedupe';

const candidates = [
  { listingId: 1, title: 'iPhone 12 128GB Desbloqueado ótimo estado', askingCents: 98_000 },
  { listingId: 2, title: 'Geladeira Brastemp 340 litros frost free', askingCents: 1_890_000 },
];

describe('findDupe', () => {
  it('acha o mesmo item escrito de forma levemente diferente', () => {
    const id = findDupe(candidates, { title: 'IPHONE 12 128GB desbloqueado, otimo estado!!', askingCents: 98_000 });
    expect(id).toBe(1);
  });

  it('não acha dupe quando o preço difere mais que a tolerância', () => {
    const id = findDupe(candidates, { title: 'iPhone 12 128GB Desbloqueado otimo estado', askingCents: 80_000 });
    expect(id).toBeNull();
  });

  it('escolhe o candidato mais parecido, não o primeiro que passa', () => {
    const dois = [
      { listingId: 10, title: 'iPhone 12 128GB Desbloqueado otimo estado novo', askingCents: 97_000 },
      { listingId: 11, title: 'iPhone 12 128GB Desbloqueado otimo estado', askingCents: 98_000 },
    ];
    const id = findDupe(dois, { title: 'IPHONE 12 128GB desbloqueado, otimo estado!!', askingCents: 98_000 });
    expect(id).toBe(11);
  });

  it('o limiar mora entre 0.33 e 0.60: 0.60 ainda é dupe, 0.33 já não é', () => {
    const alvo = { title: 'IPHONE 12 128GB desbloqueado, otimo estado!!', askingCents: 98_000 };
    const acima = [{ listingId: 20, title: 'iPhone 12 128GB Desbloqueado otimo novo', askingCents: 98_000 }];
    const abaixo = [{ listingId: 21, title: 'iPhone 12 128GB Desbloqueado sem nota', askingCents: 98_000 }];
    expect(findDupe(acima, alvo)).toBe(20);
    expect(findDupe(abaixo, alvo)).toBeNull();
  });

  it('LIMITACAO conhecida: título reordenado não é dupe, o shingle é de palavras em ordem', () => {
    const id = findDupe(
      [{ listingId: 2, title: 'Geladeira Brastemp 340 litros frost free', askingCents: 1_890_000 }],
      { title: 'Geladeira Brastemp Frost Free 340 Litros', askingCents: 1_890_000 },
    );
    expect(id).toBeNull();
  });
});

describe('samePriceWindow', () => {
  it('5% para cima e para baixo', () => {
    expect(samePriceWindow(100_000, 104_000)).toBe(true);
    expect(samePriceWindow(100_000, 96_000)).toBe(true);
    expect(samePriceWindow(100_000, 106_000)).toBe(false);
  });

  it('a tolerância é relativa ao preço MAIOR: 105.263 está dentro, 105.264 não', () => {
    expect(samePriceWindow(100_000, 105_263)).toBe(true);
    expect(samePriceWindow(100_000, 105_264)).toBe(false);
    expect(samePriceWindow(99_750, 105_000)).toBe(true);
  });

  it('preço zero ou negativo não abre janela, e o guard não é decoração', () => {
    expect(samePriceWindow(0, 0)).toBe(false);
    expect(samePriceWindow(-100_000, -100_000)).toBe(false);
  });
});
