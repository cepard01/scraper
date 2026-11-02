# Brique — Spec 1: fatia vertical de ingestão, valoração, score, painel e alerta

**Data:** 2026-10-31
**Status:** aprovado em brainstorming, aguardando revisão escrita
**Escopo:** primeira fatia vertical. Não inclui scraper de Facebook/Enjoei nem negociação autônoma.

---

## 1. Objetivo

Sistema que varre marketplaces brasileiros em busca de anúncios compráveis com margem de revenda, calcula quanto o item vale de fato, ranqueia as oportunidades por retorno sobre capital e liquidez, avisa no celular, e registra o ciclo financeiro completo (compra → estoque → venda → lucro).

O produto desta spec é um pipeline que atravessa todas as camadas com duas fontes. As fontes restantes e a negociação autônoma são extensões sobre interfaces que já ficam definidas aqui.

**Domínio de negócio:** brique/flip de eletrônicos (celulares, notebooks, consoles) e de bicicleta/auto. Escolhidos porque ambos têm preço-referência publicamente observável, o que torna a margem calculável em vez de achismo.

### 1.1 O que este sistema faz

- Roda buscas agendadas em OLX e Mercado Livre segundo monitores que você configura
- Detecta anúncios novos e **quedas de preço** em anúncios já vistos
- Normaliza cada anúncio em um produto canônico (marca, modelo, variante, estado)
- Estima o valor real de revenda a partir de anúncios comparáveis no próprio banco
- Calcula margem, ROI sobre capital e reais-estimados-por-dia
- Filtra deterministicamente abaixo do seu piso de margem e manda os finalistas para IA
- Usa IA (via OmniRoute, modelos gratuitos) para auditar risco: indício de golpe, dano físico, peça incompleta, texto incoerente
- Notifica via ntfy e apresenta fila de oportunidades no painel
- Registra compras, vendas, estoque, lucro realizado, ROI e tempo de giro

### 1.2 O que deliberadamente não faz nesta spec

- Enviar mensagem a vendedor, negociar preço, operar conta do Facebook
- Comprar automaticamente
- Rodar em VPS ou com autenticação multiusuário
- Aprendizado de preço por embeddings ou visão computacional; a calibração é estatística sobre o seu histórico

---

## 2. Arquitetura

### 2.1 Decisão e rejeitadas

**Adotada:** monorepo pnpm com **dois processos** (`worker` e `web`) e o banco como ponto de integração. Nenhum HTTP interno entre eles.

Rejeitadas, com motivo registrado para não re-discutirmos:

- *Next.js all-in-one com scheduler in-process* — o scraper herda as restrições de ciclo de vida do servidor web, restart do dev server mata varredura, e a migração para VPS obrigaria extrair o scheduler de todo jeito.
- *Fila BullMQ + Redis* — o gargalo do sistema é cota de requisição de IA (~2 req/min nos maiores pools gratuitos), não concorrência de CPU. Fila distribuída para gargalo serial é complexidade sem ganho. Reavaliar se houver 6+ fontes distribuídas.

### 2.2 Layout

```
scraper/
  package.json                 pnpm workspace
  config/
    omniroute.combos.json      combos versionados + script de upload
  packages/
    core/                      domínio puro
      src/config.ts            zod env schema, fail-fast
      src/db/schema.ts         Drizzle schema
      src/db/repo/*.ts         repositórios (único lugar que escreve SQL)
      src/normalize/*.ts       preço pt-BR, fingerprint, dicionários por categoria
      src/valuation/*.ts       comparáveis, mediana aparada, delta, confiança, liquidez
      src/score/*.ts           custos, margem, expectedPerDay, score, breakdown, gate
      src/ai.ts                superfície de IA (complete/completeJson/vision)
      src/ai/combos.ts         mapeamento tarefa -> combo
      src/ai/budget.ts         token bucket, orçamento diário, circuit-open
      src/notify.ts            cliente ntfy
      src/types.ts
    scrapers/
      src/olx/adapter.ts       + olx/parse.ts, olx/fixtures
      src/meli/adapter.ts      + meli/auth.ts
      src/contract.ts          interface SourceAdapter e testes de contrato
    worker/
      src/index.ts             boot, scheduler serial
      src/pipeline.ts          ingestao -> normalize -> value -> score -> gate -> ai -> alert
      src/scheduler.ts
    web/                       Next.js (App Router, server components)
      src/app/...
docs/specs/        esta spec
tests/
  fixtures/<source>/*.json     payloads gravados, usados nos contract tests
  fixtures/feed-*.ts           "um dia" de anúncios sintéticos para golden test
```

