import { describe, expect, it } from 'vitest';
import { openDb, migrateDb, seedSettings, DEFAULT_SETTINGS, loadSettings } from '@brique/core/db/client-helpers';
import type { HttpPost } from '@brique/scrapers/http';
import { createWorkerAi } from '../src/ai';

const NOW = new Date('2026-11-26T12:00:00Z');
const item = { listingId: 1, externalId: 'ext-1', title: 'iPhone 12 128GB', askingCents: 250_000 };

const postOf = (text: string) => {
  const calls: string[] = [];
  const post: HttpPost = async (url, body) => { calls.push(url); return { status: 200, text, json: () => JSON.parse(text) }; };
  return { post, calls };
};

const answer = JSON.stringify({ verdicts: [{ listingId: 1, verdict: 'pass', reasons: ['ok'] }] });

const base = () => {
  const { db } = openDb(':memory:');
  migrateDb(db);
  seedSettings(db, DEFAULT_SETTINGS);
  return { db, settings: loadSettings(db) };
};

describe('createWorkerAi', () => {
  it('sem chave devolve porte nulo e não faz POST', async () => {
    const { db, settings } = base();
    const { post, calls } = postOf(answer);
    const { ai, configured } = createWorkerAi({
      db, settings, post, omniRoute: { baseUrl: 'http://127.0.0.1:20128/v1', apiKey: null }, clock: () => NOW,
    });

    const out = await ai.triage([item]);

    expect(configured).toBe(false);
    expect(out.get(1)?.verdict).toBe('unavailable');
    expect(calls).toHaveLength(0);
    expect(ai.calls).toBe(0);
  });

  it('com chave usa cache do banco: segunda passada não repete o POST', async () => {
    const { db, settings } = base();
    const { post, calls } = postOf(answer);
    const { ai, configured } = createWorkerAi({
      db, settings, post, omniRoute: { baseUrl: 'http://127.0.0.1:20128/v1/', apiKey: 'teste' }, clock: () => NOW,
    });

    const first = await ai.triage([item]);
    const second = await ai.triage([item]);

    expect(configured).toBe(true);
    expect(first.get(1)?.verdict).toBe('pass');
    expect(second.get(1)?.verdict).toBe('pass');
    expect(calls).toHaveLength(1);
    expect(ai.calls).toBe(1);
    expect(ai.cacheHits).toBe(1);
  });

  it('espelha aiPaused no setting quando o orçamento zera', async () => {
    const { db, settings } = base();
    const { post } = postOf(answer);
    const { ai } = createWorkerAi({
      db, settings: { ...settings, aiDailyLimits: { ...settings.aiDailyLimits, 'triage.batch': 0 } },
      post, omniRoute: { baseUrl: 'http://127.0.0.1:20128/v1', apiKey: 'teste' }, clock: () => NOW,
    });

    await ai.triage([item]);

    expect((ai as unknown as { paused: boolean }).paused).toBe(true);
    expect(loadSettings(db).aiPaused).toBe(true);
  });
});
