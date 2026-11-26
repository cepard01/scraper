import type { Settings } from '@brique/core/types';

export const formNumber = (fd: FormData, key: string): number => {
  const raw = String(fd.get(key) ?? '').trim();
  const value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) throw new Error(`${key} deve ser número (recebeu ${raw || 'vazio'})`);
  return value;
};

// Campos ausentes não são sobrescritos: o formulário mexe só no que mostra.
// Os defaults de categoria e os segredos de .env ficam fora deste patch.
export function parseSettingsForm(fd: FormData): Partial<Settings> {
  const text = (key: string) => String(fd.get(key) ?? '').trim();
  return {
    delta: formNumber(fd, 'delta'),
    deltaMode: text('deltaMode') as Settings['deltaMode'],
    floorMarginPct: formNumber(fd, 'floorMarginPct'),
    floorMarginCents: formNumber(fd, 'floorMarginCents'),
    metaPerDayCents: formNumber(fd, 'metaPerDayCents'),
    metaDays: formNumber(fd, 'metaDays'),
    metaStaleDays: formNumber(fd, 'metaStaleDays'),
    maxPriceCents: formNumber(fd, 'maxPriceCents'),
    digestHourLocal: formNumber(fd, 'digestHourLocal'),
    taxPct: formNumber(fd, 'taxPct'),
    weights: {
      profit: formNumber(fd, 'weight_profit'),
      liquidity: formNumber(fd, 'weight_liquidity'),
      confidence: formNumber(fd, 'weight_confidence'),
      freshness: formNumber(fd, 'weight_freshness'),
    },
    platformFeePct: {
      meli: formNumber(fd, 'fee_meli'),
      olx: formNumber(fd, 'fee_olx'),
      pagofio: formNumber(fd, 'fee_pagofio'),
    },
  };
}
