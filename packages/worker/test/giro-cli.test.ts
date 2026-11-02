import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb, DEFAULT_SETTINGS } from '@brique/core/db/client-helpers';
import type { Db } from '@brique/core/db/client';
import { purchases, sales } from '@brique/core/db/schema';
import { getOrCreateFingerprint } from '@brique/core/db/repo/fingerprints';
import { upsertFromSource } from '@brique/core/db/repo/listings';
import { insertValuation } from '@brique/core/db/repo/valuations';
import { runGiroCommand, type GiroDeps } from '../src/giro';
import type { ListingInput, ParsedProduct, Valuation } from '@brique/core';

const TZ = 'America/Sao_Paulo';
const D = (iso: string) => new Date(iso);
const BUY_AT = D('2026-10-01T12:00:00Z');
const SELL_AT = D('2026-10-09T12:00:00Z');

const product: ParsedProduct = {
  category: 'celular', brand: 'apple', model: 'iphone 12',
  variant: '128gb-desbloqueado', grade: 'B', matched: true,
};

const input = (externalId: string, askingCents: number): ListingInput => ({
  source: 'olx', externalId, url: `https://olx/a/${externalId}`, title: 'iPhone 12 128GB',
  description: '', askingCents, askingRaw: String(askingCents), city: 'Curitiba', uf: 'PR',
  imageUrls: [], sellerRef: null, publishedAt: null,
});

const valuation = (fingerprintId: number): Valuation => ({
  fingerprintId, sampleSize: 5, medianCents: 120_000, p25Cents: 110_000, p75Cents: 130_000,
  fairGrossCents: 102_000, delta: 0.85, liquidityDays: 10, liquiditySource: 'category-default',
  confidence: 'med', variantAgnostic: false, computedAt: BUY_AT,
});

let db: Db;

const deps = (now: Date): GiroDeps => ({ db, settings: DEFAULT_SETTINGS, tz: TZ, now });

const run = (argv: string[], now = BUY_AT) => runGiroCommand(argv, deps(now));

const seedListing = (askingCents = 120_000) => {
  const fp = getOrCreateFingerprint(db, product);
  const listing = upsertFromSource(db, input('42', askingCents), {
    parserVersion: 'test', fingerprintId: fp.id, seenAt: BUY_AT,
  });
  insertValuation(db, fp.id, valuation(fp.id), []);
  return { fp, listing };
};

beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
});

describe('giro CLI: buy', () => {
  it('registra a compra e congela o recibo com preco formatado', () => {
    seedListing();

    const res = run(['buy', 'iPhone 12 128GB', '--paid', '980', '--listing', '1']);

    expect(res.code).toBe(0);
    expect(res.err).toBe('');
    expect(res.out).toMatchSnapshot();

    const p = db.select().from(purchases).all()[0]!;
    expect(p.label).toBe('iPhone 12 128GB');
    expect(p.category).toBe('celular');
    expect(p.paidCents).toBe(98_000);
    expect(p.listingId).toBe(1);
    expect(p.fingerprintId).toBe(1);
    expect(p.refMedianCents).toBe(120_000);
    expect(p.boughtAt).toEqual(BUY_AT);
  });

  it('sem --listing exige categoria e grava ref nula', () => {
    const semCategoria = run(['buy', 'Item solto', '--paid', '100']);
    expect(semCategoria.code).toBe(1);
    expect(semCategoria.err).toContain('--category e obrigatorio');
    expect(db.select().from(purchases).all()).toHaveLength(0);

    const res = run(['buy', 'Item solto', '--paid', '100', '--category', 'outro']);
    expect(res.code).toBe(0);
    expect(res.out).toContain('anuncio: -');
    expect(res.out).toContain('ref: n/d (entrada manual, fora do delta medido)');
    expect(db.select().from(purchases).all()[0]!.refMedianCents).toBeNull();
  });

  it('aceita preco sujo com moeda, milhar e virgula', () => {
    const res = run(['buy', 'Notebook', '--paid', 'R$ 1.234,56', '--category', 'notebook']);
    expect(res.code).toBe(0);
    expect(res.out).toContain('pago: R$ 1.234,56');
    expect(db.select().from(purchases).all()[0]!.paidCents).toBe(123_456);
  });

  it('valor ambiguo sem centavos e recusado sem gravar NaN', () => {
    for (const paid of ['980.', '0', 'abc', '1,5 mil']) {
      const res = run(['buy', 'Item', '--paid', paid, '--category', 'outro']);
      expect(res.code).toBe(1);
      expect(res.err).toMatch(/recusado \((not-a-price|zero)\)/);
    }
    expect(db.select().from(purchases).all()).toHaveLength(0);
  });

  it('flag desconhecida nao vira argumento posicional nem grava', () => {
    const res = run(['buy', 'Item', '--padi', '980', '--category', 'outro']);
    expect(res.code).toBe(1);
    expect(res.err).toContain('flag desconhecida: --padi');
    expect(db.select().from(purchases).all()).toHaveLength(0);
  });

  it('categoria que contradiz o anuncio e recusada', () => {
    seedListing();
    const res = run(['buy', 'iPhone', '--paid', '980', '--listing', '1', '--category', 'notebook']);
    expect(res.code).toBe(1);
    expect(res.err).toContain('contradiz o anuncio (celular)');
    expect(db.select().from(purchases).all()).toHaveLength(0);
  });
});

