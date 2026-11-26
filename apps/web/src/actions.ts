'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loadSettings } from '@brique/core/db/client-helpers';
import { parsePriceBRL } from '@brique/core/money';
import { actions as coreActions, type ActionResult } from '@brique/core/repo/actions';
import type { MonitorWrite } from '@brique/core/db/repo/monitors';
import type { Category, SourceId } from '@brique/core/types';
import { webDb } from './db';
import { parseSettingsForm } from './settings-form';

const CATEGORIES: Category[] = ['celular', 'notebook', 'console', 'bicicleta', 'autopeca', 'outro'];
const SOURCES: SourceId[] = ['olx', 'meli', 'enjoei', 'facebook'];

function int(fd: FormData, key: string): number {
  const raw = String(fd.get(key) ?? '');
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} deve ser número`);
  return value;
}

function cents(fd: FormData, key: string): number {
  const parsed = parsePriceBRL(String(fd.get(key) ?? ''));
  if (!parsed.ok) throw new Error(`${key}: ${parsed.reason}`);
  return parsed.cents;
}

function date(fd: FormData, key: string): Date {
  const raw = String(fd.get(key) ?? '');
  // input[type=date] é dia local; meio-dia UTC evita o dia anterior na tz de exibição.
  const value = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) throw new Error(`${key} inválida`);
  return value;
}

function source(fd: FormData): SourceId {
  const value = String(fd.get('source') ?? '') as SourceId;
  if (!SOURCES.includes(value)) throw new Error('fonte inválida');
  return value;
}

function category(fd: FormData): Category | null {
  const value = String(fd.get('category') ?? '');
  if (value === '') return null;
  if (!CATEGORIES.includes(value as Category)) throw new Error('categoria inválida');
  return value as Category;
}

function params(fd: FormData): MonitorWrite['params'] {
  const raw = String(fd.get('params') ?? '{}').trim() || '{}';
  try {
    const value = JSON.parse(raw) as MonitorWrite['params'];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('objeto esperado');
    return value;
  } catch (e) {
    throw new Error(`params inválido: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function finish(path: string, result: ActionResult): never {
  revalidatePath(path);
  revalidatePath('/');
  const query = result.ok ? '?ok=1' : `?error=${encodeURIComponent(result.error)}`;
  redirect(`${path}${query}`);
}

function attempt(path: string, fn: () => ActionResult): never {
  let result: ActionResult;
  try { result = fn(); } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // redirect lança uma exceção de controle de fluxo: ela fica fora do try.
  return finish(path, result);
}

export async function markBoughtAction(fd: FormData): Promise<void> {
  attempt('/deals', () => coreActions.markBought(webDb(), { listingId: int(fd, 'listingId') }));
}

export async function markIgnoredAction(fd: FormData): Promise<void> {
  attempt('/deals', () => coreActions.markIgnored(webDb(), { listingId: int(fd, 'listingId') }));
}

export async function markFavoriteAction(fd: FormData): Promise<void> {
  attempt('/deals', () => coreActions.markFavorite(webDb(), {
    listingId: int(fd, 'listingId'), favorite: fd.get('favorite') === 'true',
  }));
}

export async function recordPurchaseAction(fd: FormData): Promise<void> {
  const listingId = int(fd, 'listingId');
  const fpRaw = String(fd.get('fingerprintId') ?? '').trim();
  attempt(`/listing/${listingId}`, () => coreActions.recordPurchase(webDb(), {
    label: String(fd.get('label') ?? '').trim(),
    category: category(fd) ?? 'outro',
    paidCents: cents(fd, 'paid'),
    boughtAt: date(fd, 'boughtAt'),
    listingId,
    fingerprintId: fpRaw === '' ? null : Number(fpRaw),
  }));
}

export async function createMonitorAction(fd: FormData): Promise<void> {
  attempt('/monitors', () => coreActions.createMonitor(webDb(), {
    label: String(fd.get('label') ?? '').trim(),
    source: source(fd),
    query: String(fd.get('query') ?? '').trim(),
    category: category(fd),
    params: params(fd),
    intervalMinutes: int(fd, 'intervalMinutes'),
  }));
}

export async function updateMonitorAction(fd: FormData): Promise<void> {
  const id = int(fd, 'id');
  attempt('/monitors', () => coreActions.updateMonitor(webDb(), id, {
    label: String(fd.get('label') ?? '').trim(),
    source: source(fd),
    query: String(fd.get('query') ?? '').trim(),
    category: category(fd),
    params: params(fd),
    intervalMinutes: int(fd, 'intervalMinutes'),
    active: fd.get('active') === 'true',
  }));
}

export async function setActiveMonitorAction(fd: FormData): Promise<void> {
  attempt('/monitors', () => coreActions.setActiveMonitor(webDb(), int(fd, 'id'), fd.get('active') === 'true'));
}

export async function deleteMonitorAction(fd: FormData): Promise<void> {
  attempt('/monitors', () => coreActions.deleteMonitor(webDb(), int(fd, 'id')));
}

export async function recordSaleAction(fd: FormData): Promise<void> {
  attempt('/inventory', () => {
    const db = webDb();
    return coreActions.recordSale(db, {
      purchaseId: int(fd, 'purchaseId'),
      soldCents: cents(fd, 'sold'),
      platform: String(fd.get('platform') ?? '').trim(),
      soldAt: date(fd, 'soldAt'),
    }, loadSettings(db));
  });
}

export async function setSettingsAction(fd: FormData): Promise<void> {
  attempt('/settings', () => coreActions.setSettings(webDb(), parseSettingsForm(fd)));
}