### 2.3 Regra de dependência (invariantemente verificada)

```
scrapers -> core
worker   -> scrapers, core
web      -> core
core     -> (nada interno)
```

`core` **não** acessa marketplace nenhum: recebe `RawListing` já baixado. Consequência obrigatória: todo o motor de valoração e score é testável sem rede, o que é o que permite mexer nas fórmulas sem medo.

### 2.4 Contrato de fonte

```ts
export interface SourceAdapter {
  readonly id: 'olx' | 'meli' | 'enjoei' | 'facebook';
  readonly parserVersion: string;                       // ex.: 'olx-2026-10-31'
  health(): Promise<{ ok: boolean; reason?: string }>;
  search(monitor: SearchMonitor, since: Date): Promise<RawListing[]>;
  fetch(externalId: string): Promise<RawListing>;
  normalize(raw: RawListing): ListingInput;             // puro, testável por fixture
}

export interface RawListing {
  source: SourceAdapter['id'];
  externalId: string;
  url: string;
  fetchedAt: string;                                    // ISO UTC
  payload: unknown;                                     // resposta bruta, guardada p/ re-parse
}
```

Uma fonte nova é um adapter, não um projeto. O resto do sistema não conhece site nenhum.

### 2.5 Stack

TypeScript em todo o repo: Node 24 (o OmniRoute exige `>=22.22.2 <23` ou `>=24 <27`; Node 23 está fora), pnpm, Next.js App Router, Drizzle ORM, better-sqlite3 (WAL) com Postgres atrás do mesmo repositório na fase VPS, zod, Playwright para Node (não usado nesta spec; reservado para Facebook), http2/undici `fetch`, vitest.

Justificativa: preferência declarada do operador por TS; um runtime só elimina a classe de bug de fronteira entre linguagens; Playwright e a API do OmniRoute são de primeira classe em Node.

---

## 3. Modelo de dados

**Dinheiro é inteiro em centavos (`*Cents: number`). Nunca float.** Moeda padrão BRL. Datas armazenadas como epoch ms UTC (coluna `integer` `timestamp_ms`); serialização em ISO na borda externa; exibição em `America/Sao_Paulo`.

### 3.1 Tabelas

```
searchMonitor    id, label, source, query, category, params(json: cidade/uf, faixaPreco,
                 raioKm, filtrosLivres), intervalMinutes(>=15), active, lastRunAt,
                 lastYield, createdAt, updatedAt

listing          id, source, externalId, url, monitorId, fingerprint,
                 title, description, askingCents, conditionGrade, city, uf,
                 imageUrls(json), sellerRef, publishedAt, firstSeenAt, lastSeenAt,
                 status: new|repriced|unchanged|shortlisted|ignored|bought|gone
                 dupeOf(listingId|null), rawPayload(json), parserVersion

pricePoint       id, listingId, askingCents, observedAt            -- série temporal por anúncio

fingerprint      id, key(category|brand|model|variant|conditionGrade), category,
                 label, brand, model, variant, conditionGrade

valuation        id, fingerprint, sampleSize, medianCents, p25Cents, p75Cents,
                 sourceMix(json), delta, liquidityDays, liquiditySource,
                 confidence: low|med|high, computedAt

comparableRef    id, valuationId, listingId, askingCents, role: kept|trimmed|sold

opportunity      id, listingId, valuationId, askingCents, fairGrossCents,
                 costsInCents, netRealizableCents, marginCents, marginPct,
                 expectedPerDayCents, liquidityDays, score, breakdown(json),
                 gatePassed, gateReason, aiVerdict: pass|veto|unavailable|null,
                 aiReasons(json), aiModel, createdAt

aiCache          pk(cacheKey), task, combo, inputHash, outputJson, model,
                 tokensIn, tokensOut, latencyMs, createdAt

aiCallLog        id, task, combo, model, status: ok|429|5xx|timeout|unparsed|budget,
                 latencyMs, observedRpm, errorCode, createdAt

run              id, monitorId, startedAt, finishedAt, outcome: ok|partial|failed,
                 fetched, new, repriced, unchanged, rejected(json por motivo),
                 aiCalls, aiCacheHits, error

dealAlert        id, opportunityId, channel('ntfy'), deliveredAt, ackAt,
                 action: taken|ignored|snoozed, snoozeUntil

purchase         id, listingId|null, fingerprint|null, label, paidCents,
                 shippingInCents, repairCents, otherCostsCents, feesInCents,
                 boughtAt, status: in_stock|listed|sold|returned|lost, notes

sale             id, purchaseId, soldCents, platform, platformFeeCents,
                 shippingOutCents, otherCostsCents, soldAt, buyerRef

settings         key, value, updatedAt      -- floors, pesos, metas, canais
```

