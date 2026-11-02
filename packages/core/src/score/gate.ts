import type { Confidence, GateReason, OpportunityMath, Settings } from '../types';

export interface GateArgs {
  math: OpportunityMath;
  sampleGate: 'ok' | 'insufficient';
  hasFingerprint: boolean;
  settings: Settings;
  confidence?: Confidence;
}

export function gate(args: GateArgs): { passed: boolean; reason: GateReason } {
  if (!args.hasFingerprint) return { passed: false, reason: 'sem-fingerprint' };
  if (args.sampleGate === 'insufficient') return { passed: false, reason: 'amostra-insuficiente' };

  const pct = args.math.marginPct;
  const cents = args.math.marginCents;
  if (pct === null || cents === null) return { passed: false, reason: 'abaixo-do-floor' };

  const pctFloor = args.confidence === 'low' ? args.settings.floorMarginPct * 2 : args.settings.floorMarginPct;
  if (pct >= pctFloor && cents >= args.settings.floorMarginCents) return { passed: true, reason: 'ok' };
  return { passed: false, reason: 'abaixo-do-floor' };
}
