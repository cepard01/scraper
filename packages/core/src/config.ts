import { z } from 'zod';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OMNIROUTE_BASE_URL: z.string().default('http://127.0.0.1:20128/v1'),
  OMNIROUTE_API_KEY: z.string().optional(),
  MELI_ACCESS_TOKEN: z.string().optional(),
  MELI_UNIT: z.string().default('MLB'),
  NTFY_BASE_URL: z.string().default('https://ntfy.sh'),
  NTFY_TOPIC: z.string().optional(),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TZ_DISPLAY: z.string().default('America/Sao_Paulo'),
});

export interface Config {
  databaseUrl: string;
  sqlitePath: string;
  meliToken: string | null;
  meliUnit: string;
  omniRoute: { baseUrl: string; apiKey: string | null };
  ntfy: { baseUrl: string; topic: string | null };
  webPort: number;
  tz: string;
}

// emptyToNull e blankToUndefined cobrem bordas diferentes: o primeiro é o contrato de
// segredo (ausente ou vazio => null, e os consumidores decidem se isso desliga a fonte);
// o segundo existe só para o .default() do zod ver undefined. Nenhum substitui o outro.
const emptyToNull = (v: string | undefined): string | null => (v && v.length > 0 ? v : null);

// `MELI_UNIT=` vazio no .env chega como '', e zod só aplica .default() em undefined.
const blankToUndefined = (env: NodeJS.ProcessEnv): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]));

export function parseSqlitePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith('sqlite://')) {
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(databaseUrl)?.[1] ?? 'sem esquema';
    throw new ConfigError(`DATABASE_URL precisa começar com sqlite:// nesta fase (esquema recebido: "${scheme}"). Postgres chega na migração para VPS.`);
  }
  const path = databaseUrl.slice('sqlite://'.length);
  if (path.length === 0) {
    throw new ConfigError('DATABASE_URL precisa de um caminho depois de sqlite:// (ex.: sqlite://./data/brique.db).');
  }
  return path;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(blankToUndefined(env));
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => (i.path[0] ?? '?') as string).join(', ');
    throw new ConfigError(`config inválida, faltam/erradas: ${names}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    sqlitePath: parseSqlitePath(e.DATABASE_URL),
    meliToken: emptyToNull(e.MELI_ACCESS_TOKEN),
    meliUnit: e.MELI_UNIT,
    omniRoute: { baseUrl: e.OMNIROUTE_BASE_URL, apiKey: emptyToNull(e.OMNIROUTE_API_KEY) },
    ntfy: { baseUrl: e.NTFY_BASE_URL, topic: emptyToNull(e.NTFY_TOPIC) },
    webPort: e.WEB_PORT,
    tz: e.TZ_DISPLAY,
  };
}
