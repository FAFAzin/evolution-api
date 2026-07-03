---
type: Investigation
title: sendList descartado (RESOLVIDO — pin de versão)
description: "RESOLVIDO 2026-07-03: WA Web pós-bump exigia bot node; fix = CONFIG_BAILEYS_VERSION=2.3000.1040300918 pinada. Renderização confirmada em aparelho real."
tags: [sendList, listMessage, discard, whatsapp, resolved]
timestamp: 2026-07-03T00:00:00Z
---

# ✅ RESOLVIDO (2026-07-03)

**Fix operacional:** `CONFIG_BAILEYS_VERSION=2.3000.1040300918` (env no Railway staging).
Com a versão anunciada pinada na pré-bump, a lista legada + biz node voltou a: ack limpo →
delivery receipts no destinatário real → **renderização confirmada no aparelho**
(21987686705, botões funcionando). Sem mudança de código.

**Manutenção do fix (importante):** versões velhas anunciadas passam a ser recusadas no
handshake com o tempo (HTTP 405, Baileys#2376). Monitorar conexão; alternativa durável
mapeada = plataforma macOS no handshake (Baileys PR#2365) ou bot node com ordem correta
biz→bot quando a conta tiver capability (conta comum: 451 "commerce disabled").

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

**Experimento bot node v1 (2026-07-03) — 451, revertido:** injetamos `<bot>` ANTES do
`<biz>` e o servidor rejeitou com **ack error=451 = "commerce features disabled"** (conta
comum, self-chat). DOIS suspeitos identificados pela pesquisa: (a) **ordem errada dos nós**
— InfiniteAPI e WA Web oficial usam `<biz>` primeiro, `<bot>` depois; (b) bot node marca a
mensagem como "de bot de negócio" e conta comum não tem a capability. Próximo teste: ordem
correta biz→bot; se persistir 451, bot node é incompatível com conta comum.

**Experimento pin de versão (2026-07-03):** `CONFIG_BAILEYS_VERSION=2.3000.1040300918`
aplicado no staging; lista voltou a ack limpo + receipts (renderização pendente de
confirmação no aparelho). ⚠️ Pin é sonda de diagnóstico, não solução: versões velhas são
recusadas no handshake com o tempo (405); mitigador durável = `Platform.MACOS`
(Baileys PR#2365). Cache de versão dinâmica: TTL 1h (explica intermitência intra-dia).

**⚠️ Validade dos testes:** tudo até aqui foi self-chat — ver limitações em
[send-pipeline](send-pipeline.md). Reteste com segundo número real é obrigatório antes de
conclusões finais de renderização/gating.

**Risco futuro:** o listMessage legado está sendo morto progressivamente (watinkdev#241
reporta erro 405 do servidor em jun/2026; whatsmeow ❌). Plano B mapeado: nativeFlow
`single_select` + biz + bot (renderiza mobile, não Web/Desktop) — decidir por cliente-alvo.