Views derivadas: `v_inventory`, `v_pnl_month`, `v_category_stats`.

**Ciclo de vida de `listing.status`** (cada valor tem um único significado, e um item só muda de status por passo explícito da pipeline ou por ação sua):

- `new` / `repriced` — entram na pipeline nesta passada
- `unchanged` — a passada encerra o item aqui; nunca chega a valuation ou IA
- `shortlisted` — passou no gate e sobreviveu ao veredito da IA
- `ignored` — vetado pela IA ou por você, com motivo gravado
- `bought` — virou `purchase`
- `gone` — não está mais disponível na fonte; fecha a `opportunity` correspondente

Regra: **nenhum cálculo de lucro em SQL espalhado pelas telas.** A fórmula vive em `core/score` e `core/pnl`; as views apenas agregam linhas já calculadas.

### 3.2 Chaves e unicidade

- `listing (source, externalId)` único — base da idempotência da pipeline
- `aiCache cacheKey` único — `sha256(task + combo + canonicalJson(input))`
- `pricePoint` índice em `(listingId, observedAt)`
- `fingerprint.key` único

---

## 4. Normalização e fingerprint

Pipeline determinística, **antes** de qualquer IA:

1. Preço pt-BR: aceita `R$ 1.234,56`, `1.234,56`, `1234.56`, `990`, `R$ 990,00`. Rejeita e registra motivo para `Grátis`, `Troco`, `0`, `A combinar`.
2. Limpeza de título: minúsculas, remoção de pontuação e de tokens de urgência (`URGENTE`, `CORRE`, `ÚLTIMA CHANCE`, emojis).
3. Classificador de categoria por dicionário + regex: celular, notebook, console, TV, bicicleta, autopeça, outro.
4. Extração de atributos por categoria. Celular: marca (Apple/Samsung/Xiaomi/Motorola/…), modelo, capacidade (64/128/256/512GB), cor opcional, `desbloqueado` vs operadora (Vivo/Claro/TIM), estado (lacrado / novo / usado-bom / marcas / defeito). Bicicleta: marca, aro, quadro, grupo de transmissão. Auto: marca, peça, código OEM quando presente, compatibilidade.
5. `conditionGrade` normalizado em `A` (novo/lacrado), `B` (usado bom), `C` (marcas/funciona), `D` (defeito/peça).
6. `fingerprint = category|brand|model|variant|conditionGrade`. Categoria abre a chave de propósito: `key` é o que se lê na tabela `fingerprint` a olho nu e no `group by`, e ordenar por categoria agrupa o inventário do mesmo jeito que o índice composto `(category, brand, model)`. A ordem é opaca para o cálculo — o que importa é que seja uma só em todo o sistema. Atributo ausente entra como `?` (`celular|?|?|128gb|B`), nunca como vazio, para `a||b` e `a|b` não colidirem.

**Quando o parse determinístico falha**, o item entra em fila de `normalize.product` na IA (em lote, ver §6). Item sem fingerprint **não** é valorado nem alertado — vira `unmatched` com contagem visível no painel, para você saber quantos anúncios o parser está deixando passar.

Variante importa: iPhone 12 128GB desbloqueado e iPhone 12 128GB bloqueado de operadora têm fingerprints diferentes. Misturá-los numa mediana é o tipo de erro que produz margem fantasma.

---

## 5. Valuation

`valuation(fingerprint)` calcula o valor real de revenda a partir de anúncios comparáveis **do nosso próprio banco**.

### 5.1 Fórmula

```
comparáveis = listings com mesmo fingerprint, janela de 90 dias, status ativos ou gone
aparada     = remove 10% das duas caudas (n >= 7) ou tudo que difere >3x da mediana bruta
grossMed    = median(aparada.askingCents)
fairGross   = round(grossMed * delta)
netRealiz   = round(fairGross * (1 - platformFeePct - taxPct) - shippingOutCents)
```

