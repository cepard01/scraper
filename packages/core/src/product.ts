import type { Category, ParsedProduct } from './types';
import { cleanTitle, normalizeCase } from './text';
import { CATEGORY_RULES, classifyCategory, matchBrand } from './category';
import { detectGrade } from './grade';

const CARRIERS = ['claro', 'vivo', 'tim', 'oi', 'next', 'sercomtel'] as const;

const CELULAR_HEADS = 'iphone|ipod|motorola|moto|edge|galaxy|redmi|poco|xiaomi|zenfone|realme|nokia|oneplus|huawei|honor|asus|lg';
const NOTEBOOK_HEADS = 'macbook|aspire|nitro|inspiron|latitude|vostro|thinkpad|ideapad|legion|vivobook|chromebook|alienware|matebook|extensa';
const CONSOLE_HEADS = 'xbox|nintendo|switch';
const BIKE_HEADS = 'elite|snowland|hardrock|marlin|chameleon|rockhopper|turbo|carbon|slack|trail|rusher|storm|x11|a1|s1|mountain';
const AUTO_LINE = 'gol|corsa|onix|celta|uno|palio|argo|strada|sipos|saveiro|voyage|spacefox|corolla|civic|fit|city|hilux|hylux|s10|ranger|cg 160|cg160|fan|biz|factor|twister|gls|flex';

// R58: `[mx]\d` (Apple silicon) é para-para a corrida só em notebook; em celular era engolido
// o modelo inteiro (`Poco X5 Pro`). As fronteiras i3/i5/i7/i9, core i… e ryzen continuam globais.
const CPU_WORDS = '(?:i[3579]|core[\\s-]*[i3579]|ryzen[\\s-]*[357])';
const CHIP_WORDS = '(?:[mx]\\d)';
const CPU_RE = new RegExp('(?<![\\p{L}\\p{N}])(' + CPU_WORDS + ')(?![\\p{L}\\p{N}])', 'u');
const NOTEBOOK_CPU_RE = new RegExp('(?<![\\p{L}\\p{N}])(' + CPU_WORDS + '|' + CHIP_WORDS + ')(?![\\p{L}\\p{N}])', 'u');
const ARO_SIZES = '24|26|27|29';
// R53: `[45]g` continua na lista de parada (não entra no modelo); a variante o captura à parte.
// R59: os plurais entram como parada — adjetivo de condição não é identidade.
const NOISE = 'gb|ssd|hdd|tb|ram|[45]g|lte|aro|' + ARO_SIZES +
  '|usado|usada|novo|nova|lacrado|lacrada|lacrados|lacradas|com|sem|de|do|da|para|no|na|e|preto|preta|branco|branca|prata|dourado|cinza|azul|roxo|verde|original|completo|completa|estado|nota|ano|un|bike|bicicleta|muleta|quadro';
const STOP_TOKEN = new RegExp('^(?:\\d{1,4}(?:gb|ssd|hdd|tb|ram)|' + NOISE + ')$');
const NETWORK_RE = /(?<![\p{L}\p{N}])([45]g)(?![\p{L}\p{N}])/u;
const LACRADO_RE = /\blacrad[ao]s?\b/;

function view(text: string): string {
  // R52: só o `+` adjacente a dígito é sufixo de modelo (`S24+`). `14 + 128GB` é pacote:
  // sem `\s*` no regex, o sinal separado vira símbolo e `cleanTitle` o apaga — destino correto.
  const spelled = text.replace(/(\p{N})\+(?![\p{L}\p{N}])/gu, '$1 plus');
  return ` ${cleanTitle(spelled).replace(/(\d)[\s]+(gb|ssd|hdd|tb|ram)/g, '$1$2')} `;
}

function modelRun(
  t: string,
  from: number,
  max: number,
  headTokRe: RegExp,
  alphaOnly: boolean,
  stopRe: RegExp,
): string[] {
  const out: string[] = [];
  let used = 0;
  for (const w of t.slice(from).split(' ')) {
    if (!w) continue;
    // R54: cabeça de lista dentro da corrida é prefixo de marca, não discriminador:
    // entra no modelo mas não consome orçamento (`Xiaomi Redmi Note 13 Pro`).
    const free = headTokRe.test(w);
    if (!free && used >= max) break;
    if (STOP_TOKEN.test(w)) break;
    if (stopRe.test(w)) break;
    if (alphaOnly && /^\d+$/.test(w)) break;
    out.push(w);
    if (!free) used++;
  }
  return out;
}

