import type { AiTask } from '@brique/core/types';
import type { AiTriagePort, TriageInput, TriageVerdict } from '@brique/core/ai-port';
import type { AiCachePort, AiDeferredPort, AiLogPort, AiOptions, AiState } from './ports';
import { cacheKey } from './canonical';
import { loadCombos, type Combos } from './combos';
import { parseVerdicts, regexVerdicts, REPAIR_INSTRUCTION, type ParsedVerdicts } from './parse';

const BATCH = 12;
const DEFAULT_LIMITS: Record<AiTask, number> = {
  'triage.batch': 200,
  'normalize.product': 100,
  'audit.vision': 40,
  'negotiate.chat': 0,
};

const SYSTEM = {
  'triage.batch': 'Você audita anúncios de revenda. Responda somente JSON com verdicts: listingId, verdict (pass/veto/unavailable) e reasons (array de strings). Veto apenas com indício concreto de golpe, dano físico ou peça incompleta descrita no texto. Nunca invente informação.',
  'normalize.product': 'Extraia marca, modelo e variante do título. Responda somente JSON.',
  'audit.vision': 'Avalie fotos de produto. Responda somente JSON.',
  'negotiate.chat': 'Reservado; não usado.',
} as const;

const unavailable = (reasons: string[] = []): TriageVerdict => ({ verdict: 'unavailable', reasons });

/** Porta padrão: mantém o comportamento antigo quando o chamador não injeta a fila SQLite. */
function memoryDeferred(): AiDeferredPort {
  let items: TriageInput[] = [];
  return {
    list: () => [...items],
    push: (next) => {
      const byId = new Map(items.map((i) => [i.listingId, i]));
      for (const item of next) byId.set(item.listingId, item);
      items = [...byId.values()];
    },
    remove: (ids) => {
      const gone = new Set(ids);
      items = items.filter((i) => !gone.has(i.listingId));
    },
  };
}

function validVerdict(value: unknown): value is TriageVerdict {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<TriageVerdict>;
  return (v.verdict === 'pass' || v.verdict === 'veto' || v.verdict === 'unavailable')
    && Array.isArray(v.reasons);
}

/** Prompt enxuto da §7.4.4: rawPayload nunca entra no corpo da requisição. */
export function leanInput(item: TriageInput): Record<string, unknown> {
  return {
    listingId: item.listingId,
    externalId: item.externalId,
    title: item.title,
    askingCents: item.askingCents,
    city: item.city ?? null,
    description: (item.description ?? '').slice(0, 800),
    attributes: item.attributes ?? null,
    imageUrls: (item.imageUrls ?? []).slice(0, 3),
  };
}

