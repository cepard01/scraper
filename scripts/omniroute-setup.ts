import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '@brique/core/config';
import { loadCombos, type Combos } from '@brique/ai/combos';
import { createHttp, createHttpPost, type HttpGet, type HttpPost } from '@brique/scrapers/http';

/** `/v1` é a API de inferência; o setup usa o recurso de admin do mesmo gateway. */
export function adminUrlFrom(baseUrl: string, override: string | null): string {
  const raw = (override ?? baseUrl.replace(/\/v1\/?$/, '')).replace(/\/+$/, '');
  return raw.endsWith('/admin') ? raw : `${raw}/admin`;
}

/** Nomes apenas: nenhum token, chave ou URL de provedor volta no relatório. */
export function parseProviders(value: unknown): string[] {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const candidates = Array.isArray(value) ? value
    : Array.isArray(root.providers) ? root.providers : [];
  const names: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') { names.push(candidate); continue; }
    if (!candidate || typeof candidate !== 'object') continue;
    const p = candidate as Record<string, unknown>;
    const name = p.name ?? p.id ?? p.provider;
    const free = p.free === true || p.tier === 'free' || p.cost === 0 || p.paid === false;
    if (free && typeof name === 'string' && name.length > 0) names.push(name);
  }
  return [...new Set(names)];
}

export interface SetupResult {
  uploaded: string[];
  freeProviders: string[];
  errors: string[];
}

export async function runSetup(opts: {
  adminUrl: string;
  apiKey: string;
  combos: Combos;
  post: HttpPost;
  get: HttpGet;
}): Promise<SetupResult> {
  const admin = opts.adminUrl.replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` };
  const uploaded: string[] = [];
  const errors: string[] = [];

  for (const [task, combo] of Object.entries(opts.combos)) {
    const res = await opts.post(`${admin}/combos`, JSON.stringify({ task, ...combo }), { headers });
    if (res.status >= 200 && res.status < 300) uploaded.push(task);
    else errors.push(`${task}: http ${res.status}`);
  }

  const res = await opts.get(`${admin}/providers`, { headers });
  let freeProviders: string[] = [];
  if (res.status >= 200 && res.status < 300) {
    try { freeProviders = parseProviders(JSON.parse(res.text)); }
    catch { errors.push('providers: resposta nao-JSON'); }
  } else {
    errors.push(`providers: http ${res.status}`);
  }

  return { uploaded, freeProviders, errors };
}

export async function main(): Promise<void> {
  try { process.loadEnvFile(); } catch { /* systemd já trouxe o ambiente */ }
  const cfg = loadConfig();
  if (cfg.omniRoute.apiKey === null) {
    console.error('OMNIROUTE_API_KEY ausente — nenhum combo foi enviado.');
    process.exitCode = 1;
    return;
  }

  const combos = loadCombos();
  const adminUrl = adminUrlFrom(cfg.omniRoute.baseUrl, process.env.OMNIROUTE_ADMIN_URL ?? null);
  const post = createHttpPost({ timeoutMs: 10_000, maxAttempts: 2 });
  const get = createHttp({ userAgent: 'brique-omniroute-setup/1', timeoutMs: 10_000, maxAttempts: 2 });
  const result = await runSetup({ adminUrl, apiKey: cfg.omniRoute.apiKey, combos, post, get });

  console.log(`combos enviados: ${result.uploaded.join(', ') || 'nenhum'}`);
  console.log(`provedores gratuitos: ${result.freeProviders.join(', ') || 'nenhum identificado'}`);
  for (const detail of result.errors) console.error(`aviso: ${detail}`);
  if (result.uploaded.length !== Object.keys(combos).length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
