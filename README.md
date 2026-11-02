# Brique

Caça e classificação de oportunidades de revenda em marketplace brasileiro.
Spec: `docs/specs/2026-10-31-brique-vertical-design.md`
Planos: `docs/plans/`

## Rodar

    pnpm install
    cp .env.example .env      # DATABASE_URL basta; sem MELI_ACCESS_TOKEN o ML fica desligado
    pnpm db:migrate
    pnpm seed:demo            # popula o SQLite do .env com o feed do dia 1 e 3 monitores
    pnpm worker               # varre os monitores e imprime a fila ranqueada

## Comandos

    pnpm test            # suíte inteira, sem rede
    pnpm typecheck
    pnpm smoke:olx "iphone 12"    # exige rede, confirma que o parser bate com a página viva
    pnpm smoke:meli  "iphone 12"  # exige MELI_ACCESS_TOKEN
    pnpm fixtures:record          # grava payload real para atualizar contract tests

## Como ler a saída

`R$/dia` é margem estimada dividida pela liquidez estimada — é o número que ordena a fila.
`n` é o tamanho da amostra de comparáveis; `conf` é a confiança (§5.3 da spec).
`n=0` ou `conf=low` significa referência fraca, não oportunidade melhor.

## Estrutura

    packages/core      domínio, banco, valuation, score — nunca acessa marketplace
    packages/scrapers  um SourceAdapter por fonte; único lugar que conhece cada site
    packages/worker    scheduler serial + pipeline + saída de terminal
