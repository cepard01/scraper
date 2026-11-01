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

const CPU_WORDS = '(?:i[3579]|core[\\s-]*[i3579]|ryzen[\\s-]*[357]|[mx]\\d)';
const CPU_RE = new RegExp('(?<![\\p{L}\\p{N}])(' + CPU_WORDS + ')(?![\\p{L}\\p{N}])', 'u');
const ARO_SIZES = '24|26|27|29';
const NOISE = 'gb|ssd|hdd|tb|ram|[45]g|lte|aro|' + ARO_SIZES +
  '|usado|usada|novo|nova|lacrado|lacrada|com|sem|de|do|da|para|no|na|e|preto|preta|branco|branca|prata|dourado|cinza|azul|roxo|verde|original|completo|completa|estado|nota|ano|un|bike|bicicleta|muleta|quadro';
const STOP_TOKEN = new RegExp('^(?:\\d{1,4}(?:gb|ssd|hdd|tb|ram)|' + NOISE + ')$');

function view(text: string): string {
  const spelled = text.replace(/(\p{N})\s*\+(?![\p{L}\p{N}])/gu, '$1 plus');
  return ` ${cleanTitle(spelled).replace(/(\d)[\s]+(gb|ssd|hdd|tb|ram)/g, '$1$2')} `;
}

function modelRun(t: string, from: number, max: number, alphaOnly = false): string[] {
  const out: string[] = [];
  for (const w of t.slice(from).split(' ')) {
    if (!w) continue;
    if (out.length >= max) break;
    if (STOP_TOKEN.test(w)) break;
    if (CPU_RE.test(w)) break;
    if (alphaOnly && /^\d+$/.test(w)) break;
    out.push(w);
  }
  return out;
}

function headModel(t: string, heads: string, max: number, alphaOnly = false, requireTail = false): string | null {
  const m = t.match(new RegExp('(?<![\\p{L}\\p{N}])(?:' + heads + ')(?![\\p{L}\\p{N}])', 'u'));
  if (!m || m.index === undefined) return null;
  const rest = modelRun(t, m.index + m[0].length, max, alphaOnly);
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

function autoPartSlug(t: string): string | null {
  let best: { at: number; word: string } | null = null;
  for (const w of AUTO_PARTS) {
    const at = t.indexOf(w);
    if (at < 0) continue;
    if (!best || at < best.at) best = { at, word: w };
  }
  if (!best) return null;
  const gen = t.match(/(?<![\p{L}\p{N}])g(\d)(?![\p{L}\p{N}])/u);
  return best.word.replace(/\s+/g, '') + (gen ? gen[0] : '');
}

export function modelFor(text: string, category: Category): string | null {
  const t = view(text);
  if (category === 'celular') return headModel(t, CELULAR_HEADS, 3, false, true);
  if (category === 'notebook') return headModel(t, NOTEBOOK_HEADS, 1, true);
  if (category === 'console') {
    const ps = t.match(/(?<![\p{L}\p{N}])(?:playstation|ps)[\s-]*([45])(?:[\s-]*(super slim|slim 2|slim|pro|fat|digital|edicao))?/u);
    if (ps) return `ps${ps[1]}${ps[2] ? ' ' + normalizeCase(ps[2]) : ''}`;
    return headModel(t, CONSOLE_HEADS, 3);
  }
  if (category === 'bicicleta') return headModel(t, BIKE_HEADS, 2);
  if (category === 'autopeca') {
    const m = t.match(new RegExp('(?<![\\p{L}\\p{N}])(?:' + AUTO_LINE + ')(?![\\p{L}\\p{N}])', 'u'));
    return m ? normalizeCase(m[0]) : null;
  }
  return null;
}

export function variantFor(text: string, category: Category): string | null {
  const t = view(text);
  const parts: string[] = [];

  if (category === 'celular' || category === 'console' || category === 'notebook') {
    const storage = storageSlug(t);
    if (storage) parts.push(storage);
  }

  if (category === 'celular') {
    if (/\bdesbloquead\w*\b/.test(t)) parts.push('desbloqueado');
    else {
      const carrier = CARRIERS.find((c) => new RegExp(`(?<![\\p{L}\\p{N}])${c}(?![\\p{L}\\p{N}])`, 'u').test(t));
      if (carrier) parts.push(carrier);
      else if (/\bbloquead\w*\b/.test(t)) parts.push('bloqueado');
    }
  }

  if (category === 'notebook') {
    const series = t.match(new RegExp('(?<![\\p{L}\\p{N}])(?:' + NOTEBOOK_HEADS + ')(?![\\p{L}\\p{N}])[\\s]+(\\d{1,2})(?![\\p{L}\\p{N}])', 'u'));
    if (series?.[1]) parts.push(`n${series[1]}`);
    const cpu = t.match(CPU_RE);
    if (cpu?.[1]) parts.push(normalizeCase(cpu[1]).replace(/\s+/g, ''));
    const explicit = t.match(/(?<![\p{L}\p{N}])(\d{1,2})\s?(?:gb[\s-]*)?ram(?![\p{L}\p{N}])/u);
    const nums = capacityTokens(t).map((c) => c.n);
    const ram = explicit?.[1] ?? (nums.length > 1 ? String(Math.min(...nums)) : null);
    if (ram) parts.push(`ram${ram}gb`);
  }

  if (category === 'bicicleta') {
    const aro = t.match(/(?:^|[\s(])aro[\s]*(\d{2})(?![\p{L}\p{N}])/u);
    if (aro?.[1]) parts.push(`aro${aro[1]}`);
    const speed = t.match(/(\d{1,2})[\s-]*velocidades/);
    if (speed?.[1]) parts.push(`${speed[1]}v`);
  }

  if (category === 'autopeca') {
    const part = autoPartSlug(t);
    if (part) parts.push(part);
  }

  if (/\blacrado\b/.test(t) && parts.length === 0) parts.push('lacrado');
  return parts.length > 0 ? parts.join('-') : null;
}

export function extractProduct(title: string, description: string): ParsedProduct {
  const category = classifyCategory(title, description);
  const haystack = `${title} ${description}`;
  if (category === 'outro') {
    return { category: 'outro', brand: null, model: null, variant: null, grade: detectGrade(haystack), matched: false };
  }
  const brand = matchBrand(haystack, category);
  const model = modelFor(haystack, category);
  const variant = variantFor(haystack, category);
  return {
    category, brand, model, variant,
    grade: detectGrade(haystack),
    matched: brand !== null && model !== null && (category !== 'notebook' || variant !== null),
  };
}
