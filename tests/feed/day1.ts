import type { ListingInput } from '@brique/core/types';

const li = (source: 'olx' | 'meli', id: string, title: string, description: string, ask: number, city: string | null, uf: string | null): ListingInput => ({
  source, externalId: id, url: `https://exemplo.invalid/${source}/${id}`, title, description,
  askingCents: ask, askingRaw: String(ask), city, uf, imageUrls: [], sellerRef: null, publishedAt: null,
});

export const DAY1: ListingInput[] = [
  // iPhone 12 128GB desbloqueado: 10 comparáveis; mediana aparada R$ 2.010,00 (fair = 1.708,50)
  ...Array.from({ length: 10 }, (_, i) => li('olx', `ip12-cmp-${i}`, 'iPhone 12 128GB Desbloqueado', 'usado, pouco uso', 165_000 + i * 8_000, 'Curitiba', 'PR')),
  // Galaxy A54 128GB desbloqueado: 6 comparáveis; n<7 não apara por percentil, mediana R$ 955,00 (fair = 811,75)
  ...Array.from({ length: 6 }, (_, i) => li('olx', `a54-cmp-${i}`, 'Samsung Galaxy A54 128GB Desbloqueado', 'usado conservado', 88_000 + i * 3_000, 'São Paulo', 'SP')),
  // Caloi Elite 29 aro 29: 5 comparáveis; mediana R$ 2.600,00 (fair = 2.210,00)
  ...Array.from({ length: 5 }, (_, i) => li('olx', `caloi-cmp-${i}`, 'Bike Caloi Elite 29 Aro 29 Shimano Deore', 'usada, revisada', 230_000 + i * 15_000, 'Campinas', 'SP')),

  // os 5 finalistas de teste
  li('olx', 'DEAL-A', 'iPhone 12 128GB Desbloqueado', 'urgente, pouco uso, bateria 90%', 98_000, 'Curitiba', 'PR'),
  li('meli', 'DEAL-B', 'iPhone 12 128GB Desbloqueado Usado', 'condicao:used sold_quantity:12', 105_000, null, null),
  li('olx', 'DEAL-C', 'Samsung Galaxy A54 128GB Desbloqueado', 'seminovo nota 10', 45_000, 'São Paulo', 'SP'),
  li('olx', 'DEAL-D', 'Bike Caloi Elite 29 Aro 29', 'quadro sem marcas', 90_000, 'Campinas', 'SP'),
  li('meli', 'DEAL-E', 'iPhone 11 64GB só na Claro', 'bloqueado claro, funciona normal', 40_000, null, null),

  // ruido esperado
  li('olx', 'NOISE-1', 'Capinha para iPhone 12', 'silicone', 2_500, 'Curitiba', 'PR'),
  li('olx', 'NOISE-2', 'Cortador de grama Tramontina', 'novo', 30_000, 'Curitiba', 'PR'),
];
