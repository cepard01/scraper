import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, type Db } from '../src/db/client-helpers';
import { runMonitor } from '../src/pipeline';
import { nullAiPort } from '../src/ai-port';
import { localAskingProvider } from '../src/valuation/comparables';
import { createMonitor } from '../src/db/repo/monitors';
import { upsertFromSource } from '../src/db/repo/listings';
import { getOrCreateFingerprint } from '../src/db/repo/fingerprints';
import { setDealAlertAction } from '../src/db/repo/alerts';
import { dealAlerts, runs } from '../src/db/schema';
import type { AlertMessage, NotifyPort } from '../src/notify-port';
import type { ListingInput, MonitorParams, RawListing, SearchMonitor } from '../src/types';
import type { SourceAdapter } from '../src/adapter-contract';

const product = { category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true } as const;
const NOW = new Date('2026-10-05T12:00:00Z');
const TZ = 'America/Sao_Paulo';

const li = (id: string, ask: number): ListingInput => ({
  source: 'olx', externalId: id, url: `https://olx/a/${id}`, title: 'iPhone 12 128GB Desbloqueado',
  description: 'usado pouco', askingCents: ask, askingRaw: `R$ ${ask / 100}`,
  city: 'Rio de Janeiro', uf: 'RJ', imageUrls: [], sellerRef: null, publishedAt: null,
});

const monitor = (id: number, over: Partial<SearchMonitor> = {}): SearchMonitor => ({
  id, label: 'iphone-12-rj', source: 'olx', query: 'iphone 12', category: 'celular',
  params: {}, intervalMinutes: 30, active: true, lastRunAt: null, lastYield: 0, mutedUntil: null, ...over,
});

const adapter = (item: ListingInput): SourceAdapter => ({
  id: 'olx', parserVersion: 'olx-rsc-2026-11',
  async health() { return { ok: true }; },
  async search() { return [{ source: 'olx', externalId: item.externalId, url: item.url, fetchedAt: NOW, payload: item } as RawListing]; },
  async fetchOne() { throw new Error('nao usado'); },
  toListingInput(raw: RawListing) { return raw.payload as ListingInput; },
});

const notifier = () => {
  const calls: AlertMessage[] = [];
  const port: NotifyPort = { async send(m) { calls.push(m); return { ok: true }; } };
  return { port, calls };
};

let db: Db;
beforeEach(() => {
  db = openDb(':memory:').db;
  migrateDb(db);
  seedSettings(db, DEFAULT_SETTINGS);
  const fp = getOrCreateFingerprint(db, product);
  for (let i = 0; i < 15; i++) {
    upsertFromSource(db, li(`cmp-${i}`, 400_000 + i * 1_000), {
      parserVersion: 'olx-1', fingerprintId: fp.id, seenAt: new Date('2026-10-01T12:00:00Z'),
    });
  }
});

const settings = { ...DEFAULT_SETTINGS, floorMarginPct: 0.1, floorMarginCents: 10_000 };
const depsFor = (item: ListingInput, port: NotifyPort, at: Date = NOW) => ({
  db, settings, adapter: adapter(item), ai: nullAiPort(), comparables: localAskingProvider,
  notify: port, tz: TZ, now: () => at,
});
const params: MonitorParams = { minSamples: 5 };

const newMonitor = () => createMonitor(db, {
  label: 'q', source: 'olx', query: 'iphone 12', category: 'celular', params: {}, intervalMinutes: 30,
});

describe('supressões com registro', () => {
  it('silent hours grava suppressed em vez de engolir o alerta', async () => {
    const id = newMonitor();
    const { port, calls } = notifier();
    const silentAt = new Date('2026-10-05T01:00:00Z'); // 22:00 em São Paulo
    const summary = await runMonitor(depsFor(li('silent-1', 250_000), port, silentAt), monitor(id, { params }));

    expect(summary.alerts).toBe(0);
    expect(calls).toHaveLength(0);
    expect(db.select().from(dealAlerts).all()).toMatchObject([{ status: 'suppressed', reason: 'silent-hours' }]);
  });

  it('monitor muto direto na pipeline também fica suppressed', async () => {
    const id = newMonitor();
    const { port, calls } = notifier();
    const muted = monitor(id, { params, mutedUntil: new Date(NOW.getTime() + 3_600_000) });
    const summary = await runMonitor(depsFor(li('mute-1', 250_000), port), muted);

    expect(summary.alerts).toBe(0);
    expect(calls).toHaveLength(0);
    expect(db.select().from(dealAlerts).all()[0]).toMatchObject({ status: 'suppressed', reason: 'monitor-mute' });
  });

  it('soneca vigente segura e soneca vencida libera a próxima cruzada', async () => {
    const id = newMonitor();
    const { port, calls } = notifier();
    await runMonitor(depsFor(li('snooze-1', 250_000), port), monitor(id, { params }));
    const sent = db.select().from(dealAlerts).where(eq(dealAlerts.status, 'sent')).get()!;

    setDealAlertAction(db, sent.id, 'snoozed', { at: NOW, snoozeUntil: new Date(NOW.getTime() + 3_600_000) });
    const during = await runMonitor(
      depsFor(li('snooze-1', 150_000), port, new Date(NOW.getTime() + 60_000)), monitor(id, { params }),
    );
    expect(during.alerts).toBe(0);
    expect(db.select().from(dealAlerts).all().at(-1)).toMatchObject({ status: 'suppressed', reason: 'snoozed' });

    setDealAlertAction(db, sent.id, 'snoozed', { at: NOW, snoozeUntil: new Date(NOW.getTime() + 30_000) });
    const after = await runMonitor(
      depsFor(li('snooze-1', 120_000), port, new Date(NOW.getTime() + 120_000)), monitor(id, { params }),
    );
    expect(after.alerts).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('comprado ou ignorado encerram o anúncio permanentemente', async () => {
    for (const action of ['taken', 'ignored'] as const) {
      const id = newMonitor();
      const { port } = notifier();
      await runMonitor(depsFor(li(`action-${action}`, 250_000), port), monitor(id, { params }));
      const sent = db.select().from(dealAlerts).all().filter((r) => r.status === 'sent').at(-1)!;
      setDealAlertAction(db, sent.id, action, { at: NOW });

      const again = await runMonitor(
        depsFor(li(`action-${action}`, 150_000), port, new Date(NOW.getTime() + 60_000)),
        monitor(id, { params }),
      );
      expect(again.alerts).toBe(0);
      expect(db.select().from(dealAlerts).all().at(-1)).toMatchObject({
        status: 'suppressed', reason: `alert-${action}`,
      });
    }
  });

  it('alerts entregues são persistidos em run.alerts', async () => {
    const id = newMonitor();
    const { port } = notifier();
    const summary = await runMonitor(depsFor(li('run-alert', 250_000), port), monitor(id, { params }));
    expect(summary.alerts).toBe(1);
    expect(db.select({ alerts: runs.alerts }).from(runs).get()).toEqual({ alerts: 1 });
  });
});