`delta` é o desconto pedido→realizado. Mediana de preço **pedido** não é preço de mercado: é o teto do ego do vendedor. Default `delta = 0.85`.

### 5.2 Calibração pelo seu próprio giro

Depois de ≥ 20 vendas registradas, `delta` passa a ser **medido** por categoria:

```
delta_categoria = median( soldCents / grossMed_no_momento_da_compra )
```

O modelo calibra com dados seus, não com a suposição desta spec. `settings.deltaMode: fixed|measured` controla a transição, e o painel mostra os dois valores lado a lado enquanto você decide.

### 5.3 Guardas de amostra

| n de comparáveis | confiança | comportamento |
|---|---|---|
| ≥ 8 | high | alerta normal |
| 5–7 | med | alerta normal |
| 3–4 | low | alerta **somente** se `marginPct ≥ 2 × floorPct` |
| < 3 | none | **não alerta**; grava `opportunity` com `gateReason: 'amostra-insuficiente'` |

Motivo: mediana de dois anúncios é chute com aparência de número, e um push com esse número destrói a confiança no sistema inteiro na primeira semana.

### 5.4 liquidez (`liquidityDays`)

Ordem de preferência, com `liquiditySource` gravado para auditoria:

1. `own` — vendas suas registradas para o mesmo fingerprint (tempo entre `purchase.boughtAt` e `sale.soldAt`)
2. `market` — tempo médio que anúncios do fingerprint ficaram ativos antes de sumir (`lastSeenAt` de itens hoje `gone`), proxy de venda
3. `category-default` — tabela em `settings` (celular 10, notebook 18, console 12, bicicleta 25, autopeça 40)

Em cold start usa (3) e marca `confidence` accordingly. Degrada explicitamente em vez de fingir precisão.

---

## 6. Score e gate

### 6.1 Custos

Tudo em `settings`, default conservador, por categoria e por plataforma de saída:

```
costsIn        = askingCents + shippingInCents + repairCents + otherCostsInCents + feesInCents
marginCents    = netRealizableCents - costsIn
marginPct      = marginCents / costsIn            -- ROI sobre capital, não sobre preço de venda
expectedPerDay = marginCents / max(liquidityDays, 1)
```

Componentes: taxa da plataforma por onde você vai **vender** (ML percentual variável, OLX anúncio grátis), frete/retirada, reparo/limpeza estimado (a IA pode sugerir pelo estado), pagamento (PIX = 0), imposto opcional (MEI/Simples, default 0).

### 6.2 Gate determinístico (pré-IA)

```
gatePassed = marginPct >= floor.marginPct  AND  marginCents >= floor.marginCents
```

Defaults: `floor.marginPct = 0.35`, `floor.marginCents = 60`. Abaixo disso, o item é arquivado e a IA **nunca é consultada**. São chutes desta spec e vivem em `settings`; você calibra na primeira semana.

### 6.3 Score composto

A métrica de ranking é retorno por dia de capital, não margem bruta. Margem alta com liquidez zero é estoque morto, e estoque morto é como um flipp quebra com R$ 8.000 em itens bons no depósito.

```
S = 0.45 * clamp(expectedPerDay / meta.perDayCents, 0, 1)
  + 0.25 * clamp(meta.days / liquidityDays, 0, 1)
  + 0.15 * confidenceFactor(low 0.3 | med 0.7 | high 1.0)
  + 0.15 * exp(-ageDays / 3)
```

`meta.perDayCents = 4000` (R$ 40/dia), `meta.days = 14` e `meta.staleDays = 30` (item encalhado), todos em `settings`. Pesos somam 1 e cada termo vai no `breakdown` da oportunidade — o painel mostra **por que** o item pontuou 81. Nada de caixa-preta.

O termo de frescor existe porque em marketplace quem chega primeiro leva: um anúncio de 30 minutos vale estruturalmente mais que um de 5 dias pelo mesmo preço.

### 6.4 Papel da IA

A IA pode **rebaixar ou vetar**. Ela **nunca promove** um item que falhou o gate.

Decisão que envolve dinheiro fica ancorada no cálculo determinístico; a IA é filtro de risco (indício de golpe, tela trincada nas fotos, peça incompleta, texto incoerente, anúncio velho), não geradora de otimismo.

---

## 7. Camada de IA (OmniRoute, zero custo)

### 7.1 Restrição que governa o design