function headModel(
  t: string,
  heads: string,
  max: number,
  alphaOnly = false,
  requireTail = false,
  stopRe: RegExp | null = null,
): string | null {
  const m = t.match(new RegExp('(?<![\\p{L}\\p{N}])(?:' + heads + ')(?![\\p{L}\\p{N}])', 'u'));
  if (!m || m.index === undefined || !m[0]) return null;
  const rest = modelRun(t, m.index + m[0].length, max, new RegExp('^(?:' + heads + ')$'), alphaOnly, stopRe ?? CPU_RE);
  if (requireTail && rest.length === 0) return null;
  return [normalizeCase(m[0]), ...rest].join(' ').replace(/\s+/g, ' ').trim();
}

function capacityTokens(t: string): Array<{ n: number; unit: string }> {
  const re = /(?<![\p{L}\p{N}])(\d{1,4})\s?(gb|ssd|hdd|tb)(?![\p{L}\p{N}])/gu;
  const out: Array<{ n: number; unit: string }> = [];
  for (const m of t.matchAll(re)) {
    if (m[1] && m[2]) out.push({ n: Number(m[1]), unit: m[2] });
  }
  return out;
}

function storageSlug(t: string): string | null {
  let best: { n: number; unit: string } | null = null;
  for (const c of capacityTokens(t)) if (!best || c.n > best.n) best = c;
  return best ? `${best.n}${best.unit}` : null;
}

const AUTO_PARTS = CATEGORY_RULES.autopeca.include
  .filter((w) => w !== 'peca')
  .map((w) => w.trim())
  .sort((a, b) => b.length - a.length);

// R55: uma única alternância ancorada em fronteira de palavra; `porta` não casa mais dentro de `importado`.
const AUTO_PART_RE = new RegExp('(?<![\\p{L}\\p{N}])(?:' + AUTO_PARTS.join('|') + ')(?![\\p{L}\\p{N}])', 'u');

function autoPartSlug(t: string): string | null {
  const part = t.match(AUTO_PART_RE)?.[0];
  if (!part) return null;
  const gen = t.match(/(?<![\p{L}\p{N}])g(\d)(?![\p{L}\p{N}])/u)?.[0] ?? '';
  return part.replace(/\s+/g, '') + gen;
}

// R53: componente de rede do celular — presente só quando o anúncio o declara;
// inferir um default juntaria produtos (`Note 12 4G` ≠ `Note 12 5G`).
function networkSlug(t: string): string | null {
  return t.match(NETWORK_RE)?.[1] ?? null;
}

function lockSlug(t: string): string | null {
  if (/\bdesbloquead\w*\b/.test(t)) return 'desbloqueado';
  const carrier = CARRIERS.find((c) => new RegExp('(?<![\\p{L}\\p{N}])' + c + '(?![\\p{L}\\p{N}])', 'u').test(t));
  if (carrier) return carrier;
  if (/\bbloquead\w*\b/.test(t)) return 'bloqueado';
  return null;
}

function notebookSeriesSlug(t: string): string | null {
  const s = t.match(
    new RegExp('(?<![\\p{L}\\p{N}])(?:' + NOTEBOOK_HEADS + ')(?![\\p{L}\\p{N}])[\\s]+(\\d{1,2})(?![\\p{L}\\p{N}])', 'u'),
  )?.[1];
  return s ? `n${s}` : null;
}

function notebookCpuSlug(t: string): string | null {
  const cpu = t.match(NOTEBOOK_CPU_RE)?.[1];
  return cpu ? normalizeCase(cpu).replace(/\s+/g, '') : null;
}

function notebookRamSlug(t: string): string | null {
  const explicit = t.match(/(?<![\p{L}\p{N}])(\d{1,2})\s?(?:gb[\s-]*)?ram(?![\p{L}\p{N}])/u)?.[1];
  const nums = capacityTokens(t).map((c) => c.n);
  const ram = explicit ?? (nums.length > 1 ? String(Math.min(...nums)) : null);
  return ram ? `ram${ram}gb` : null;
}

