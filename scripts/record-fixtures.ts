import { mkdirSync, writeFileSync } from 'node:fs';
import { createHttp } from '../packages/scrapers/src/http';
import { buildSearchUrl } from '../packages/scrapers/src/olx/url';
import { looksLikeSearchResults, parseRscAds } from '../packages/scrapers/src/olx/extract';

const source = process.argv.find((a) => a.startsWith('--source='))?.slice('--source='.length) ?? 'olx';
if (source !== 'olx') throw new Error(`fixtures:record: fonte desconhecida "${source}" (nesta fase só olx)`);

const query = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'iphone 15';
const http = createHttp({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36',
  timeoutMs: 30_000,
  jitterMs: [1_500, 4_000],
});
const monitor = {
  id: 0, label: 'rec', source: 'olx' as const, query, category: 'celular' as const,
  params: { uf: 'RJ', pages: 1 }, intervalMinutes: 30, active: true,
  lastRunAt: null, lastYield: 0, mutedUntil: null,
};
const res = await http(buildSearchUrl(monitor, 1));
if (res.status !== 200) throw new Error(`fixtures:record: HTTP ${res.status}`);
if (!looksLikeSearchResults(res.text)) throw new Error('fixtures:record: página sem marcadores RSC — fonte degradada');
const ads = parseRscAds(res.text);
if (ads.length === 0) throw new Error('fixtures:record: zero anúncios no flight — nada para gravar');
mkdirSync('tests/fixtures/olx', { recursive: true });
writeFileSync('tests/fixtures/olx/live-olx.html', res.text);
console.log(`gravado ${ads.length} anúncios RSC, ${res.text.length} bytes -> tests/fixtures/olx/live-olx.html`);
