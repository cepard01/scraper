# Brique

Caça e classificação de oportunidades de revenda em marketplace brasileiro.
Spec: `docs/specs/2026-10-31-brique-vertical-design.md`
Planos: `docs/plans/`
Passagem de execução (estado atual, o que vem a seguir, decisões abertas): `docs/HANDOFF-2026-11-02.md`

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

    pnpm buy -- "iPhone 12 128GB" --paid 980 --listing 42   # 980 = R$ 980,00; sem --listing exige --category
    pnpm sell -- 7 --sold 1650 --platform meli               # imprime taxa, líquido, lucro e ROI
    pnpm pnl [--month 2026-10] [--category celular]          # realizado; estoque sempre global

## Como ler a saída

`R$/dia` é margem estimada dividida pela liquidez estimada — é o número que ordena a fila.
`n` é o tamanho da amostra de comparáveis; `conf` é a confiança (§5.3 da spec).
`n=0` ou `conf=low` significa referência fraca, não oportunidade melhor.
Enquanto `deltaMode=fixed`, `R$/dia` e `margem` da fila seguem otimistas pelo `delta`; `pnl` é o que mede o resultado realizado.

## Estrutura

    packages/core      domínio, banco, valuation, score — nunca acessa marketplace
    packages/scrapers  um SourceAdapter por fonte; único lugar que conhece cada site
    packages/worker    scheduler serial + pipeline + saída de terminal
