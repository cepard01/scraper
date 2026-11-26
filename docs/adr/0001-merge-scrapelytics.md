# ADR 0001 — decisões do merge Scrapelytics → Brique (2026-11-26)

## 1. RSC (`self.__next_f.push`) é a estratégia primária do parser OLX

**Contexto.** Probe em 2026-11-26 em `olx.com.br/estado-rj?q=iphone 15&sf=1` retornou 200 com
`self.__next_f.push` e `listId`, sem `__NEXT_DATA__` e sem `"ads"` no HTML cru. O parser antigo
(`parseNextData`) produziu `raws 0` na página viva.

**Decisão.** `parseOlxPage` tenta o flight RSC primeiro, depois `__NEXT_DATA__`, por fim cards HTML.
`parserVersion` passa a ser `olx-rsc-2026-11`; URL de busca usa `sf=1` e paginação `o=N`.
A paginação vem de `MonitorParams.pages` com teto `MAX_PAGES`, e a pausa entre páginas de
`MonitorParams.pageDelayMs`, herdando o jitter de `createHttp`.

**Consequência.** Fixtures gravadas e contract tests sem rede. Se o health check de fonte acusar
degradação de yield, a próxima decisão é avaliar Playwright — não reintroduzir `__NEXT_DATA__`
como estratégia primária.

## 2. `watches.yaml` é formato de importação, não config de runtime

**Contexto.** O Scrapelytics lia YAML no boot e mantinha seu próprio scheduler/SQLite. O Brique já
tem `search_monitor` no banco, `core/scheduler.ts` dono do ciclo e `.env` zod para segredos.

**Decisão.** `scripts/seed-watches.ts` lê o YAML uma vez e insere monitores de forma idempotente
(`label + source + query`). O YAML não é lido em runtime, não guarda segredo e não define webhook.
`filters.requireWords`, `deal.belowMedianPct` e `deal.minSamples` viajam em `MonitorParams`;
`filters.maxPrice` também alimenta `manualCeilingCents` para cold start. A cadência persistida
respeita o piso de 15 min do Brique mesmo quando o YAML pede 3.

**Consequência.** Config do dia a dia passa a ser banco + `.env`. O YAML serve apenas para
semear os dois watches validados; o histórico do SQLite antigo não é migrado.
