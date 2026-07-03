---
type: Investigation
title: sendList descartado (intermitente)
description: Lista legada renderizou 2x em 02/07 e 0/3 em 03/07 com mesmo código/sessão — suspeita de política server-side.
tags: [sendList, listMessage, discard, whatsapp]
timestamp: 2026-07-03T00:00:00Z
---

# sendList — descarte intermitente

**Sintoma:** mesma build, mesma sessão: 2 renderizações em 02/07/2026, 0/3 em 03/07/2026.
API sempre responde 200 (que não significa nada — ver [send-pipeline](send-pipeline.md)).

## Como a lista é montada

`listMessage()` (whatsapp.baileys.service.ts ~linha 3826) usa o **formato legado**
`proto.Message.ListMessage` com `listType: SINGLE_SELECT` — o formato moderno
(interactiveMessage + single_select) chega vazio no WhatsApp Web/Desktop.

Vai com nó extra em claro `buildListBizNode()`:
`<biz><list type="product_list" v="2"/></biz>` (helpers/interactiveMessage.helper.ts).

**Contradição deliberada (hack p/ renderizar no Web):** anotação pública diz `product_list`,
conteúdo cifrado diz `single_select`. `normalizeListType` garante SINGLE_SELECT na criptografia.

O Baileys ainda marca a stanza com `type="media"` + `mediatype="list"` — servidor sabe que é
lista por dois canais sem decriptar.

## Diagnóstico (2026-07-03) — CAUSA IDENTIFICADA

**Traces do send-trace (probe na instância de teste):** ack do servidor LIMPO (sem `error`)
e receipts dos devices sem `retry` — servidor aceita e devices decriptam. O descarte é no
**estágio 3: validação de renderização do app receptor**.

**Causa raiz (confiança alta, rsalcara/InfiniteAPI#494):** o bump da versão anunciada do
WA Web (`2.3000.1040300918` → `2.3000.1040549582`, jun/2026) passou a **exigir o nó
`<bot biz_bot="1"/>` na stanza** de interativas/listas em chats 1:1 — sem ele o receptor
descarta em silêncio. A Evolution busca a versão anunciada dinamicamente
(`fetchLatestWaWebVersion`, linha ~697) → comportamento muda de um dia pro outro sem deploy
= a intermitência observada (02/07 renderiza, 03/07 não).

**Fix aplicado no fork (2026-07-03):** injetar `buildBotNode()` antes do biz node em envios
1:1 no branch de relay (nunca em grupos). Efeito colateral conhecido: selo "IA ✦" em alguns
clientes. Confirmado por 3 implementações independentes (InfiniteAPI, baileys-interactive,
williamprado/whatsmeow).

**Risco futuro:** o listMessage legado está sendo morto progressivamente (watinkdev#241
reporta erro 405 do servidor em jun/2026; whatsmeow ❌). Plano B mapeado: nativeFlow
`single_select` + biz + bot (renderiza mobile, não Web/Desktop) — decidir por cliente-alvo.