function dayWindow(at: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

type AskResult =
  | { kind: 'answered'; parsed: ParsedVerdicts }
  | { kind: 'unparsed' }
  | { kind: 'blocked'; reason: 'budget' | 'circuit' | 'failed'; detail?: string };

export interface AiClient extends AiTriagePort {
  readonly paused: boolean;
  readonly queued: number;
  state(): AiState;
  remaining(task: AiTask): number;
}

export function createAi(opts: AiOptions): AiClient {
  const combos: Combos = opts.combos ?? loadCombos();
  const cache: AiCachePort | undefined = opts.cache;
  const log: AiLogPort | undefined = opts.log;
  const limits: Record<AiTask, number> = { ...DEFAULT_LIMITS, ...opts.limits };
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  const circuitMs = opts.circuitMs ?? 900_000;
  const failuresToOpen = opts.failuresToOpen ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/chat/completions`;
  const combo = combos['triage.batch'];

  const failures: Partial<Record<AiTask, number>> = {};
  const circuitOpenUntil: Partial<Record<AiTask, number>> = {};
  const deferred: AiDeferredPort = opts.deferred ?? memoryDeferred();
  let calls = 0;
  let cacheHits = 0;
  let paused = false;

  function remaining(task: AiTask): number {
    if (!log) return limits[task];
    const { from, to } = dayWindow(opts.clock());
    return Math.max(0, limits[task] - log.count(task, from, to));
  }

  function state(): AiState {
    return { calls, cacheHits, paused, queued: deferred.list().length, circuitOpenUntil: { ...circuitOpenUntil } };
  }

  function syncState(): void {
    const now = opts.clock().getTime();
    const open = Object.values(circuitOpenUntil).some((until) => until !== undefined && until > now);
    const next = open || remaining('triage.batch') === 0;
    if (next !== paused) {
      paused = next;
      opts.onState?.(state());
    }
  }

  function spend(batchSize: number, key: string, attempts: number): void {
    calls++;
    log?.append({
      task: 'triage.batch', status: 'ok', attempts, batchSize,
      cacheKey: key, createdAt: opts.clock(),
    });
    failures['triage.batch'] = 0;
    delete circuitOpenUntil['triage.batch'];
  }

  function fail(detail: string, attempts: number): void {
    const n = (failures['triage.batch'] ?? 0) + 1;
    failures['triage.batch'] = n;
    log?.append({
      task: 'triage.batch', status: 'failed', attempts, batchSize: 0,
      error: detail.slice(0, 200), createdAt: opts.clock(),
    });
    if (n >= failuresToOpen) circuitOpenUntil['triage.batch'] = opts.clock().getTime() + circuitMs;
  }

  function block(reason: 'budget' | 'circuit', batchSize: number, key: string): void {
    log?.append({
      task: 'triage.batch', status: reason, attempts: 0, batchSize, cacheKey: key,
      error: reason, createdAt: opts.clock(),
    });
  }

  function postBody(messages: Array<{ role: string; content: string }>): string {
    return JSON.stringify({
      model: combo.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    });
  }

  function postHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // Perfil agressivo só em lote; o OmniRoute faz a compressão no gateway.
      'x-omniroute-compression': 'aggressive',
    };
    if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
    return headers;
  }

  async function call(messages: Array<{ role: string; content: string }>): Promise<
    { ok: true; text: string; attempts: number } | { ok: false; error: string; attempts: number }
  > {
    const headers = postHeaders();
    const body = postBody(messages);
    const retryAfter = (attempt: number): Promise<void> =>
      sleep(Math.round(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 120));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res: { status: number; text: string; error?: string };
      try {
        res = await opts.post(endpoint, body, { headers });
      } catch (err) {
        if (attempt < maxAttempts) { await retryAfter(attempt); continue; }
        return { ok: false, error: (err as Error).message, attempts: attempt };
      }
      const retryable = res.error === 'timeout' || res.error === 'network'
        || res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxAttempts) { await retryAfter(attempt); continue; }
      if (res.error || res.status < 200 || res.status >= 300) {
        return { ok: false, error: res.error ?? `http ${res.status}`, attempts: attempt };
      }
      return { ok: true, text: res.text, attempts: attempt };
    }
    return { ok: false, error: 'tentativas-esgotadas', attempts: maxAttempts };
  }

  async function ask(batch: TriageInput[], key: string): Promise<AskResult> {
    const now = opts.clock().getTime();
    const circuitUntil = circuitOpenUntil['triage.batch'] ?? 0;
    if (circuitUntil > now) {
      block('circuit', batch.length, key);
      return { kind: 'blocked', reason: 'circuit' };
    }
    if (circuitUntil !== 0 && circuitUntil <= now) {
      delete circuitOpenUntil['triage.batch'];
      failures['triage.batch'] = 0;
    }
    if (remaining('triage.batch') <= 0) {
      block('budget', batch.length, key);
      return { kind: 'blocked', reason: 'budget' };
    }

    const expected = batch.map((i) => i.listingId);
    const payload = JSON.stringify({ items: batch.map(leanInput) });
    const messages = [{ role: 'system', content: SYSTEM['triage.batch'] }, { role: 'user', content: payload }];
    const first = await call(messages);
    if (!first.ok) {
      fail(first.error, first.attempts);
      return { kind: 'blocked', reason: 'failed', detail: first.error };
    }
    spend(batch.length, key, first.attempts);

    let parsed = parseVerdicts(first.text, expected);
    if (!parsed && remaining('triage.batch') > 0) {
      const repair = await call([
        ...messages,
        { role: 'user', content: `${REPAIR_INSTRUCTION} ${first.text}`.slice(0, 4_000) },
      ]);
      if (repair.ok) {
        spend(batch.length, key, repair.attempts);
        parsed = parseVerdicts(repair.text, expected);
      }
    }
    if (!parsed) parsed = regexVerdicts(first.text, expected);
    if (!parsed) {
      log?.append({
        task: 'triage.batch', status: 'unparsed', attempts: first.attempts,
        batchSize: batch.length, cacheKey: key, error: 'sem-json-valido', createdAt: opts.clock(),
      });
      return { kind: 'unparsed' };
    }
    return { kind: 'answered', parsed };
  }

  return {
    get calls() { return calls; },
    get cacheHits() { return cacheHits; },
    get paused() { return paused; },
    get queued() { return deferred.list().length; },
    state,
    remaining,
    async triage(items: TriageInput[]): Promise<Map<number, TriageVerdict>> {
      if (items.length === 0) return new Map();

      // A fila é memória do que não coube em passadas anteriores, não entrada desta.
      // Só os itens que o monitor trouxe agora têm destino para o veredito: o pipeline
      // lê o mapa pelos ids da passada. Um item ausente fica na fila, sem POST pago.
      const queue = [...new Map(items.map((i) => [i.listingId, i])).values()];

      const out = new Map<number, TriageVerdict>();
      const misses: TriageInput[] = [];
      const keys = new Map<number, string>();
      const resolved: number[] = [];
      const blocked: TriageInput[] = [];
      for (const item of queue) {
        const key = cacheKey('triage.batch', combo.name, leanInput(item));
        keys.set(item.listingId, key);
        const cached = cache?.get(key);
        if (validVerdict(cached)) {
          out.set(item.listingId, cached);
          resolved.push(item.listingId);
          cacheHits++;
          log?.append({
            task: 'triage.batch', status: 'cache-hit', attempts: 0, batchSize: 1,
            cacheKey: key, createdAt: opts.clock(),
          });
          continue;
        }
        misses.push(item);
      }

      for (let i = 0; i < misses.length; i += BATCH) {
        const batch = misses.slice(i, i + BATCH) as TriageInput[];
        const key = `${combo.name}:${batch.map((b) => keys.get(b.listingId)).join(',')}`;
        const answer = await ask(batch, key);
        for (const item of batch) {
          const verdict = answer.kind === 'answered' ? answer.parsed.verdicts.get(item.listingId) : undefined;
          if (verdict) {
            // Veredito explícito do modelo (inclusive unavailable com motivos)
            // é preservado; só caches de opinião real para não cobrar de novo.
            out.set(item.listingId, verdict);
            resolved.push(item.listingId);
            if (verdict.verdict !== 'unavailable') {
              cache?.set(keys.get(item.listingId)!, verdict, {
                task: 'triage.batch', combo: combo.name, createdAt: opts.clock(),
              });
            }
          } else if (answer.kind === 'blocked') {
            blocked.push(item);
            out.set(item.listingId, unavailable([`ia-${answer.reason}`]));
          } else {
            resolved.push(item.listingId);
            out.set(item.listingId, unavailable(['ia-sem-opiniao']));
          }
        }
      }

      // Remove só o que foi respondido e reenfileira o que ficou sem janela.
      // Um crash entre as duas operações no máximo repete uma consulta já paga.
      deferred.remove([...new Set(resolved)]);
      deferred.push(blocked);
      syncState();
      for (const item of items) if (!out.has(item.listingId)) out.set(item.listingId, unavailable());
      return out;
    },
  };
}
