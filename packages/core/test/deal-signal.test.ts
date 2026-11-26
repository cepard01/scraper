import { describe, expect, it } from 'vitest';
import { DEAL_PRIORITY, DEAL_TAGS, evaluateDealSignal, formatDealMessage } from '../src/deal-signal';
import type { MonitorParams } from '../src/types';

const params = (over: MonitorParams = {}): MonitorParams => ({ ...over });

describe('evaluateDealSignal', () => {
  it('com 15 amostras usa a mediana e o desconto do watch', () => {
    const s = evaluateDealSignal({
      priceCents: 250_000, medianCents: 400_000, samples: 15,
      params: params({ manualCeilingCents: 450_000 }),
    });
    expect(s).toEqual({
      deal: true, priceCents: 250_000, baselineCents: 400_000,
      belowPct: 37.5, basis: 'median', samples: 15,
    });
  });

  it('abaixo do minSamples cai para o teto manual do cold start', () => {
    const s = evaluateDealSignal({
      priceCents: 200_000, medianCents: 400_000, samples: 2,
      params: params({ manualCeilingCents: 450_000, minSamples: 15 }),
    });
    expect(s).toMatchObject({ deal: true, basis: 'manual', baselineCents: 450_000, samples: 2 });
    expect(s.belowPct).toBe(55.6);
  });

  it('sem mediana confiável e sem teto não inventa base', () => {
    const s = evaluateDealSignal({ priceCents: 100, medianCents: null, samples: 0, params: params() });
    expect(s).toEqual({
      deal: false, priceCents: 100, baselineCents: null, belowPct: null, basis: 'manual', samples: 0,
    });
  });

  it('respeita belowMedianPct por monitor', () => {
    const args = { priceCents: 250_000, medianCents: 400_000, samples: 20 };
    expect(evaluateDealSignal({ ...args, params: params({ belowMedianPct: 35 }) }).deal).toBe(true);
    expect(evaluateDealSignal({ ...args, params: params({ belowMedianPct: 40 }) }).deal).toBe(false);
  });

  it('um preço igual à base não é oferta', () => {
    const s = evaluateDealSignal({ priceCents: 400_000, medianCents: 400_000, samples: 20, params: params() });
    expect(s.deal).toBe(false);
    expect(s.belowPct).toBe(0);
  });

  it('minSamples customizeable por monitor', () => {
    const s = evaluateDealSignal({
      priceCents: 100_000, medianCents: 400_000, samples: 4,
      params: params({ minSamples: 3 }),
    });
    expect(s.basis).toBe('median');
  });
});

describe('formatDealMessage', () => {
  const signal = evaluateDealSignal({
    priceCents: 250_000, medianCents: 400_000, samples: 15, params: params(),
  });

  it('monta mensagem transporte-neutra sem perder o sinal', () => {
    const msg = formatDealMessage({
      monitor: { label: 'iphone-15-rj', params: params() },
      listing: { title: 'iPhone 15', url: 'https://olx/a/1', city: 'Rio de Janeiro', imageUrls: ['https://img/1.jpg'] },
      signal,
    });
    expect(msg.title).toContain('iPhone 15');
    expect(msg.tags).toEqual(DEAL_TAGS);
    expect(msg.priority).toBe(DEAL_PRIORITY);
    expect(msg.clickUrl).toBe('https://olx/a/1');
    expect(msg.body).toContain('37.5% abaixo da base');
    expect(msg.body).toContain('iphone-15-rj');
    expect(msg.body).toContain('mediana de 15 anúncios');
    expect(msg.body).toContain('Rio de Janeiro');
    expect(msg).not.toHaveProperty('discord');
  });
});
