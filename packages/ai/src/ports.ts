import type { AiTask } from '@brique/core/types';
import type { TriageInput } from '@brique/core/ai-port';
import type { HttpPost } from '@brique/scrapers/http';
import type { Combos } from './combos';

export interface AiCallEntry {
  task: AiTask;
  status: 'ok' | 'unparsed' | 'budget' | 'circuit' | 'failed' | 'cache-hit';
  attempts: number;
  batchSize: number;
  cacheKey?: string;
  error?: string;
  createdAt: Date;
}

export interface AiCachePort {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown, meta: { task: AiTask; combo: string; createdAt: Date }): void;
}

export interface AiLogPort {
  /** Chamadas já contabilizadas na janela diária; cache-hit não entra. */
  count(task: AiTask, from: Date, to: Date): number;
  append(entry: AiCallEntry): void;
}

/** Fila de itens postergados por cota/circuito; um listingId, uma entrada. */
export interface AiDeferredPort {
  list(): TriageInput[];
  push(items: TriageInput[]): void;
  remove(listingIds: number[]): void;
}

export interface AiState {
  calls: number;
  cacheHits: number;
  paused: boolean;
  queued: number;
  circuitOpenUntil: Partial<Record<AiTask, number>>;
}

export interface AiOptions {
  post: HttpPost;
  baseUrl: string;
  apiKey: string | null;
  clock: () => Date;
  limits?: Partial<Record<AiTask, number>>;
  cache?: AiCachePort;
  log?: AiLogPort;
  /** Ausente => fila em memória; o worker injeta a versão SQLite. */
  deferred?: AiDeferredPort;
  combos?: Combos;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  circuitMs?: number;
  failuresToOpen?: number;
  onState?: (state: AiState) => void;
}

export type { HttpPost };
