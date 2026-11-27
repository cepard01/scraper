import { describe, it, expect } from 'vitest';
import { aiKpiText, alertText, breakdownText, healthText, money, notice, pct, verdictText } from '../src/view';
import { parseSettingsForm } from '../src/settings-form';

describe('formatadores das rotas', () => {
  it('dinheiro e percentual mostram n/d sem transformar ausência em zero', () => {
    expect(money(123_456)).toBe('R$ 1.234,56');
    expect(money(-1_000)).toBe('-R$ 10,00');
    expect(money(null)).toBe('n/d');
    expect(pct(0.345)).toBe('35%');
    expect(pct(null)).toBe('n/d');
  });

  it('breakdown tem ordem fixa e não inventa fator ausente', () => {
    expect(breakdownText({ profitFactor: 1, liquidityFactor: 0.5, confidenceFactor: 0, freshnessFactor: 0.75 }))
      .toBe('lucro 100% · liquidez 50% · confiança 0% · frescor 75%');
    expect(breakdownText({})).toBe('lucro n/d · liquidez n/d · confiança n/d · frescor n/d');
  });

  it('veredito, alerta e saúde viram texto sem engolir o motivo', () => {
    expect(verdictText('veto', ['foto suspeta'])).toBe('veto: foto suspeta');
    expect(verdictText(null, [])).toBe('sem auditoria');
    expect(alertText('suppressed', 'silent-hours')).toBe('suprimido (silent-hours)');
    expect(alertText(null, null)).toBe('sem alerta');
    expect(healthText({ source: 'olx', degraded: true, detail: 'zero novos' }))
      .toBe('olx: degradado — zero novos');
  });

  it('KPI de IA não inventa 0% sem dados nem finge gateway desligado', () => {
    expect(aiKpiText({ configured: false, cacheHitPct: 0.5 })).toBe('IA desligada');
    expect(aiKpiText({ configured: true, cacheHitPct: null })).toBe('n/d');
    expect(aiKpiText({ configured: true, cacheHitPct: 0 })).toBe('0%');
    expect(aiKpiText({ configured: true, cacheHitPct: 0.25 })).toBe('25%');
  });

  it('notice prioriza erro e aceita valor único ou array do Router', () => {
    expect(notice({ error: 'falha', ok: '1' })).toEqual({ text: 'falha', bad: true });
    expect(notice({ error: ['falha'], ok: ['1'] })).toEqual({ text: 'falha', bad: true });
    expect(notice({ ok: '1' })).toEqual({ text: 'Salvo.', bad: false });
    expect(notice({})).toBeNull();
  });
});

describe('parseSettingsForm', () => {
  it('converte só os campos exibidos e deixa o resto para o merge do core', () => {
    const fd = new FormData();
    Object.entries({
      delta: '0.85', deltaMode: 'measured', floorMarginPct: '0.4', floorMarginCents: '6000',
      metaPerDayCents: '4000', metaDays: '14', metaStaleDays: '30', maxPriceCents: '200000000',
      digestHourLocal: '9', taxPct: '0', weight_profit: '0.45', weight_liquidity: '0.25',
      weight_confidence: '0.15', weight_freshness: '0.15', fee_meli: '0.16', fee_olx: '0', fee_pagofio: '0.05',
    }).forEach(([k, v]) => fd.set(k, v));
    const patch = parseSettingsForm(fd);
    expect(patch).toMatchObject({
      delta: 0.85, deltaMode: 'measured', floorMarginPct: 0.4,
      weights: { profit: 0.45, freshness: 0.15 }, platformFeePct: { meli: 0.16, olx: 0 },
    });
    expect(patch).not.toHaveProperty('shippingInDefaultCents');
    expect(patch).not.toHaveProperty('lastDigestAt');
  });

  it('não transforma campo vazio em zero silencioso', () => {
    const fd = new FormData();
    Object.entries({
      delta: '0.85', deltaMode: 'fixed', floorMarginPct: '0.4', floorMarginCents: '6000',
      metaPerDayCents: '4000', metaDays: '14', metaStaleDays: '30', maxPriceCents: '200000000',
      digestHourLocal: '9', taxPct: '0', weight_profit: '0.45', weight_liquidity: '0.25',
      weight_confidence: '0.15', weight_freshness: '0.15', fee_meli: '0.16', fee_olx: '0', fee_pagofio: '0.05',
    }).forEach(([k, v]) => fd.set(k, v));
    fd.set('floorMarginPct', '');
    expect(() => parseSettingsForm(fd)).toThrowError(/floorMarginPct deve ser número/);
  });
});