Nenhum modelo pago. Todo acesso via gateway OmniRoute local, endpoint OpenAI-compatível em `http://127.0.0.1:20128/v1`, agrupando pools gratuitos (~1,5 B tokens/mês em ~40 pools). O gargalo é **requisição por minuto**, não token: o maior pool em volume roda a ~2 req/min.

Regra dura: **nenhum código do sistema fala com provedor de IA diretamente.** Trocar de pool é config no OmniRoute, não refactor aqui.

### 7.2 Superfície

```ts
export interface Ai {
  complete(task: AiTask, input: unknown): Promise<string | null>;
  completeJson<T>(task: AiTask, input: unknown, schema: ZodSchema<T>): Promise<T | null>;
  vision(task: AiTask, input: unknown, imageUrls: string[]): Promise<VisionVerdict | null>;
}
```

`null` significa "IA indisponível/esgotada", **não** erro de pipeline. O score determinístico continua válido sem IA, e o item alerta com `flags: ['sem-auditoria-ia']`.

### 7.3 Combos versionados (`config/omniroute.combos.json`)

| Tarefa | Combo | Estratégia | O que faz |
|---|---|---|---|
| `triage.batch` | `brique-triage` | `priority` sobre pools de texto grátis | audita até 12 anúncios por requisição |
| `normalize.product` | `brique-cheap` | `round-robin` | extrai marca/modelo/variante quando o regex falha |
| `audit.vision` | `brique-vision` | `priority` em modelos multimodais | fotos dos finalistas |
| `negotiate.chat` | `brique-negotiation` | melhor instruction-following gratuito | reservado, não usado nesta spec |

`pnpm omniroute:setup` faz o upload dos combos pela API de admin e lista os provedores gratuitos a ativar no dashboard. Setup reproduzível, nada configurado à mão e esquecido.

### 7.4 Quatro mecanismos que fazem isso caber em 2 req/min

1. **Lote, não item.** Triagem envia até 12 anúncios numa chamada e recebe um array de vereditos. 200 chamadas/dia ≈ 2.400 anúncios analisados. Um-a-um seriam 200.
2. **Cache idempotente** por `hash(tarefa + combo + input canônico)`. Anúncio inalterado nunca é re-cobrado. Taxa de cache hit é métrica visível no painel: se cair, o `normalize` está instável.
3. **Orçamento por tarefa + bucket global de concorrência 1.** Triage 200/dia, visão 40/dia, normalize 100/dia. Ao esgotar, os itens **postergam** para a próxima janela em vez de falhar; `settings.aiPaused` aparece no painel e o motivo vai pro `aiCallLog`.
4. **Prompt enxuto + compressão.** Somente título, preço, cidade, descrição truncada (800 chars), atributos extraídos e até 3 URLs de imagem — nunca o `rawPayload`. Header `x-omniroute-compression` no perfil agressivo para chamadas em lote.

### 7.5 Resiliência de resposta

Modelo gratuito produz JSON quebrado, e o design assume isso:

```
pedir response_format json_object (quando suportado)
 -> validar com zod
 -> falhou: 1 tentativa de correção (manda o texto inválido de volta pedindo reparo)
 -> falhou: extração por regex do array de vereditos
 -> falhou: registrar status 'unparsed', tratar como "sem opinião da IA"
```

Retry com backoff exponencial + jitter em 429/5xx/timeout, máximo 5 tentativas (o OmniRoute cuida do failover entre provedores; nós cuidamos do pacing). Circuit-open de 15 min por tarefa após 3 falhas consecutivas.

**Nada derruba a pipeline por JSON malformado.** Um pipeline que cai por isso não é confiável o bastante para mandar você comprar algo.

---

## 8. Adapters de fonte

### 8.1 OLX (fonte de caça)

- Busca sobre o endpoint JSON de listagem do site, com fallback de parse de HTML quando o JSON mudar de forma.
- User-Agent realista, jitter de 1,5–4 s entre páginas, concorrência 2, teto de 6 páginas por monitor por passada, sem login.
- `parserVersion` por estratégia de parse.

### 8.2 Mercado Livre (fonte de valoração)

- API oficial `api.mercadolibre.com` com access token de app registrado (gratuito, auto-serviço). Respeitar cota documentada, ~1 req/s, persistir `cooldownUntil` por fonte em caso de 403/429.
- **Incógnita verificável:** o que exatamente a API pública expõe de preço *realizado* (`sold_last_30days`, `sold_quantity`, catálogo) e se os anúncios concluídos são alcançáveis. Fase M2 inclui spike com teto de tempo definido (§12) para responder antes de congelar a fórmula de valoração. Enquanto não resolvido, `fairGross` usa asking × delta, que funciona e é auditável.

