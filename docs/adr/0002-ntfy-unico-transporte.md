# ADR 0002 — ntfy como único transporte de alerta (2026-11-26)

**Contexto.** O plano de merge previa Discord como transporte principal e ntfy como alternativa
dentro do mesmo `NotifyPort`. Ambas as implementações foram portadas e validadas por testes.
Ao final da validação, o operador decidiu não ter Discord como webhook.

**Decisão.** Retirar a feature Discord por completo: `packages/worker/src/notify-discord.ts` e
seu teste, `buildDiscordPayload`/`DiscordPayload`/`DealEmbedContext`/`createSendLimiter` de
`core/notify-port.ts`, o campo `discord` de `AlertMessage`, `DISCORD_WEBHOOK_URL` de config e
`.env.example`, e `'discord'` de `AlertChannel`, do tipo da coluna `deal_alert.channel` e da
consulta de dedupe. `formatDealMessage` passa a devolver só título/corpo/tags/prioridade/URL,
com o contexto da mediana já no corpo. ntfy vira o único transporte real; sem `NTFY_TOPIC` o
`nullNotifier()` falha honestamente e a passada segue com `deal_alert.status = failed`.

**Consequência.** Menos código transporte-específico no domínio; o porto continua trocável se
outro transporte for pedido depois. A coluna `deal_alert.channel` mantém o default `ntfy` e o
tipo aceita `digest` para registros históricos; nenhuma migração de dados é necessária.
O limite de taxa de 500 ms existed para o Discord e foi removido junto — ntfy não o exige.
