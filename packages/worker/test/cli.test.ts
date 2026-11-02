import { describe, it, expect } from 'vitest';
import { printShortlist } from '../src/cli';
import type { RankedRow } from '@brique/core/db/repo/opportunities';

// R102: printShortlist era só impressa no E2E, nunca observada (bateria16: C1 e C2 VIVEU).
const row = (over: Partial<RankedRow> = {}): RankedRow => ({
  listingId: 1, externalId: 'DEAL-A', source: 'olx', title: 'iPhone 12 128GB Desbloqueado',
  url: 'https://x/1', city: 'Curitiba', askingCents: 98_000, fairGrossCents: 170_850,
  marginCents: 42_014, marginPct: 0.424, expectedPerDayCents: 4_201, liquidityDays: 10,
  score: 0.774, breakdown: { profitFactor: 1, liquidityFactor: 1, confidenceFactor: 1, freshnessFactor: 1 },
  sampleSize: 8, confidence: 'high', ...over,
});

const semValuation = row({
  listingId: 2, externalId: 'NOVO-1', title: 'Notebook que ainda nao tem comparaveis na base',
  fairGrossCents: null, marginCents: null, marginPct: null, expectedPerDayCents: null,
  sampleSize: 0, confidence: 'none', city: null,
});

describe('printShortlist', () => {
  it('sem finalista a frase diz isso, em vez de imprimir um cabecalho sobre nada', () => {
    expect(printShortlist([])).toBe('sem finalistas: nenhum anuncio cruzou o floor de margem nesta passada.');
  });

  it('congela a tabela inteira, incluidas as colunas sem valorem', () => {
    expect(printShortlist([row(), semValuation])).toMatchSnapshot();
  });

  it('score sai com duas casas, porque e ordenacao e nao grandeza', () => {
    expect(printShortlist([row()]).split('\n')[2]!.startsWith('0.77')).toBe(true);
  });

  it('valuation ausente vira traço nas tres colunas de dinheiro e na cidade', () => {
    const celula = '-' + ' '.repeat(11);
    const out = printShortlist([semValuation]);
    expect(out).toContain(celula + celula);
    expect(out.trimEnd().endsWith('-')).toBe(true);
  });

  it('titulo longo e truncado com reticencias, sem estourar a coluna', () => {
    const out = printShortlist([row({ title: 'X'.repeat(60) })]);
    const linha = out.split('\n')[2]!;
    expect(out).toContain('…');
    expect(linha.slice(6, 46)).toBe('X'.repeat(39) + '…');
  });
});
