import { createHttpPost, type FetchLike, type HttpPost } from '@brique/scrapers/http';

export interface WorkerPosts {
  /** ntfy: duas tentativas no transporte, sem retry na camada de alerta. */
  post: HttpPost;
  /** IA: uma tentativa no transporte; retry com jitter e circuito vivem em packages/ai. */
  postAi: HttpPost;
}

export function createWorkerPosts(opts: {
  timeoutMs?: number;
  baseDelayMs?: number;
  fetchImpl?: FetchLike;
} = {}): WorkerPosts {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const common = { timeoutMs, baseDelayMs: opts.baseDelayMs, fetchImpl: opts.fetchImpl };
  return {
    post: createHttpPost({ ...common, maxAttempts: 2 }),
    postAi: createHttpPost({ ...common, maxAttempts: 1 }),
  };
}
