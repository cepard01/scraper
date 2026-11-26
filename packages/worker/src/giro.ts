import { pathToFileURL } from 'node:url';
import { loadConfig } from '@brique/core/config';
import { openDb, migrateDb, seedSettings, loadSettings, DEFAULT_SETTINGS } from '@brique/core/db/client-helpers';
import type { Db } from '@brique/core/db/client';
import { getFingerprintById } from '@brique/core/db/repo/fingerprints';
import { getListing } from '@brique/core/db/repo/listings';
import { insertPurchase, recordSale } from '@brique/core/db/repo/giro';
import { latestValuationFor } from '@brique/core/db/repo/valuations';
import { realizedFor, pnlSummary } from '@brique/core/pnl';
import { formatBRL, parsePriceBRL } from '@brique/core/money';
import type { Category, Settings } from '@brique/core';

export interface GiroDeps {
  db: Db;
  settings: Settings;
  tz: string;
  now: Date;
}

export interface GiroResult {
  code: number;
  out: string;
  err: string;
}

const CATEGORIES: readonly Category[] = ['celular', 'notebook', 'console', 'bicicleta', 'autopeca', 'outro'];

const USAGE = [
  'uso:',
  '  pnpm buy -- "iPhone 12 128GB" --paid 980 [--listing 42] [--category celular]',
  '  pnpm sell -- 7 --sold 1650 --platform meli',
  '  pnpm pnl [--month 2026-10] [--category celular]',
  'preco em reais: 980 = R$ 980,00; virgula ou ponto valem ("1.650,00").',
].join('\n');

type ParsedArgs =
  | { ok: true; positionals: string[]; flags: Record<string, string> }
  | { ok: false; error: string };

function parseArgs(argv: string[], allowed: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!allowed.includes(name)) return { ok: false, error: `flag desconhecida: --${name}` };
    if (name in flags) return { ok: false, error: `flag repetida: --${name}` };

    if (eq !== -1) {
      flags[name] = arg.slice(eq + 1);
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { ok: false, error: `--${name} sem valor` };
    flags[name] = value;
    i++;
  }

  return { ok: true, positionals, flags };
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

function parseMoney(flag: string, raw: string, settings: Settings): { cents: number } | { error: string } {
  const parsed = parsePriceBRL(raw, { maxCents: settings.maxPriceCents });
  if (!parsed.ok) return { error: `${flag}: "${raw}" recusado (${parsed.reason})` };
  return { cents: parsed.cents };
}

function parseId(flag: string, raw: string): { id: number } | { error: string } {
  if (!/^\d+$/.test(raw)) return { error: `${flag} precisa ser um id numerico positivo` };
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return { error: `${flag} precisa ser um id numerico positivo` };
  return { id };
}

function startOfMonthUtc(year: number, monthIndex: number, tz: string): Date {
  const guess = new Date(Date.UTC(year, monthIndex, 1, 12));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(guess);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(Date.UTC(year, monthIndex, 1) - (wall - guess.getTime()));
}

const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DECIMAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function pct(value: number | null): string {
  return value === null ? 'n/d' : PCT.format(value);
}