### 8.3 Fragilidade e saúde

- Contract tests contra payloads gravados em `tests/fixtures/<source>/` por `parserVersion`; `pnpm fixtures:record --source=olx` é comando manual para quando o layout mudar.
- **Health check de fonte:** 3 passadas seguidas retornando 0 novos anúncios, **ou** queda do yield de `normalize()` em >60% abaixo da média móvel de 10 passadas ⇒ alerta `fonte degradada` no ntfy em prioridade alta.
- Motivo: parser quebrado e mercado sem pechincha são indistinguíveis do lado de fora, e confundi-los custa semanas de sistema parado sem ninguém saber.

### 8.4 Volume e risco operacional

Anúncios públicos; nenhum dado pessoal coletado além do apelido exibido do vendedor; dado bruto fica local e não é redistribuído. OLX e ML proíbem scraping nos termos de uso, então o risco real é **operacional**: IP bloqueado e sistema parado. Por isso o volume educado, o jitter, o teto de páginas e o cooldown persistido são parte do design, não decoração. O Facebook entra em spec própria, com sessão logada do operador, throttle e modo dry-run antes de qualquer envio.

---

## 9. Alertas (ntfy)

`POST https://ntfy.sh/<TOPIC>` com `Title`, `Priority`, `Tags`, `Click` = URL do anúncio. `NTFY_BASE_URL` sobrescrevível para self-host na fase VPS.

Formato:

```
iPhone 12 128GB desbloqueado — R$ 980
justo R$ 1.480 · margem R$ 340 · ROI 34% · ~R$ 24/dia
score 81 · Curitiba · n=9 · IA: sem indício de golpe
```

- **Dedupe:** um alerta por anúncio. Re-alerta apenas quando o preço **cruza o floor de novo** (prefixo "caiu {pct}%"), nunca a cada varredura.
- **Digest diário** configurável: top 10 por score em uma notificação, preservando sua atenção e a cota.
- **Silent hours** e mute por monitor.
- **Segurança do topic:** o nome do topic é segredo prático (quem sabe o nome publica no seu celular). Vai em `.env`, valor não óbvio.
- Ações (comprado / ignorar / sonecar) acontecem no painel, pois ntfy é só push. Botão de ação na notificação via endpoint autenticado é fase 1.5 declarada, fora desta spec.

---

## 10. Pipeline e scheduler

Um passada, por monitor vencido:

```
1  scheduler dispara monitor vencido (fila serial)
2  adapter.search(monitor, since=lastRunAt)         -> RawListing[]
3  upsert listing por (source, externalId)
     novo                    -> status=new
     preço mudou             -> pricePoint + status=repriced
     igual                   -> status=unchanged  -> PARA AQUI (zero CPU, zero IA)
4  normalize()               -> fingerprint | unmatched
5  valuation(fingerprint)    -> median, delta, confiança, liquidez
6  score()                  -> margem, expectedPerDay, S, breakdown
7  gate determinístico      -> abaixo do floor: archivar, gateReason, FIM
8  crossed floor?           -> consulta aiCache; miss -> fila triage.batch
9  veredito: veto -> status=ignored com motivo; pass/unavailable -> shortlisted
10 cria dealAlert -> ntfy + fila no painel
11 fecha run com contadores (fetched/new/repriced/unchanged/rejected/aiCalls/cacheHits)
```

Idempotência: passo 3 é chaveado por `(source, externalId)` e a transação é por anúncio, então reinício no meio **retoma** em vez de duplicar ou re-cobrar.

Orçamento do worker: timeout 30 s por request, deadline 10 min por monitor, kill e segue. Uma passada nunca bloqueia a agenda das demais.

---

## 11. Painel (Next.js, server components)

