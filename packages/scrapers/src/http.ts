export interface HttpResult {
  status: number;
  text: string;
  error?: 'timeout' | 'network' | 'http';
  json: <T>() => T;
}

export type FetchLike = (url: string, init?: {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}) => Promise<{ status: number; body: string }>;

export interface HttpOpts {
  userAgent: string;
  timeoutMs?: number;
  jitterMs?: [number, number];
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: FetchLike;
}

export type HttpGet = (url: string, init?: { headers?: Record<string, string> }) => Promise<HttpResult>;

export interface HttpPostOpts { timeoutMs?: number; maxAttempts?: number; baseDelayMs?: number }
export type HttpPost = (url: string, body: string, init?: { headers?: Record<string, string> }) => Promise<HttpResult>;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function jitter(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function createHttp(opts: HttpOpts): HttpGet {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  const [jMin, jMax] = opts.jitterMs ?? [0, 0];
  const doFetch: FetchLike = opts.fetchImpl ?? (async (url, init) => {
    const res = await fetch(url, init);
    return { status: res.status, body: await res.text() };
  });

  return async (url, init) => {
    if (jMax > 0) await sleep(jitter(jMin, jMax));
    let last: HttpResult = { status: 0, text: '', error: 'network', json: () => JSON.parse('null') };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await doFetch(url, {
          headers: { 'user-agent': opts.userAgent, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', ...init?.headers },
          signal: ac.signal,
        });
        if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
          last = { status: res.status, text: res.body, error: 'http', json: () => JSON.parse('null') };
          await sleep(baseDelayMs * 2 ** (attempt - 1) + jitter(0, 250));
          continue;
        }
        const text = res.body;
        return { status: res.status, text, error: res.status >= 400 ? 'http' : undefined, json: <T>(): T => JSON.parse(text) as T };
      } catch (err) {
        const isTimeout = (err as Error).name === 'AbortError';
        last = { status: 0, text: '', error: isTimeout ? 'timeout' : 'network', json: () => JSON.parse('null') };
        if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
      }
    }
    return last;
  };
}

export function createHttpPost(opts: HttpPostOpts & { fetchImpl?: FetchLike }): HttpPost {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  const doFetch: FetchLike = opts.fetchImpl ?? (async (url, init) => {
    const res = await fetch(url, init);
    return { status: res.status, body: await res.text() };
  });

  return async (url, body, init) => {
    let last: HttpResult = { status: 0, text: '', error: 'network', json: () => JSON.parse('null') };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await doFetch(url, {
          method: 'POST',
          body,
          headers: init?.headers,
          signal: ac.signal,
        });
        if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
          last = { status: res.status, text: res.body, error: 'http', json: () => JSON.parse('null') };
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        const text = res.body;
        return { status: res.status, text, error: res.status >= 400 ? 'http' : undefined, json: <T>(): T => JSON.parse(text) as T };
      } catch (err) {
        const isTimeout = (err as Error).name === 'AbortError';
        last = { status: 0, text: '', error: isTimeout ? 'timeout' : 'network', json: () => JSON.parse('null') };
        if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
      }
    }
    return last;
  };
}
