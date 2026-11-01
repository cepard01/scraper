import type { ListingInput, RawListing, SearchMonitor, SourceId } from './types';

// O teste do plano (Step 1) e os adapters importam ListingInput pelo caminho do
// contrato; sem o re-export, `@brique/core/adapter-contract` tiparia SourceAdapter
// mas não exporia os tipos que ele referencia.
export type { Cents, ListingInput, RawListing, SearchMonitor, SourceId } from './types';

export interface PriceRejection {
  rejected: true;
  reason: string;
  rawTitle: string;
}

export interface SourceAdapter {
  readonly id: SourceId;
  readonly parserVersion: string;
  health(): Promise<{ ok: boolean; reason?: string }>;
  search(monitor: SearchMonitor, since: Date): Promise<RawListing[]>;
  fetchOne(externalId: string): Promise<RawListing>;
  toListingInput(raw: RawListing): ListingInput | PriceRejection;
}

export function isRejected(x: ListingInput | PriceRejection): x is PriceRejection {
  return (x as PriceRejection).rejected === true;
}
