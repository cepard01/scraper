export type Cents = number;
export type SourceId = 'olx' | 'meli' | 'enjoei' | 'facebook';
export type Category = 'celular' | 'notebook' | 'console' | 'bicicleta' | 'autopeca' | 'outro';
export type Grade = 'A' | 'B' | 'C' | 'D';
export type ListingStatus =
  | 'new' | 'repriced' | 'unchanged' | 'shortlisted' | 'ignored' | 'bought' | 'gone';
export type Confidence = 'low' | 'med' | 'high';
export type GateReason = 'ok' | 'abaixo-do-floor' | 'amostra-insuficiente' | 'sem-fingerprint' | 'preco-rejeitado';

export interface RawListing {
  source: SourceId;
  externalId: string;
  url: string;
  fetchedAt: Date;
  payload: unknown;
}

export interface ListingInput {
  source: SourceId;
  externalId: string;
  url: string;
  title: string;
  description: string;
  askingCents: Cents;
  askingRaw: string;
  city: string | null;
  uf: string | null;
  imageUrls: string[];
  sellerRef: string | null;
  publishedAt: Date | null;
}

export interface ParsedProduct {
  category: Category;
  brand: string | null;
  model: string | null;
  variant: string | null;
  grade: Grade;
  matched: boolean;
}

export interface MonitorParams {
  uf?: string;
  city?: string;
  minCents?: Cents;
  maxCents?: Cents;
  pages?: number;
  extraQuery?: string;
}

export interface SearchMonitor {
  id: number;
  label: string;
  source: SourceId;
  query: string;
  category: Category | null;
  params: MonitorParams;
  intervalMinutes: number;
  active: boolean;
  lastRunAt: Date | null;
  lastYield: number;
}

export interface Settings {
  delta: number;
  deltaMode: 'fixed' | 'measured';
  floorMarginPct: number;
  floorMarginCents: Cents;
  metaPerDayCents: Cents;
  metaDays: number;
  metaStaleDays: number;
  weights: { profit: number; liquidity: number; confidence: number; freshness: number };
  platformFeePct: Record<string, number>;
  taxPct: number;
  shippingInDefaultCents: Record<Category, Cents>;
  shippingOutDefaultCents: Record<Category, Cents>;
  repairDefaultCents: Record<Category, Cents>;
  liquidityDefaults: Record<Category, number>;
  maxPriceCents: Cents;
}

export interface Valuation {
  fingerprintId: number;
  sampleSize: number;
  medianCents: Cents | null;
  p25Cents: Cents | null;
  p75Cents: Cents | null;
  fairGrossCents: Cents | null;
  delta: number;
  liquidityDays: number;
  liquiditySource: 'own' | 'market' | 'category-default';
  confidence: Confidence;
  variantAgnostic: boolean;
  computedAt: Date;
}

// `type`, não `interface`: opportunities.breakdown é $type<Record<string, number>>
// (Task 3) e insertOpportunity escreve m.breakdown direto — uma interface não ganha
// índice implícito e o TypeScript recusa. O cast no repositório empurraria a conta
// para scoreOpportunity (Task 14), o produtor real do valor.
export type ScoreBreakdown = {
  profitFactor: number;
  liquidityFactor: number;
  confidenceFactor: number;
  freshnessFactor: number;
};

export interface OpportunityMath {
  askingCents: Cents;
  fairGrossCents: Cents | null;
  netRealizableCents: Cents | null;
  costsInCents: Cents;
  marginCents: Cents | null;
  marginPct: number | null;
  expectedPerDayCents: Cents | null;
  liquidityDays: number;
  score: number;
  breakdown: ScoreBreakdown;
}

export type PurchaseStatus = 'in_stock' | 'listed' | 'sold' | 'returned' | 'lost';

export interface Purchase {
  id: number; listingId: number | null; fingerprintId: number | null; label: string;
  category: Category; paidCents: Cents; shippingInCents: Cents; repairCents: Cents;
  otherCostsCents: Cents; feesInCents: Cents; refMedianCents: Cents | null;
  boughtAt: Date; status: PurchaseStatus; closedAt: Date | null; notes: string | null;
}

export interface Sale {
  id: number; purchaseId: number; soldCents: Cents; platform: string;
  platformFeeCents: Cents; shippingOutCents: Cents; otherCostsCents: Cents;
  soldAt: Date; buyerRef: string | null;
}
