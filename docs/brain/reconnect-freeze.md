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