function bikeAroSlug(t: string): string | null {
  const aro = t.match(/(?:^|[\s(])aro[\s]*(\d{2})(?![\p{L}\p{N}])/u)?.[1];
  return aro ? `aro${aro}` : null;
}

function bikeSpeedSlug(t: string): string | null {
  const v = t.match(/(\d{1,2})[\s-]*velocidades/)?.[1];
  return v ? `${v}v` : null;
}

function modelFrom(t: string, category: Category): string | null {
  // Celular: quatro tokens não-cabeça de orçamento. Com três, `Redmi Note 13 Pro` e
  // `Redmi Note 13 Pro Max` fechavam no mesmo modelo e dividiam a mediana — fundir produtos
  // é o erro caro; um adjetivo a mais no título fragmenta, e esse é o erro barato.
  if (category === 'celular') return headModel(t, CELULAR_HEADS, 4, false, true);
  if (category === 'notebook') return headModel(t, NOTEBOOK_HEADS, 1, true, false, NOTEBOOK_CPU_RE);
  if (category === 'console') {
    const ps = t.match(/(?<![\p{L}\p{N}])(?:playstation|ps)[\s-]*([45])(?:[\s-]*(super slim|slim 2|slim|pro|fat|digital|edicao))?/u);
    if (ps) return `ps${ps[1]}${ps[2] ? ' ' + normalizeCase(ps[2]) : ''}`;
    return headModel(t, CONSOLE_HEADS, 3);
  }
  if (category === 'bicicleta') return headModel(t, BIKE_HEADS, 2);
  if (category === 'autopeca') {
    const m = t.match(new RegExp('(?<![\\p{L}\\p{N}])(?:' + AUTO_LINE + ')(?![\\p{L}\\p{N}])', 'u'));
    return m?.[0] ? normalizeCase(m[0]) : null;
  }
  return null;
}

// R57: componente de identidade: lê da vista do título e só cai para a vista junta
// quando o título não diz nada daquele componente (senão a prosa da descrição
// sobre OUTRO produto realoca o fingerprint).
function identityFromViews(titleView: string, joinedView: string, get: (t: string) => string | null): string | null {
  const fromTitle = get(titleView);
  return fromTitle !== null ? fromTitle : get(joinedView);
}

function variantFromViews(titleView: string, joinedView: string, category: Category): string | null {
  const parts: string[] = [];

  if (category === 'celular' || category === 'console' || category === 'notebook') {
    const storage = identityFromViews(titleView, joinedView, storageSlug);
    if (storage) parts.push(storage);
  }

  // Celular: ordem storage → rede → lock/carrier. Lock é ATRIBUTO (descreve o mesmo
  // item anunciado; perdê-lo dividiria um produto em dois), storage/rede são identidade.
  if (category === 'celular') {
    const network = identityFromViews(titleView, joinedView, networkSlug);
    if (network) parts.push(network);
    const lock = lockSlug(joinedView);
    if (lock) parts.push(lock);
  }

  if (category === 'notebook') {
    const series = identityFromViews(titleView, joinedView, notebookSeriesSlug);
    if (series) parts.push(series);
    const cpu = identityFromViews(titleView, joinedView, notebookCpuSlug);
    if (cpu) parts.push(cpu);
    const ram = identityFromViews(titleView, joinedView, notebookRamSlug);
    if (ram) parts.push(ram);
  }

  if (category === 'bicicleta') {
    const aro = identityFromViews(titleView, joinedView, bikeAroSlug);
    if (aro) parts.push(aro);
    const speed = identityFromViews(titleView, joinedView, bikeSpeedSlug);
    if (speed) parts.push(speed);
  }

  if (category === 'autopeca') {
    const part = identityFromViews(titleView, joinedView, autoPartSlug);
    if (part) parts.push(part);
  }

  // R59: last resort de condição, lido da junta (atributo), e sempre o slug canônico `lacrado`.
  if (parts.length === 0 && LACRADO_RE.test(joinedView)) parts.push('lacrado');
  return parts.length > 0 ? parts.join('-') : null;
}

export function modelFor(text: string, category: Category): string | null {
  return modelFrom(view(text), category);
}

export function variantFor(text: string, category: Category): string | null {
  const t = view(text);
  return variantFromViews(t, t, category);
}

export function extractProduct(title: string, description: string): ParsedProduct {
  const category = classifyCategory(title, description);
  const haystack = `${title} ${description}`;
  const grade = detectGrade(haystack);
  if (category === 'outro') {
    return { category: 'outro', brand: null, model: null, variant: null, grade, matched: false };
  }
  // R57: identidade vem do título com fallback; atributos (marca, grade, lock) vêm do anúncio inteiro.
  const titleView = view(title);
  const joinedView = view(haystack);
  const brand = matchBrand(haystack, category);
  let model = modelFrom(titleView, category);
  if (model === null) model = modelFrom(joinedView, category);
  const variant = variantFromViews(titleView, joinedView, category);
  // R56: `matched` exige variante em notebook E autopeça — sem variante a mediana junta
  // mercadorias diferentes (`Farol Gol` R$ 900 com qualquer peça sem nome do Gol).
  const variantRequired = category === 'notebook' || category === 'autopeca';
  return {
    category, brand, model, variant, grade,
    matched: brand !== null && model !== null && (!variantRequired || variant !== null),
  };
}
