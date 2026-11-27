import type { Cents } from './types';

export interface TriageInput {
  listingId: number;
  externalId: string;
  title: string;
  askingCents: Cents;
  /** Campos enxutos do prompt (§7.4.4); rawPayload nunca entra. */
  description?: string;
  city?: string | null;
  imageUrls?: string[];
  attributes?: Record<string, string | null>;
}

export interface TriageVerdict {
  verdict: 'pass' | 'veto' | 'unavailable';
  reasons: string[];
}

export interface AiTriagePort {
  /** Chamadas de rede efetivas: cache hit não conta (§16.2). */
  calls: number;
  /** Itens respondidos pelo cache nesta instância. */
  cacheHits?: number;
  triage(items: TriageInput[]): Promise<Map<number, TriageVerdict>>;
}

/** Sem cliente OmniRoute: devolve "sem opinião" e não consome cota nem faz POST. */
export function nullAiPort(): AiTriagePort {
  return {
    calls: 0,
    cacheHits: 0,
    async triage(items) {
      return new Map(items.map((i) => [i.listingId, { verdict: 'unavailable' as const, reasons: ['ia indisponivel nesta fase'] }]));
    },
  };
}