describe('giro CLI: sell', () => {
  const buyOne = () => {
    const res = run(['buy', 'iPhone 12 128GB', '--paid', '980', '--category', 'celular']);
    expect(res.code).toBe(0);
    return db.select().from(purchases).all()[0]!.id;
  };

  it('registra a venda e congela o recibo com taxa, liquido, lucro e ROI', () => {
    const id = buyOne();
    const res = run(['sell', String(id), '--sold', '1.650,00', '--platform', 'meli'], SELL_AT);

    expect(res.code).toBe(0);
    expect(res.out).toMatchSnapshot();

    const s = db.select().from(sales).all()[0]!;
    expect(s.soldCents).toBe(165_000);
    expect(s.platformFeeCents).toBe(26_400);
  });

  it('sell de id inexistente falha nomeando a compra e nao grava venda', () => {
    const res = run(['sell', '99', '--sold', '100', '--platform', 'olx'], SELL_AT);
    expect(res.code).toBe(1);
    expect(res.err).toMatch(/compra 99 n.o existe/);
    expect(db.select().from(sales).all()).toHaveLength(0);
  });

  it('plataforma sem taxa cadastrada repete o motivo em vez de gravar taxa zero', () => {
    const id = buyOne();
    const res = run(['sell', String(id), '--sold', '1.650,00', '--platform', 'meii'], SELL_AT);
    expect(res.code).toBe(1);
    expect(res.err).toContain('plataforma "meii" sem taxa');
    expect(db.select().from(sales).all()).toHaveLength(0);
  });
});

describe('giro CLI: pnl', () => {
  it('banco vazio imprime zeros legiveis, nao NaN', () => {
    const res = run(['pnl']);
    expect(res.code).toBe(0);
    expect(res.out).toMatchSnapshot();
    expect(res.out).not.toContain('NaN');
  });

  it('filtra por mes na tz de exibicao e por categoria', () => {
    run(['buy', 'Celular', '--paid', '1000', '--category', 'celular']);
    run(['buy', 'Notebook', '--paid', '1000', '--category', 'notebook']);
    const rows = db.select().from(purchases).all();
    const cel = rows.find((p) => p.label === 'Celular')!;
    const note = rows.find((p) => p.label === 'Notebook')!;

    run(['sell', String(cel.id), '--sold', '1500', '--platform', 'olx'], D('2026-11-01T01:00:00Z'));
    run(['sell', String(note.id), '--sold', '2000', '--platform', 'olx'], D('2026-11-05T12:00:00Z'));

    const out = run(['pnl', '--month', '2026-10', '--category', 'celular']).out;
    expect(out).toContain('P&L 2026-10 (categoria: celular)');
    expect(out).toContain('receita: R$ 1.500,00');
    expect(out).toContain('vendas: 1');
    expect(out).not.toContain('2.000,00');
  });

  it('mes invalido e argumento posicional sao recusados', () => {
    expect(run(['pnl', '--month', '2026-13']).code).toBe(1);
    expect(run(['pnl', '--month', '2026-13']).err).toContain('--month invalido');
    expect(run(['pnl', 'outubro']).code).toBe(1);
  });
});

describe('giro CLI: uso', () => {
  it('sem comando imprime o uso e sai 1', () => {
    const res = run([]);
    expect(res.code).toBe(1);
    expect(res.err).toContain('pnpm buy');
  });

  it('help sai 0 com os tres comandos', () => {
    const res = run(['help']);
    expect(res.code).toBe(0);
    expect(res.out).toContain('pnpm sell');
    expect(res.out).toContain('pnpm pnl');
  });
});
