---
type: Investigation
title: Flow trava na janela de reconexão ("cai e volta")
description: Durante a reconexão do socket, o envio pendura na query pré-envio (onWhatsApp, até 60s) e congela o flow. Fix = guard fail-fast + defaultQueryTimeoutMs.
tags: [reconnect, cai-e-volta, freeze, sendMessageWithTyping, connection, resolved]
timestamp: 2026-07-09T00:00:00Z
---

# "Cai e volta" — flow congela na janela de reconexão

**Sintoma (relato do usuário):** a conexão da instância cai e volta; nesse momento o fluxo
trava por ~15s e a mensagem pode falhar.

## Causa (verificada no código + pesquisa)

O envio em si NÃO pendura: `relayMessage`/presença lançam `428 Connection Closed` na hora se
o WS está fechado. O congelamento é a **query pré-envio**: `sendMessageWithTyping`
(whatsapp.baileys.service.ts ~2646) começa com `whatsappNumber`→`onWhatsApp` (consulta USync).
Na janela "cai e volta" o socket fica meio-morto (readyState ainda OPEN mas servidor não
responde), e essa query **pendura até o `defaultQueryTimeoutMs` do Baileys — 60s por padrão** —
e retorna `undefined` em vez de lançar.

O vendora aborta em 15s (timeout do `request()`), mas cai no `AbortError` que **não retenta**
(lib/providers/evolution.ts:152) → flow travado ~15s segurando o lock do contato + msg falha.

## Fix aplicado no fork (2026-07-09)

1. **Guard de fail-fast** no `sendMessageWithTyping`: se `stateConnection.state !== 'open'` ou
   `!client.ws.isOpen`, lança `BadRequestException('instance not connected')` ANTES da query.
2. **`defaultQueryTimeoutMs: 15_000`** no socketConfig (era 60s default) — teto de qualquer
   query que escape do guard.

**Por que encaixa sem mexer no vendora:** o erro vira corpo HTTP
`{ response: { message: "instance not connected" } }`; o vendora já tem `isTransientConnError`
que casa `"instance not connected"` → o retry com backoff 1s/3s/6s dispara sozinho → a
mensagem passa quando o socket reconecta. Zero trava, lock liberado na hora, msg não se perde.

## 🔴 A causa raiz de verdade (achada em 2026-07-14, pesquisa profunda)

O fail-fast acima era **necessário mas insuficiente**. As causas reais:

**1. A mina do 408 (a mais grave).** `DisconnectReason.connectionLost === timedOut === 408` no
Baileys, e o **watchdog de keep-alive mata o socket com 408 a cada 35s sem tráfego de entrada**
(blip de rede, stall de event loop). O upstream `72ca397c` (PR #2501, **só nas tags 2.4.0-rc1/rc2**
— nenhuma 2.3.x tem) pôs 408 em `codesToNotReconnect` → caía no branch de logout →
`cleaningUp()` → **`session.deleteMany()` = CREDENCIAIS APAGADAS** → cliente relê QR, instância
não volta nem com redeploy. **Fix: 408 só é terminal se a sessão não estiver registrada.**

**2. O hang de minutos é um MUTEX, não a rede.** `relayMessage` roda inteiro dentro de
`authState.keys.transaction(work, meId)` — um `AsyncMutex` **sem timeout**, compartilhado com
`resyncAppState`, `appPatch` (**markAsRead!**), `sendRetryRequest` e `uploadPreKeys`. Um
"marcar como lida" trava TODOS os envios da instância. Dentro do lock ainda há queries de rede
(eram 60s; nosso `defaultQueryTimeoutMs: 15s` cortou 4x). **Fix: `withSendTimeout` (60s).**
⚠️ O guard `ws.isOpen` NÃO protege disso: o Baileys emite `connection: 'open'` **antes** do
app-state sync/prekey upload terminarem — janela em que o guard passa e o mutex está preso.

**3. Reconexão sem backoff** (3s fixo, sem cap) martelava o WA → **428** em cascata.
**4. Dois sockets na mesma cred** (o antigo não era fechado) → `conflict` → **440** → ping-pong.

**Fixes aplicados (2026-07-14):** ver VENDORA-PATCHES.md. Ordem de impacto: 408 > mutex-timeout
> backoff > socket único.

## Contexto de ecossistema (pesquisa)

- **Nenhum gateway open-source tem outbox** (Baileys, whatsmeow, WAHA, wppconnect: todos falham
  rápido). **Z-API e W-API são ASSÍNCRONAS com fila** — o OpenAPI da W-API literalmente responde
  `200 "Mensagem enfileirada"` com um `insertedId` (ObjectId do Mongo). **É por isso que "as
  outras APIs não tinham esse problema".** Nosso fail-fast é o padrão do ecossistema; falta a fila.
- **Outbox (próximo passo):** deve viver no **consumidor** (vendora), não no fork — a Evolution
  já aceita `messageId` customizado no body, então **idempotência sai de graça** (mesmo ID em todo
  retry → WhatsApp deduplica). Formato obrigatório: `3EB0`+18 hex (`generateMessageIDV2`), não UUID.
  ⚠️ TTL curto p/ interativas (uma pergunta de fluxo entregue 10 min depois é pior que nada).
- **Railway proíbe Evolution API** explicitamente (staff: *"we do not allow userbots"*) — restarts
  inexplicáveis podem ser enforcement.

## Observações / follow-ups

- O fork NÃO reconecta em erro 408 (`timedOut`/`connectionLost`) — está em `codesToNotReconnect`
  (connectionUpdate ~540, adicionado p/ evitar loop). Quedas 408 dependem do `instance-health`
  worker do vendora p/ voltar. Revisar à parte.
- 440 (`connectionReplaced`) = duas sessões com a mesma cred → loop de reconexão. Nunca rodar
  dois sockets p/ a mesma instância (relevante ao bridge de export/import de sessão).
- Arquitetura "correta" (vendora, futuro): gate por `connectionState` + flush no
  webhook `CONNECTION_UPDATE=open`. Hoje o guard + retry existente já resolvem o sintoma.
- Eventos chegam ao vendora só por **webhook** (websocket/rabbitmq/sqs desligados). O
  `connection.update` já chega por lá.
