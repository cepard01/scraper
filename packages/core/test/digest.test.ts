import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, loadSettings, type Db } from '../src/db/client-helpers';
import { runMonitor } from '../src/pipeline';
import { runDigest } from '../src/digest';
import { nullAiPort } from '../src/ai-port';
import { localAskingProvider } from '../src/valuation/comparables';
import { createMonitor } from '../src/db/repo/monitors';
import { upsertFromSource } from '../src/db/repo/listings';
import { getOrCreateFingerprint } from '../src/db/repo/fingerprints';
import { dealAlerts, opportunities } from '../src/db/schema';
import type { AlertMessage, NotifyPort } from '../src/notify-port';
import type { ListingInput, RawListing } from '../src/types';
import type { SourceAdapter } from '../src/adapter-contract';

const product = { category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true } as const;
const NOW = new Date('2026-11-02T12:00:00Z'); // 09:00 em São Paulo
const TZ = 'America/Sao_Paulo';
const settings = { ...DEFAULT_SETTINGS, floorMarginPct: 0.1, floorMarginCents: 10_000 };

const li = (id: string, ask: number): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx/a/${id}`, title: 'iPhone 12 128GB Desbloqueado',
  description: 'usado pouco', askingCents: ask, askingRaw: `R$ ${ask / 100}`,
  city: 'Curitiba', uf: 'PR', imageUrls: [], sellerRef: null, publishedAt: null,
});

const spy = (ok: boolean) => {
  const calls: AlertMessage[] = [];
  const port: NotifyPort = { async send(m) { calls.push(m); return ok ? { ok: true } : { ok: false, error: 'http 500' }; } };
  return { port, calls };
};

let db: Db;
beforeEach(async () => {
  db = openDb(':memory:').db;
  migrateDb(db);
  seedSettings(db, DEFAULT_SETTINGS);
  const fp = getOrCreateFingerprint(db, product);
  for (let i = 0; i < 15; i++) {
    upsertFromSource(db, li(`cmp-${i}`, 400_000 + i * 1_000), {
      parserVersion: 'olx-1', fingerprintId: fp.id, seenAt: new Date('2026-11-01T12:00:00Z'),
    });
  }
  const monitorId = createMonitor(db, { label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30 });
  const adapter: SourceAdapter = {
    id: 'olx', parserVersion: 'olx-rsc-2026-11',
    async health() { return { ok: true }; },
    async search() { return [{ source: 'olx', externalId: 'deal-1', url: 'https://olx/a/deal-1', fetchedAt: NOW, payload: li('deal-1', 250_000) } as RawListing]; },
    async fetchOne() { throw new Error('nao usado'); },
    toListingInput(raw: RawListing) { return raw.payload as ListingInput; },
  };
  await runMonitor({
    db, settings, adapter, ai: nullAiPort(), comparables: localAskingProvider,
    notify: spy(true).port, now: () => NOW,
  }, {
    id: monitorId, label: 'q', source: 'olx', query: 'iphone 12', category: 'celular',
    params: { minSamples: 5 }, intervalMinutes: 30, active: true, lastRunAt: null,
    lastYield: 0, mutedUntil: null,
  });
});

const format = (rows: Array<{ title: string }>, label: string): AlertMessage => ({
  title: `digest ${label} (${rows.length})`, body: rows.map((r) => r.title).join('\n'),
  tags: [], priority: 3, clickUrl: '',
});

describe('runDigest', () => {
  it('antes da hora local não envia e não marca lastDigestAt', async () => {
    const { port, calls } = spy(true);
    const outcome = await runDigest({ db, notify: port, now: () => new Date('2026-11-02T10:59:00Z'), tz: TZ, format });
    expect(outcome).toMatchObject({ sent: false, reason: 'fora-da-hora' });
    expect(calls).toHaveLength(0);
    expect(loadSettings(db).lastDigestAt).toBeNull();
  });

  it('na hora envia o topo, grava channel digest e não repete no mesmo dia', async () => {
    const { port, calls } = spy(true);
    const deps = { db, notify: port, now: () => NOW, tz: TZ, format };
    const first = await runDigest(deps);
    const second = await runDigest(deps);

    expect(first).toEqual({ sent: true, rows: 1 });
    expect(second).toMatchObject({ sent: false, reason: 'fora-da-hora' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toBe('digest 2026-11-02 (1)');
    expect(loadSettings(db).lastDigestAt).toEqual(NOW);

    const digestRows = db.select().from(dealAlerts).where(eq(dealAlerts.channel, 'digest')).all();
    expect(digestRows).toHaveLength(1);
    expect(digestRows[0]).toMatchObject({ status: 'sent', alertedAtCents: 250_000 });
  });

  it('falha de transporte fica failed e permite nova tentativa no mesmo dia', async () => {
    const failed = spy(false);
    const first = await runDigest({ db, notify: failed.port, now: () => NOW, tz: TZ, format });
    expect(first).toMatchObject({ sent: false, reason: 'http 500' });
    expect(loadSettings(db).lastDigestAt).toBeNull();
    expect(db.select().from(dealAlerts).where(eq(dealAlerts.channel, 'digest')).all()[0]).toMatchObject({ status: 'failed', reason: 'http 500' });

    const ok = spy(true);
    const second = await runDigest({ db, notify: ok.port, now: () => NOW, tz: TZ, format });
    expect(second).toEqual({ sent: true, rows: 1 });
    expect(ok.calls).toHaveLength(1);
  });

  it('sem shortlist não gasta notificação nem data', async () => {
    db.delete(dealAlerts).run();
    db.delete(opportunities).run();
    const { port, calls } = spy(true);
    const outcome = await runDigest({ db, notify: port, now: () => NOW, tz: TZ, format });
    expect(outcome).toEqual({ sent: false, rows: 0, reason: 'sem-itens' });
    expect(calls).toHaveLength(0);
    expect(loadSettings(db).lastDigestAt).toBeNull();
  });
});