| Rota | Conteúdo |
|---|---|
| `/` | KPIs do período: lucro realizado, capital em estoque, ROI médio, dias médios de giro, taxa de cache de IA, saúde das fontes. Top 10 deals recentes. |
| `/deals` | Fila ranqueada por `score`, com `breakdown` visível, comparáveis, histórico de preço, veredito IA e motivo. Ações: comprado, ignorar, favoritar. |
| `/listing/[id]` | Fotos, descrição, valuation, todos os `comparableRef`, série de preço, resultado da IA, botão de registro de compra. |
| `/monitors` | CRUD de monitores: fonte, termo, cidade, faixa, intervalo, ativo, `lastYield`. |
| `/inventory` | Itens comprados: custo total, status, preço sugerido, dias em estoque, venda. |
| `/pnl` | Lucro por mês e por categoria, ranking de categorias, itens encalhados (> `meta.staleDays`), receita/custo/taxa. |
| `/settings` | Floors, pesos, metas, `deltaMode`, plataformas e taxas, topic ntfy, base URL e combos OmniRoute, caps de IA, tokens de fonte (apenas gravados, nunca exibidos de volta). |

Escrever no banco a partir do web acontece por uma única camada de service (`core/repo/actions`), com transações curtas e retry em `SQLITE_BUSY`, para que adicionar autenticação na fase VPS seja uma camada a mais, não uma refactorada. Nesta fase o web escuta em `127.0.0.1` e não tem auth.

---

## 12. Fases de implementação

Cada fase termina rodável e verificável. O plano detalha tarefas por fase.

| Fase | Entrega | Verificação |
|---|---|---|
| M0 | git init, scaffold pnpm, lint/tipos/testes, config zod com fail-fast, schema Drizzle + migrações | `pnpm test` verde, `pnpm worker` sobe e faz migrate |
| M1 | `core/normalize`: preço pt-BR, categoria, fingerprint, dicionários | unit + property tests cobrindo casos sujos |
| M2 | **Spike de Mercado Livre** com teto de ~30 min de exploração: o que é obtível de preço realizado; adapter OLX + adapter ML com `search/fetch/normalize` | fixtures gravados, contract tests, `pnpm smoke:olx` |
| M3 | `core/valuation` + `core/score` + gate | unit nos cantos (n=0,1,7), testes de propriedade do score |
| M4 | pipeline completa no worker + scheduler serial + `run` | integração sobre feed de fixtures, 100 anúncios já vistos ⇒ 0 chamadas de IA |
| M5 | camada de IA: OmniRoute client, combos, budget, cache, lote, degradação | stub local simulando 429/lento/JSON quebrado |
| M6 | painel: deals, listing, monitores, inventory, pnl, settings | clique manual nas rotas com seed de dados |
| M7 | ntfy + dedupe + digest + health de fonte | envio real de teste, duplo-envio não ocorre |
| M8 | `purchase`/`sale`/P&L, calibração de `delta` medido | 3 compras + 2 vendas conferidas ao centavo |

---

## 13. Testes

- **Unit (sem rede):** parser de preço (`1.234`, `1.234,56`, `1234.56`, `R$ 990`, `Grátis`, `A combinar`, `0`); `normalize` por categoria; margem e `expectedPerDay` nos cantos; n=0 comparáveis; `delta` ausente; estabilidade da `cacheKey`.
- **Property:** `Σ pesos = 1`; `0 ≤ S ≤ 1`; margem maior com resto igual ⇒ score maior; gate monotônico em `marginCents`.
- **Contract:** `adapter.normalize()` contra fixtures por `parserVersion`.
- **Integration:** SQLite efêmero em diretório temporário; pipeline inteira sobre feed de fixtures; asserts em `opportunity`, `dealAlert`, contadores de `run`; ntfy stubado via `fetch` injetado; IA contra stub simulando 429, lentidão e JSON malformado.
- **Golden file:** "um dia" de fixtures ⇒ snapshot do ranking; ajuste de fórmula aparece como diff revisável, não como surpresa.
- **Invariantes de injeção de falha:** `aiVerdict = veto` nunca gera alerta; cota esgotada nunca gera alerta, gera `budget` em `aiCallLog`; `unchanged` nunca alcança `valuation`.
- **Proibido:** rede viva em teste automatizado — seria flaky e gastaria a cota gratuita. Smoke real é comando manual por fonte.

---

## 14. Configuração

`.env` (git-ignored), validado com zod em `core/config.ts`, fail-fast com mensagem explícita na ausência de segredo:

```
OMNIROUTE_BASE_URL=http://127.0.0.1:20128/v1
OMNIROUTE_API_KEY=                       # obrigatório p/ ligar IA
MELI_ACCESS_TOKEN=                       # vazio => ML desabilitado, OLX segue
MELI_UNIT=
NTFY_BASE_URL=https://ntfy.sh
NTFY_TOPIC=
DATABASE_URL=sqlite://./data/brique.db
WEB_PORT=3000
TZ_DEFAULT=America/Sao_Paulo
```

