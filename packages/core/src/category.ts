import type { Category } from './types';
import { normalizeCase, stripSymbols, wordRe } from './text';

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
      'starter', 'cambio', 'embreagem', 'disco de freio', 'pastilha', 'sensor de abs', 'sensor abs',
      'sensor de temperatura', 'sensor de rotação', 'amortecedor', 'mola', 'bomba', 'injetor',
      'motor ', 'cabeçote', 'turbina', 'paralampa', 'porta ', 'capô', 'capot', 'grade dianteira', 'bieleta', 'banda',
      'correia dentada', 'correia de distribuição', 'correia distribuição', 'kit distribuição',
      'tensor de correia', 'tensor correia', 'junta homocinética', 'pivô de suspensão', 'pivo suspensao',
      'barra estabilizadora', 'coxim do motor', 'coxim motor',
      'bomba dágua', 'bomba dagua', 'bomba de água', 'bomba de gasolina', 'bomba gasolina',
      'farol de milha', 'escapamento', 'silenciador', 'catalisador', 'maçaneta', 'fechadura',
      'vidro para-brisa', 'para-brisa', 'bateria de carro', 'vela de ignição', 'vela ignição',
      'termostato', 'eletroventilador', 'rolamento de roda', 'cubo de roda', 'pinça de freio',
      'airbag', 'reservatório de água', 'kit freio', 'diferencial'],
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
  let bestAt = Number.POSITIVE_INFINITY;
  for (const [category, rule] of Object.entries(CATEGORY_RULES) as Array<[Category, Rule]>) {
    if (category === 'outro') continue;
    const hits = rule.include.filter((x) => boundedIndex(text, x) >= 0).length;
    if (hits === 0) continue;
    const includeAt = firstMatch(text, rule.include);
    const excludeAt = firstMatch(text, rule.exclude);
    if (excludeAt >= 0 && excludeAt < includeAt) continue;
    const score = rule.weight + hits;
    // Empate de peso (celular e notebook valem 30): o termo que aparece primeiro
    // no título identifica melhor o produto do que a ordem de inserção das regras.
    if (score > bestScore || (score === bestScore && includeAt < bestAt)) {
      bestScore = score; best = category; bestAt = includeAt;
    }
  }
  return best;
}

function firstMatch(text: string, words: string[]): number {
  let idx = -1;
  for (const w of words) {
    const i = boundedIndex(text, w);
    if (i >= 0 && (idx === -1 || i < idx)) idx = i;
  }
  return idx;
}

function boundedIndex(text: string, word: string): number {
  const at = wordRe(word).exec(text);
  return at ? at.index : -1;
}

export function matchBrand(text: string, category: Category): string | null {
  const t = ` ${stripSymbols(normalizeCase(text))} `;
  for (const def of BRANDS_BY_CATEGORY[category] ?? []) {
    if (def.aliases.some((a) => wordRe(a).test(t))) return def.canonical;
  }
  return null;
}
