import { describe, it, expect } from 'vitest';
import {
  decideAlert, isSilentHours, shouldSendDigest, localHour, localDateKey,
  REALERT_MIN_DROP_PCT, DIGEST_HOUR_DEFAULT,
} from '../src/alerts';
import type { Confidence } from '../src/types';

const base = {
  listingId: 1,
  askingCents: 90_000,
  gatePassed: true,
  gateReason: 'ok' as const,
  confidence: 'high' as Confidence,
  marginPct: 0.5,
  floorMarginPct: 0.35,
  lastAlertCents: null as number | null,
};

describe('decideAlert', () => {
  it('gate reprovado nunca alerta e devolve o motivo do gate', () => {
    const d = decideAlert({ ...base, gatePassed: false, gateReason: 'abaixo-do-floor' });
    expect(d).toEqual({ shouldAlert: false, kind: null, dropPct: null, reason: 'abaixo-do-floor' });
  });

  it('amostra none nao alerta mesmo se o gate deixar passar', () => {
    const d = decideAlert({ ...base, confidence: 'none' });
    expect(d).toMatchObject({ shouldAlert: false, reason: 'amostra-insuficiente' });
  });

  it('confianca low exige margem de 2x o floor', () => {
    const abaixo = decideAlert({ ...base, confidence: 'low', marginPct: 0.69 });
    expect(abaixo).toMatchObject({ shouldAlert: false, reason: 'confianca-baixa' });

    const naLinha = decideAlert({ ...base, confidence: 'low', marginPct: 0.7 });
    expect(naLinha).toMatchObject({ shouldAlert: true, kind: 'novo' });
  });

  it('primeira cruzada alerta como novo, sem drop', () => {
    expect(decideAlert(base)).toEqual({ shouldAlert: true, kind: 'novo', dropPct: null, reason: null });
  });

  it('preco igual ao ultimo alerta nao re-alerta', () => {
    const d = decideAlert({ ...base, lastAlertCents: 90_000 });
    expect(d).toMatchObject({ shouldAlert: false, reason: 'sem-nova-cruzada' });
  });

  it('queda de 1% nao e novidade e nao re-alerta', () => {
    const d = decideAlert({ ...base, askingCents: 89_100, lastAlertCents: 90_000 });
    expect(d).toMatchObject({ shouldAlert: false, reason: 'queda-insuficiente' });
  });

  it('queda de 15% re-alerta relativa ao ultimo alerta, nao ao primeiro', () => {
    const d = decideAlert({ ...base, askingCents: 76_500, lastAlertCents: 90_000 });
    expect(d.shouldAlert).toBe(true);
    expect(d.kind).toBe('caiu');
    expect(d.dropPct).toBeCloseTo(0.15, 10);
  });

  it('o limiar de re-alerta e 10%, e ele e inclusivo', () => {
    const d = decideAlert({ ...base, askingCents: 90_000 * (1 - REALERT_MIN_DROP_PCT), lastAlertCents: 90_000 });
    expect(d).toMatchObject({ shouldAlert: true, kind: 'caiu' });
  });
});

describe('silent hours', () => {
  const TZ = 'America/Sao_Paulo';
  it('22:00 e 07:59 estao silenciosos, 08:00 e 21:59 nao', () => {
    expect(isSilentHours(new Date('2026-11-02T01:00:00Z'), TZ)).toBe(true);
    expect(isSilentHours(new Date('2026-11-02T10:59:00Z'), TZ)).toBe(true);
    expect(isSilentHours(new Date('2026-11-02T11:00:00Z'), TZ)).toBe(false);
    expect(isSilentHours(new Date('2026-11-03T00:59:00Z'), TZ)).toBe(false);
  });

  it('a hora e a data sao da tz de exibicao, nao de UTC', () => {
    const at = new Date('2026-11-02T01:00:00Z');
    expect(localHour(at, TZ)).toBe(22);
    expect(localDateKey(at, TZ)).toBe('2026-11-01');
  });
});

describe('shouldSendDigest', () => {
  const TZ = 'America/Sao_Paulo';
  const cfg = (over: Partial<{ hourLocal: number; lastDigestAt: Date | null }> = {}) =>
    ({ hourLocal: DIGEST_HOUR_DEFAULT, tz: TZ, lastDigestAt: null, ...over });

  it('antes da hora local nao envia', () => {
    expect(shouldSendDigest(new Date('2026-11-02T10:59:00Z'), cfg())).toBe(false);
  });

  it('na hora local, sem envio anterior, envia', () => {
    expect(shouldSendDigest(new Date('2026-11-02T12:00:00Z'), cfg())).toBe(true);
  });

  it('ja enviado no mesmo dia local nao repete', () => {
    expect(shouldSendDigest(new Date('2026-11-02T12:00:00Z'), cfg({ lastDigestAt: new Date('2026-11-02T11:30:00Z') }))).toBe(false);
  });

  it('no dia seguinte volta a enviar, mesmo antes da hora se a hora ja passou', () => {
    expect(shouldSendDigest(new Date('2026-11-03T12:00:00Z'), cfg({ lastDigestAt: new Date('2026-11-02T11:30:00Z') }))).toBe(true);
  });
});
