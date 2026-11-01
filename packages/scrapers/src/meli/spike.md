# Spike do Mercado Livre (Task 12, Step 1)

Perguntas a medir com `MELI_ACCESS_TOKEN` de app público (rede viva, teto ~30 min). Este arquivo é a única fonte de verdade sobre se existe sinal de preço realizado na API pública; nenhuma resposta abaixo foi inventada.

1. `results[].price` vem em reais inteiros ou com centavos? Existe algum arredondamento que exija tratamento antes de virar `Cents`?

## Resposta: não medido — requer MELI_ACCESS_TOKEN

2. `results[].available_quantity` e `results[].sold_quantity` estão presentes? Com token de app público, `sold_quantity` é `null`?

## Resposta: não medido — requer MELI_ACCESS_TOKEN

3. Existe `results[].catalog_product_id` agrupando o mesmo modelo entre vendedores? Isso dá comparáveis melhores que fingerprint textual.

## Resposta: não medido — requer MELI_ACCESS_TOKEN

4. A resposta traz `condition` (`new`/`used`)? Mapeia para qual `Grade`?

## Resposta: não medido — requer MELI_ACCESS_TOKEN

5. Existe algum endpoint (`/items/{id}/sold_last_30_days`, `/catalog/...`, `sales_information`) que retorne preço ou quantidade **realizada**? Anotar o caminho exato e o corpo.

## Resposta: não medido — requer MELI_ACCESS_TOKEN

6. Qual o limite real de requisições observado (documentação + comportamento sob 1 req/s)?

## Resposta: não medido — requer MELI_ACCESS_TOKEN

Conclusão §5.1: a decisão de emenda (criar `soldAwareProvider` e combinar mediana de asking com sinal de venda, ou manter `fairGross = median(asking) * delta` como especificado) permanece pendente da medição do operador; o Step 1 não foi executado.