function buy(argv: string[], deps: GiroDeps): GiroResult {
  const parsed = parseArgs(argv, ['paid', 'listing', 'category']);
  if (!parsed.ok) return { code: 1, out: '', err: `erro: ${parsed.error}` };

  const label = parsed.positionals.join(' ').trim();
  if (!label) return { code: 1, out: '', err: 'erro: informe o item: pnpm buy -- "iPhone 12 128GB" --paid 980' };

  const paidRaw = parsed.flags.paid;
  if (paidRaw === undefined) return { code: 1, out: '', err: 'erro: --paid e obrigatorio' };
  const paid = parseMoney('--paid', paidRaw, deps.settings);
  if ('error' in paid) return { code: 1, out: '', err: `erro: ${paid.error}` };

  let category: Category | undefined;
  const categoryRaw = parsed.flags.category;
  if (categoryRaw !== undefined) {
    if (!isCategory(categoryRaw)) {
      return { code: 1, out: '', err: `erro: categoria invalida "${categoryRaw}"; use: ${CATEGORIES.join(', ')}` };
    }
    category = categoryRaw;
  }

  let listingId: number | null = null;
  let fingerprintId: number | null = null;
  let refMedianCents: number | null = null;
  let refLine = 'ref: n/d (entrada manual, fora do delta medido)';

  const listingRaw = parsed.flags.listing;
  if (listingRaw !== undefined) {
    const id = parseId('--listing', listingRaw);
    if ('error' in id) return { code: 1, out: '', err: `erro: ${id.error}` };

    const listing = getListing(deps.db, id.id);
    if (!listing) return { code: 1, out: '', err: `erro: anuncio ${id.id} nao existe` };
    listingId = listing.id;
    fingerprintId = listing.fingerprintId;

    if (listing.fingerprintId !== null) {
      const fp = getFingerprintById(deps.db, listing.fingerprintId);
      if (!fp) return { code: 1, out: '', err: `erro: fingerprint ${listing.fingerprintId} do anuncio ${listing.id} nao existe` };
      if (category !== undefined && category !== fp.category) {
        return { code: 1, out: '', err: `erro: --category ${category} contradiz o anuncio (${fp.category})` };
      }
      category = fp.category;

      const valuation = latestValuationFor(deps.db, fp.id);
      refMedianCents = valuation?.medianCents ?? null;
      refLine = refMedianCents === null
        ? 'ref: n/d (anuncio sem mediana de referencia, fora do delta medido)'
        : `ref: ${formatBRL(refMedianCents)} (valuation do anuncio)`;
    } else if (category === undefined) {
      return { code: 1, out: '', err: `erro: anuncio ${listing.id} sem fingerprint; passe --category` };
    }
  }

  if (category === undefined) {
    return { code: 1, out: '', err: 'erro: sem --listing, --category e obrigatorio' };
  }

  const purchaseId = insertPurchase(deps.db, {
    label,
    category,
    paidCents: paid.cents,
    boughtAt: deps.now,
    listingId,
    fingerprintId,
    refMedianCents,
  });

  const lines = [
    `compra #${purchaseId} registrada`,
    `item: ${label}`,
    `categoria: ${category}`,
    `pago: ${formatBRL(paid.cents)}`,
    `anuncio: ${listingId === null ? '-' : `#${listingId}`}`,
  ];
  if (fingerprintId !== null) lines.push(`fingerprint: #${fingerprintId}`);
  lines.push(refLine);

  return { code: 0, out: lines.join('\n'), err: '' };
}

function sell(argv: string[], deps: GiroDeps): GiroResult {
  const parsed = parseArgs(argv, ['sold', 'platform']);
  if (!parsed.ok) return { code: 1, out: '', err: `erro: ${parsed.error}` };

  const idRaw = parsed.positionals[0];
  if (idRaw === undefined) return { code: 1, out: '', err: 'erro: informe a compra: pnpm sell -- 7 --sold 1650 --platform meli' };
  if (parsed.positionals.length > 1) return { code: 1, out: '', err: 'erro: sell aceita apenas um id de compra' };

  const id = parseId('compra', idRaw);
  if ('error' in id) return { code: 1, out: '', err: `erro: ${id.error}` };

  const soldRaw = parsed.flags.sold;
  if (soldRaw === undefined) return { code: 1, out: '', err: 'erro: --sold e obrigatorio' };
  const sold = parseMoney('--sold', soldRaw, deps.settings);
  if ('error' in sold) return { code: 1, out: '', err: `erro: ${sold.error}` };

  const platform = parsed.flags.platform;
  if (platform === undefined || platform.trim() === '') return { code: 1, out: '', err: 'erro: --platform e obrigatorio' };

  recordSale(deps.db, {
    purchaseId: id.id,
    soldCents: sold.cents,
    platform,
    soldAt: deps.now,
  }, deps.settings);

  const realized = realizedFor(deps.db, id.id);
  if (!realized) return { code: 1, out: '', err: `erro: venda da compra ${id.id} nao realizada` };

  return {
    code: 0,
    out: [
      `venda da compra #${id.id} registrada`,
      `item: ${realized.label}`,
      `vendido: ${formatBRL(realized.soldCents)}`,
      `plataforma: ${platform}`,
      `taxa: ${formatBRL(realized.feesCents)}`,
      `liquido: ${formatBRL(realized.netProceedsCents)}`,
      `lucro: ${formatBRL(realized.marginCents)}`,
      `roi: ${pct(realized.roiPct)}`,
      `dias: ${realized.daysInStock}`,
    ].join('\n'),
    err: '',
  };
}

