import { mkdirSync, writeFileSync } from 'node:fs';
import { createHttp } from '../packages/scrapers/src/http';
import { buildSearchUrl } from '../packages/scrapers/src/olx/url';

const http = createHttp({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' });
const monitor = { id: 0, label: 'rec', source: 'olx' as const, query: 'iphone 12', category: 'celular' as const, params: {}, intervalMinutes: 30, active: true, lastRunAt: null, lastYield: 0 };
const res = await http(buildSearchUrl(monitor, 1));
mkdirSync('tests/fixtures/olx', { recursive: true });
writeFileSync(`tests/fixtures/olx/live-${Date.now()}.html`, res.text);
console.log('gravado', res.status, res.text.length, 'bytes');
