---
type: Code Path
title: Pipeline de envio Baileys (interactive/list)
description: Como interactiveMessage/listMessage chegam ao WhatsApp — relayMessage direto, nós biz, e os 3 estágios após o 200.
tags: [baileys, send, relayMessage, stanza, ack]
timestamp: 2026-07-03T00:00:00Z
---

# Pipeline de envio (Baileys 7.0.0-rc.9)

Fluxo: controller → `listMessage()`/`buttonMessage()`/`carouselMessage()` em
`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` →
`sendMessageWithTyping()` (~linha 2554) → `sendMessage()` privado (~linha 2391).

## Branch especial interactive/list (linha ~2420)

Quando a mensagem é `viewOnceMessage`, `interactiveMessage` ou `listMessage`, a Evolution
**não usa** `client.sendMessage()` do Baileys — chama `client.relayMessage(sender, message, { messageId, additionalNodes })`
direto. Consequências:

- Os `additionalNodes` (nós `biz`, ver `helpers/interactiveMessage.helper.ts`) são anexados
  **em claro** no fim da stanza — o servidor WA os enxerga sem decriptar.
- `quoted` NÃO chega ao destinatário nesses tipos: `generateWAMessageFromContent` só monta o
  objeto devolvido ao webhook/DB; o `relayMessage` envia o proto cru (reply-quote cosmético).
- `patchMessageBeforeSending` (configurado na criação do socket, ~linha 786) roda a cada
  criptografia por dispositivo e converte `listType PRODUCT_LIST → SINGLE_SELECT` (`normalizeListType`, ~linha 233).

## Atributos de stanza (dentro do Baileys)

- `listMessage` → stanza `type="media"` + `mediatype="list"` no nó `<enc>` — o servidor
  identifica que é lista SEM decriptar.
- `interactiveMessage` → stanza `type="text"`, sem mediatype (não está no `getMediaType`).

## Os 3 estágios após o "200" (chave da investigação de descartes)

`relayMessage` retorna logo após `sendNode(stanza)` — o 200 da API só atesta escrita no socket.

1. **Ack do servidor** — evento `CB:ack,class:message` (messages-recv.js do Baileys). Se vier
   `attrs.error`, o Baileys loga warn `received error in ack` e emite `messages.update` com
   status `ERROR` + `messageStubParameters: [error]` (`handleBadAck`).
2. **Receipt do dispositivo** (delivered / 2 ticks) — o aparelho recebeu e decriptou.
3. **Renderização** — validação interna do app receptor; descarte aqui é silencioso.

## Instrumentação send-trace (patch do fork, 2026-07-03)

Logs em nível DEBUG com marcador `[send-trace]` (greppável no Railway):

- `[send-trace] relay id=... to=... kinds=... nodes=... message=...` — após cada
  `relayMessage` de interactive/list (branch da linha ~2420).
- `[send-trace] ack {...attrs}` — todo `CB:ack,class:message`; `attrs.error` = servidor rejeitou.
- `[send-trace] receipt {...attrs}` — todo `CB:receipt`; `type:"retry"` = destinatário não
  conseguiu decriptar; ausência de receipt = não entregue.

Stanza XML completa (enviada e recebida): `LOG_BAILEYS=trace` (o `sendNode` do Baileys loga
`xml send` / `recv xml` em nível trace).

**Tabela de diagnóstico:** ack com `error` → política do servidor; ack limpo sem receipt →
descarte no servidor pós-aceite; receipt delivered sem renderizar → validação do app receptor;
receipt `retry` → problema de sessão/criptografia. Ver [sendlist-discard](sendlist-discard.md)
e [pix-discard](pix-discard.md).
