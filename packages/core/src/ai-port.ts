import type { Cents } from './types';

export interface TriageInput {
  listingId: number;
  externalId: string;
  title: string;
  askingCents: Cents;
}

export interface TriageVerdict {
  verdict: 'pass' | 'veto' | 'unavailable';
  reasons: string[];
}

export interface AiTriagePort {
  calls: number;
  triage(items: TriageInput[]): Promise<Map<number, TriageVerdict>>;
}

export function nullAiPort(): AiTriagePort {
  return {
    calls: 0,
    async triage(items) {
      this.calls++;
      return new Map(items.map((i) => [i.listingId, { verdict: 'unavailable' as const, reasons: ['ia indisponivel nesta fase'] }]));
    },
  };
}