function pnl(argv: string[], deps: GiroDeps): GiroResult {
  const parsed = parseArgs(argv, ['month', 'category']);
  if (!parsed.ok) return { code: 1, out: '', err: `erro: ${parsed.error}` };
  if (parsed.positionals.length > 0) return { code: 1, out: '', err: 'erro: pnl nao aceita argumentos posicionais' };

  let category: Category | undefined;
  const categoryRaw = parsed.flags.category;
  if (categoryRaw !== undefined) {
    if (!isCategory(categoryRaw)) {
      return { code: 1, out: '', err: `erro: categoria invalida "${categoryRaw}"; use: ${CATEGORIES.join(', ')}` };
    }
    category = categoryRaw;
  }

  let from: Date | undefined;
  let to: Date | undefined;
  const month = parsed.flags.month;
  if (month !== undefined) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (!m) return { code: 1, out: '', err: `erro: --month invalido "${month}"; use YYYY-MM` };
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1;
    from = startOfMonthUtc(year, monthIndex, deps.tz);
    to = new Date(startOfMonthUtc(year, monthIndex + 1, deps.tz).getTime() - 1);
  }

  const s = pnlSummary(deps.db, { from, to, tz: deps.tz, category });

  return {
    code: 0,
    out: [
      `P&L ${month ?? '(tudo)'}${category === undefined ? '' : ` (categoria: ${category})`}`,
      `realizado: ${formatBRL(s.realizedCents)}`,
      `receita: ${formatBRL(s.revenueCents)}`,
      `custo: ${formatBRL(s.costCents)}`,
      `roi: ${pct(s.roiPct)}`,
      `vendas: ${s.soldCount}`,
      `dias medios: ${s.avgDaysInStock === null ? 'n/d' : DECIMAL.format(s.avgDaysInStock)}`,
      `estoque${category === undefined ? '' : ' (global)'}: ${formatBRL(s.inventoryValueCents)} (${s.inventoryCount} itens)`,
    ].join('\n'),
    err: '',
  };
}

export function runGiroCommand(argv: string[], deps: GiroDeps): GiroResult {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'buy': return buy(rest, deps);
      case 'sell': return sell(rest, deps);
      case 'pnl': return pnl(rest, deps);
      case 'help':
      case '--help':
      case '-h': return { code: 0, out: USAGE, err: '' };
      case undefined: return { code: 1, out: '', err: USAGE };
      default: return { code: 1, out: '', err: `erro: comando desconhecido "${command}"\n${USAGE}` };
    }
  } catch (err) {
    return { code: 1, out: '', err: `erro: ${(err as Error).message}` };
  }
}

export function main(argv = process.argv.slice(2)): void {
  try { process.loadEnvFile(); } catch { /* .env opcional: em VPS o systemd ja trouxe tudo */ }

  const cfg = loadConfig();
  const { db } = openDb(cfg.sqlitePath);
  migrateDb(db);
  seedSettings(db, DEFAULT_SETTINGS);
  const settings = loadSettings(db);

  const result = runGiroCommand(argv, { db, settings, tz: cfg.tz, now: new Date() });
  if (result.out) process.stdout.write(`${result.out}\n`);
  if (result.err) process.stderr.write(`${result.err}\n`);
  process.exitCode = result.code;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) main();
