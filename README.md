# Brique

Caça e classificação de oportunidades de revenda em marketplace brasileiro.
Spec: `docs/specs/2026-10-31-brique-vertical-design.md`
Planos: `docs/plans/`
Passagem de execução (estado atual, o que vem a seguir, decisões abertas): `docs/HANDOFF-2026-11-26.md`
Decisões deste merge: `docs/adr/0001-merge-scrapelytics.md`

## Rodar

    pnpm install
    cp .env.example .env      # DATABASE_URL basta; sem MELI_ACCESS_TOKEN o ML fica desligado
    pnpm db:migrate
    pnpm seed:demo            # popula o SQLite do .env com o feed do dia 1 e 3 monitores
    pnpm seed:watches         # opcional: importa os 2 watches do ../Scrapelytics/watches.yaml
    pnpm worker               # varre os monitores e imprime a fila ranqueada

`DISCORD_WEBHOOK_URL=` em `.env` liga os embeds de oferta. Sem ele, o worker usa
`NTFY_TOPIC` se configurado; sem os dois, continua rodando e registra a entrega como falha.
Nada de webhook/topic em log, banco de settings ou diff.
`seed:watches` é idempotente (label + source + query) e o YAML não é lido em runtime.

## Comandos

    pnpm test            # suíte inteira, sem rede
    pnpm typecheck
    pnpm smoke:olx "iphone 15"    # exige rede; deve mostrar parserVersion olx-rsc-2026-11
    pnpm smoke:meli  "iphone 12"  # exige MELI_ACCESS_TOKEN
    pnpm fixtures:record "iphone 15"   # grava flight RSC real; falha se a fonte degradar

    pnpm buy -- "iPhone 12 128GB" --paid 980 --listing 42   # 980 = R$ 980,00; sem --listing exige --category
    pnpm sell -- 7 --sold 1650 --platform meli               # imprime taxa, líquido, lucro e ROI
    pnpm pnl [--month 2026-10] [--category celular]          # realizado; estoque sempre global

## Como ler a saída

`R$/dia` é margem estimada dividida pela liquidez estimada — é o número que ordena a fila.
`n` é o tamanho da amostra de comparáveis; `conf` é a confiança (§5.3 da spec).
`n=0` ou `conf=low` significa referência fraca, não oportunidade melhor.
Enquanto `deltaMode=fixed`, `R$/dia` e `margem` da fila seguem otimistas pelo `delta`; `pnl` é o que mede o resultado realizado.

## Parser e alertas

O parser OLX lê o flight RSC (`self.__next_f.push`) primeiro; `__NEXT_DATA__` e cards HTML são
fallbacks. `parserVersion = olx-rsc-2026-11` identifica os anúncios gravados.
`requireWords` (em `MonitorParams`) barra resultados fuzzy antes do upsert e conta em
`run.rejected`; `listing.eligible = false` tira comparáveis da amostra de preço.
O alerta Discord usa a mediana elegível, ou o teto manual `manualCeilingCents` no cold start, e
respeita `decideAlert` (gate, confiança, queda mínima de 10%). Uma entrega por cruzada; falha de
webhook vira `deal_alert.status = failed` e a passada segue.

## Estrutura

    packages/core      domínio, banco, valuation, score — nunca acessa marketplace
    packages/scrapers  um SourceAdapter por fonte; único lugar que conhece cada site
    packages/worker    scheduler serial + pipeline + saída de terminal
