import type { Category } from './types';
import { normalizeCase, stripSymbols } from './text';

interface Rule { include: string[]; exclude: string[]; weight: number }

const RAW_RULES: Record<Category, Rule> = {
  celular: {
    include: ['celular', 'smartphone', 'iphone', 'galaxy', 'xiaomi', 'redmi', 'poco', 'motorola', 'moto g', 'asus zenfone', 'realme', 'nokia', 'lg k', 'oneplus'],
    exclude: ['capinha', 'capa para', 'pelicula', 'protetor', 'bateria para', 'carregador', 'suporte', 'fone', 'smartwatch', 'relojio', 'copiado', 'troco por'],
    weight: 30,
  },
  notebook: {
    include: ['notebook', 'laptop', 'macbook', 'ultrabook', 'chromebook', 'portatil'],
    exclude: ['mochila', 'capa', 'carregador', 'tela', 'ssd', 'memoria ram', 'hd ', 'gabinete', 'dock'],
    weight: 30,
  },
  console: {
    include: ['playstation', 'ps4', 'ps5', 'xbox', 'nintendo switch', 'switch', 'video game', 'videogame', 'console'],
    exclude: ['jogo', 'controle', 'joystick', 'volante', 'carregador', 'capinha', 'headset', 'base de carregamento'],
    weight: 28,
  },
  bicicleta: {
    include: ['bicicleta', 'bike', 'mountain bike', 'mtb', 'caloi', 'specialized', 'trek', 'gt aro', 'aro 29', 'aro 26', 'ebike', 'speed'],
    exclude: ['bicicleta ergometrica', 'peca bicicleta', 'capa de selim', 'aro de bicicleta avulso'],
    weight: 26,
  },
  autopeca: {
    include: ['peca', 'para-choque', 'farol', 'lanterna', 'retrovisor', 'radiador', 'alternador',
      'starter', 'cambio', 'embreagem', 'disco de freio', 'pastilha', 'amortecedor', 'mola', 'bomba', 'injetor',
      'motor ', 'cabeçote', 'turbina', 'paralampa', 'porta ', 'capô', 'capot', 'grade dianteira', 'bieleta', 'banda'],
    exclude: ['carro completo', 'vendo carro', 'vehicle', 'pneu de carro', 'ipva', 'documentação'],
    weight: 20,
  },
  outro: { include: [], exclude: [], weight: 0 },
};

export interface BrandDef { canonical: string; aliases: string[] }

const RAW_BRANDS: Record<Category, BrandDef[]> = {
  celular: [
    { canonical: 'apple', aliases: ['iphone', 'apple'] },
    { canonical: 'samsung', aliases: ['galaxy', 'samsung', 's21', 's22', 's23', 'a13', 'a34', 'a54'] },
    { canonical: 'xiaomi', aliases: ['xiaomi', 'redmi', 'poco', 'mi '] },
    { canonical: 'motorola', aliases: ['motorola', 'moto g', 'moto e', 'edge'] },
    { canonical: 'asus', aliases: ['asus', 'zenfone', 'rog phone'] },
    { canonical: 'realme', aliases: ['realme'] },
    { canonical: 'nokia', aliases: ['nokia'] },
    { canonical: 'lg', aliases: ['lg '] },
    { canonical: 'oneplus', aliases: ['oneplus'] },
    { canonical: 'huawei', aliases: ['huawei', 'honor'] },
  ],
  notebook: [
    { canonical: 'dell', aliases: ['dell', 'inspiron', 'latitude', 'alienware'] },
    { canonical: 'lenovo', aliases: ['lenovo', 'thinkpad', 'ideapad'] },
    { canonical: 'apple', aliases: ['macbook', 'imac', 'apple'] },
    { canonical: 'asus', aliases: ['asus', 'vivobook', 'rog'] },
    { canonical: 'acer', aliases: ['acer', 'aspire', 'nitro'] },
  ],
  console: [
    { canonical: 'sony', aliases: ['playstation', 'ps4', 'ps5'] },
    { canonical: 'microsoft', aliases: ['xbox'] },
    { canonical: 'nintendo', aliases: ['nintendo', 'switch'] },
  ],
  bicicleta: [
    { canonical: 'caloi', aliases: ['caloi'] },
    { canonical: 'specialized', aliases: ['specialized'] },
    { canonical: 'trek', aliases: ['trek'] },
    { canonical: 'gt', aliases: ['gt '] },
    { canonical: 'oyama', aliases: ['oyama'] },
    { canonical: 'avm', aliases: ['avm'] },
    { canonical: 'kempp', aliases: ['kempp'] },
    { canonical: 'scott', aliases: ['scott'] },
  ],
  autopeca: [
    { canonical: 'bosch', aliases: ['bosch'] },
    { canonical: 'valeo', aliases: ['valeo'] },
    { canonical: 'gm', aliases: ['gm', 'chevrolet', 'gol', 'corsa', 'onix'] },
    { canonical: 'fiat', aliases: ['fiat', 'uno', 'palio', 'argo', 'strada'] },
    { canonical: 'vw', aliases: ['volkswagen', 'vw', 'voyage', 'saveiro'] },
    { canonical: 'toyota', aliases: ['toyota', 'corolla', 'hilux'] },
    { canonical: 'honda', aliases: ['honda', 'civic', 'fit', 'cg 160', 'cg160'] },
  ],
  outro: [],
};

const needle = (w: string): string => stripSymbols(normalizeCase(w));

export const CATEGORY_RULES: Record<Category, Rule> = Object.fromEntries(
  Object.entries(RAW_RULES).map(([c, r]) => [
    c,
    { include: r.include.map(needle), exclude: r.exclude.map(needle), weight: r.weight },
  ]),
) as Record<Category, Rule>;

export const BRANDS_BY_CATEGORY: Record<Category, BrandDef[]> = Object.fromEntries(
  Object.entries(RAW_BRANDS).map(([c, defs]) => [
    c,
    defs.map((d) => ({ canonical: d.canonical, aliases: d.aliases.map(needle) })),
  ]),
) as Record<Category, BrandDef[]>;

export function classifyCategory(title: string, description: string): Category {
  const text = `${stripSymbols(normalizeCase(title))} ${stripSymbols(normalizeCase(description))}`;
  let best: Category = 'outro';
  let bestScore = 0;
  for (const [category, rule] of Object.entries(CATEGORY_RULES) as Array<[Category, Rule]>) {
    if (category === 'outro') continue;
    const hits = rule.include.filter((x) => text.includes(x)).length;
    if (hits === 0) continue;
    const includeAt = firstMatch(text, rule.include);
    const excludeAt = firstMatch(text, rule.exclude);
    if (excludeAt >= 0 && excludeAt < includeAt) continue;
    const score = rule.weight + hits;
    if (score > bestScore) { bestScore = score; best = category; }
  }
  return best;
}

function firstMatch(text: string, words: string[]): number {
  let idx = -1;
  for (const w of words) {
    const i = text.indexOf(w);
    if (i >= 0 && (idx === -1 || i < idx)) idx = i;
  }
  return idx;
}

export function matchBrand(text: string, category: Category): string | null {
  const t = ` ${stripSymbols(normalizeCase(text))} `;
  for (const def of BRANDS_BY_CATEGORY[category] ?? []) {
    if (def.aliases.some((a) => t.includes(a))) return def.canonical;
  }
  return null;
}
