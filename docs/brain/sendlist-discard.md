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

## Hipóteses (em ordem)

1. **Política/rollout server-side**: formato legado descontinuado sendo estrangulado; servidor
   filtra por conta/reputação/experimento → explica intermitência sem mudança local.
2. **Validação no receptor**: versão do app do destinatário droppa lista legada após decrypt.

## Como desempatar

Instrumentar ack + receipt: ack limpo + delivered + não renderiza = receptor;
ack com `error` ou sem delivered = servidor. Comparar com carrossel/CTA (funcionam).
