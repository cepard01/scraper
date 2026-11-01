import { findComparables } from '../db/repo/listings';
import type { Db } from '../db/client';

export interface ComparableCtx {
  fingerprintId: number;
  windowDays: number;
  variantAgnostic: boolean;
  now: Date;
  excludeListingId?: number;
}

export interface Comparable {
  listingId: number;
  askingCents: number;
  sold: boolean;
}

export interface ComparablesProvider {
  readonly id: string;
  collect(db: Db, ctx: ComparableCtx): Comparable[];
}

export const localAskingProvider: ComparablesProvider = {
  id: 'local-asking',
  collect(db, ctx) {
    return findComparables(db, ctx.fingerprintId, ctx).map((c) => ({ ...c, sold: false }));
  },
};
