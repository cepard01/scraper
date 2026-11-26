import type { Db } from '../db/client';
import { getListing, setFavorite, setStatus } from '../db/repo/listings';
import { listDealAlertsForListing, setDealAlertAction } from '../db/repo/alerts';
import {
  createMonitor, deleteMonitor, getMonitor, setActiveMonitor, updateMonitor,
  type MonitorPatch, type MonitorWrite,
} from '../db/repo/monitors';
import { insertPurchase, recordSale as repoRecordSale, type NewPurchase, type NewSale } from '../db/repo/giro';
import { setSettings as repoSetSettings } from '../db/seed-settings';
import type { AlertAction, Settings } from '../types';

export type ActionResult = { ok: true; id?: number } | { ok: false; error: string };

const BUSY = /SQLITE_BUSY|database is locked/i;
const isBusy = (e: unknown): boolean =>
  e instanceof Error && (BUSY.test(e.message) || (e as { code?: string }).code === 'SQLITE_BUSY');

/** busy_timeout já espera 5 s; este retry cobre o "database is locked" que sobe depois. */
export function withBusyRetry<T>(fn: () => T, attempts = 3): T {
  const total = Math.max(1, attempts);
  let last: unknown;
  for (let attempt = 1; attempt <= total; attempt++) {
    try { return fn(); } catch (e) {
      last = e;
      if (!isBusy(e) || attempt === total) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * attempt);
    }
  }
  throw last;
}

function run(fn: () => number | void): ActionResult {
  try {
    const id = withBusyRetry(fn);
    return typeof id === 'number' ? { ok: true, id } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function requireListing(db: Db, listingId: number) {
  const row = getListing(db, listingId);
  if (!row) throw new Error(`anúncio ${listingId} não encontrado`);
  return row;
}

function annotateLatestAlert(db: Db, listingId: number, action: AlertAction, at: Date): void {
  const latest = listDealAlertsForListing(db, listingId)[0];
  if (latest) setDealAlertAction(db, latest.id, action, { at });
}

/** Única porta de escrita do web: cada método devolve ActionResult em vez de lançar. */
export const actions = {
  markBought(db: Db, args: { listingId: number; at?: Date }): ActionResult {
    return run(() => {
      const at = args.at ?? new Date();
      requireListing(db, args.listingId);
      setStatus(db, args.listingId, 'bought');
      annotateLatestAlert(db, args.listingId, 'taken', at);
    });
  },

  markIgnored(db: Db, args: { listingId: number; at?: Date }): ActionResult {
    return run(() => {
      const at = args.at ?? new Date();
      requireListing(db, args.listingId);
      setStatus(db, args.listingId, 'ignored');
      annotateLatestAlert(db, args.listingId, 'ignored', at);
    });
  },

  markFavorite(db: Db, args: { listingId: number; favorite: boolean }): ActionResult {
    return run(() => {
      requireListing(db, args.listingId);
      setFavorite(db, args.listingId, args.favorite);
    });
  },

  createMonitor(db: Db, monitor: MonitorWrite): ActionResult {
    return run(() => createMonitor(db, monitor));
  },

  updateMonitor(db: Db, id: number, patch: MonitorPatch): ActionResult {
    return run(() => updateMonitor(db, id, patch, new Date()));
  },

  setActiveMonitor(db: Db, id: number, active: boolean): ActionResult {
    return run(() => {
      if (!getMonitor(db, id)) throw new Error(`monitor ${id} não encontrado`);
      setActiveMonitor(db, id, active, new Date());
    });
  },

  deleteMonitor(db: Db, id: number): ActionResult {
    return run(() => deleteMonitor(db, id));
  },

  recordPurchase(db: Db, purchase: NewPurchase): ActionResult {
    return run(() => insertPurchase(db, purchase));
  },

  recordSale(db: Db, sale: NewSale, settings: Settings): ActionResult {
    return run(() => repoRecordSale(db, sale, settings).id);
  },

  setSettings(db: Db, patch: Partial<Settings>): ActionResult {
    return run(() => { repoSetSettings(db, patch); });
  },
};
