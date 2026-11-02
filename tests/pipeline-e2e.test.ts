import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS } from '@brique/core/db/client-helpers';
import { runMonitor } from '@brique/core/pipeline';
import { nullAiPort } from '@brique/core/ai-port';
import { localAskingProvider } from '@brique/core/valuation/comparables';
import { listShortlistedRanked } from '@brique/core/db/repo/opportunities';
import { createMonitor } from '@brique/core/db/repo/monitors';
import { listings, opportunities } from '@brique/core/db/schema';
import { printShortlist } from '../packages/worker/src/cli';
import { DAY1 } from './feed/day1';

const NOW = new Date('2026-10-05T12:00:00Z');

describe('feed day1', () => {
  it('ranqueia os finalistas e congela a ordem', async () => {
    const { db } = openDb(':memory:');
    migrateDb(db);
    seedSettings(db, DEFAULT_SETTINGS);

    // Nada é pré-inserido: fingerprint, listing, valuation e oportunidade nascem todos da
    // passada. Pré-inserir listings deixaria o feed inteiro em 'unchanged' e o teste verde
    // sem avaliar nada.
    const monitorId = createMonitor(db, { label: 'day1', source: 'olx', query: 'day1', category: null, params: {}, intervalMinutes: 30 });
    const ai = nullAiPort();
    const summary = await runMonitor({
      db, settings: DEFAULT_SETTINGS,
      adapter: {
        id: 'olx', parserVersion: 'test-1',
        async health() { return { ok: true }; },
        async search() { return DAY1.map((i) => ({ source: i.source, externalId: i.externalId, url: i.url, fetchedAt: NOW, payload: i })); },
        async fetchOne() { throw new Error('n/a'); },
        toListingInput(raw) { return raw.payload as never; },
      },
      ai, comparables: localAskingProvider, now: () => NOW,
    }, { id: monitorId, label: 'day1', source: 'olx', query: 'day1', category: null, params: {}, intervalMinutes: 30, active: true, lastRunAt: null, lastYield: 0 });

    expect(ai.calls).toBe(0);
    expect(summary.created).toBe(DAY1.length);
    expect(summary.rejected).toEqual({});
    expect(summary.unmatched).toBe(2);

    const ranked = listShortlistedRanked(db, 20);
    console.log(printShortlist(ranked));
    expect(ranked.map((r) => r.externalId)).toMatchSnapshot();

    // o conjunto é afirmado, não só congelado: se o snapshot nascer errado, isto quebra primeiro
    expect([...ranked.map((r) => r.externalId)].sort()).toEqual(['DEAL-A', 'DEAL-C', 'DEAL-D']);

    const rows = db.select({
      externalId: listings.externalId,
      gatePassed: opportunities.gatePassed,
      gateReason: opportunities.gateReason,
    }).from(opportunities)
      .innerJoin(listings, eq(listings.id, opportunities.listingId))
      .all();

    expect(rows.find((r) => r.externalId === 'DEAL-B')).toEqual({ externalId: 'DEAL-B', gatePassed: false, gateReason: 'abaixo-do-floor' });
    expect(rows.find((r) => r.externalId === 'DEAL-E')).toEqual({ externalId: 'DEAL-E', gatePassed: false, gateReason: 'amostra-insuficiente' });
    expect(rows.filter((r) => r.externalId.startsWith('NOISE'))).toEqual([]);
  });
});
