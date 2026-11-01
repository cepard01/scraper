import { describe, it, expect } from 'vitest';
import { isRejected } from '../src/adapter-contract';
import type { ListingInput, PriceRejection, SourceAdapter } from '../src/adapter-contract';

const input: ListingInput = {
  source: 'olx', externalId: 'abc', url: 'https://www.olx.com.br/anuncio/abc',
  title: 'iPhone 12 128GB', description: 'sem detalhes', askingCents: 1_500_000,
  askingRaw: 'R$ 15.000,00',
  city: 'São Paulo', uf: 'SP', imageUrls: [], sellerRef: null, publishedAt: null,
};

describe('isRejected', () => {
  it('aceita um ListingInput como não rejeitado', () => {
    expect(isRejected(input)).toBe(false);
  });

  it('aceita uma rejeição como rejeitada', () => {
    const rej: PriceRejection = { rejected: true, reason: 'preço ausente', rawTitle: 'iPhone 12' };
    expect(isRejected(rej)).toBe(true);
  });

  it('exige as seis operações da interface num adapter mínimo', () => {
    const adapter: SourceAdapter = {
      id: 'olx',
      parserVersion: 'olx-1',
      health: async () => ({ ok: true }),
      search: async () => [],
      fetchOne: async () => { throw new Error('não usado'); },
      toListingInput: () => input,
    };
    expect(adapter.id).toBe('olx');
    expect(adapter.parserVersion).toBe('olx-1');
  });
});
