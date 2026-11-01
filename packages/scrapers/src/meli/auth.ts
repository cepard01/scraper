export const HOST = 'https://api.mercadolibre.com';
export const LIMIT = 50;
export const MAX_PAGES = 4;

export const meliHeaders = (token: string | null): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};

export const searchUrl = (unit: string, query: string, limit: number, offset: number): string => {
  const q = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) });
  return `${HOST}/sites/${unit}/search?${q.toString()}`;
};

export const itemUrl = (externalId: string): string => `${HOST}/items/${externalId}`;