Segredos nunca aparecem em `settings` de volta ao painel nem em log. Em VPS, segredo passa a vir de gerenciador próprio — costura prevista, não implementada agora.

---

## 15. Falhas e comportamento garantido

| Falha | Comportamento |
|---|---|
| Worker morre no meio da passada | Retoma; idempotente por anúncio; `run` fica `partial` e visível |
| Browser/request travado | Timeout 30 s, deadline 10 min por monitor, kill e segue |
| Dois processos, um SQLite | WAL, `busy_timeout=5000`, retry em `SQLITE_BUSY`, worker é o escritor principal |
| Preço `0`/`Grátis`/`Troco`/outlier | Filtro com motivo em `run.rejected`; **nunca** descarte silencioso |
| Mesmo vendedor em OLX e ML | Dedupe fuzzy por shingles de título+descrição+preço ⇒ `dupeOf` (evita contar duas vezes e disputar contra si mesmo) |
| Anúncio some antes da compra | Status `gone` na passada seguinte, `opportunity` fecha, painel mostra "não existe mais" |
| Config inválida / segredo faltando | Fail-fast no boot com mensagem nomeando a variável |
| Layout de fonte mudou | `parserVersion` + contract tests pegam antes; health check alerta `fonte degradada` |
| Cota de IA esgotada | Itens postergam para a próxima janela, painel mostra "IA pausada: cota do dia", alerta determinístico segue saindo |
| Todos os pools de IA fora do ar | Sistema útil mesmo assim: score, ranking, painel e P&L não dependem de IA |

---

## 16. Critérios de aceite

1. ≥ 3 monitores ativos em OLX e ML com passadas agendadas e `lastYield` crescendo.
2. Passada sobre 100 anúncios já vistos ⇒ **zero** chamadas de IA, comprovado por `aiCallLog`.
3. 5 listings-armadilha nos fixtures ⇒ ranqueados na ordem esperada, com `breakdown` explicando cada posição.
4. 3 compras e 2 vendas reais registradas ⇒ P&L correto ao centavo, com ROI e dias em estoque.
5. Push ntfy chega em < 60 s de um anúncio novo que cruza o floor, e não chega duas vezes.
6. Após uma semana de uso, operador informa a taxa de falso positivo da fila de deals ⇒ floors recalibrados com esse número, não com o default da spec.

---

## 17. Costuras para as specs seguintes (declaradas, não construídas)

| Extensão | Costura já existente |
|---|---|
| Facebook Marketplace / Enjoei | `SourceAdapter` novo em `packages/scrapers`; nada em `core` muda |
| Negociação autônoma com IA | consome `Opportunity`; tabela `negotiationThread(listingId, turns, targetCents, status)`; tarefa `negotiate.chat` já tem combo |
| Aprovação humana antes de enviar | `settings.negotiationMode: draft|auto` com `draft` default; throttle e dry-run primeiro |
| VPS 24/7 | Postgres atrás dos repositórios Drizzle, worker como serviço, `NTFY_BASE_URL` self-host, secrets em gerenciador próprio |
| Matching semântico por embeddings | ponto de extensão em `valuation` como `ComparablesProvider`, com a mediana atual sendo a implementação default |

---

## 18. Riscos reconhecidos

1. **Valoração por asking é enviesada.** Mitigado por `delta` e pela calibração com vendas reais; até você ter histórico, a margem mostrada é otimista em ~15%. O sistema declara `deltaMode` na tela para você nunca esquecer disso.
2. **Cota de IA derruba triagem em dias de muito anúncio.** Mitigado por gate determinístico antes da IA, lote de 12, cache e adiamento de fila. O sistema útil sem IA é o estado normal, não o fallback.
3. **Bloqueio de IP em OLX.** Mitigado por volume educado, jitter, teto de páginas e cooldown; se acontecer, a resposta é baixar o intervalo, não lutar contra o bloqueio.
4. **Modelos gratuitos sem visão disponível.** `audit.vision` pode ficar indisponível por longos períodos; o fluxo continua sem auditoria visual, marcado como tal.
5. **Falso positivo alto na primeira semana.** Esperado e tratado como calibração, não como bug: os floors existem para serem ajustados com dados seus (§16.6).
