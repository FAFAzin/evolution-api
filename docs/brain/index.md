---
type: Index
title: Evolution API (fork vendora) Knowledge Base
description: Mapa de conhecimento do fork vendora-stable — envio Baileys, investigação de descartes do WhatsApp.
timestamp: 2026-07-03T00:00:00Z
---

# Evolution API — fork vendora.bot

Base de conhecimento do fork `vendora-stable` (tag upstream `2.4.0-rc2`).
Contexto geral do fork: ver `CLAUDE.md` e `VENDORA-PATCHES.md` na raiz.

## Arquitetura / Código

- [send-pipeline](send-pipeline.md) — caminho completo de envio Baileys (relayMessage, stanza, ack, receipt) e o que o "200" significa.

## Investigações

- [sendlist-discard](sendlist-discard.md) — lista (`sendList`) descartada de forma intermitente pelo WhatsApp.
- [pix-discard](pix-discard.md) — botão PIX nativo (`payment_info`) descartado em 100% dos testes.

## Operação

- Instância de teste: `vendora_cmr40kiah0006hkdstmybpd68`
- Probe: `../vendora-bot/scripts/evolution-probe.ts`
- Debug no Railway: `LOG_LEVEL` com DEBUG + `LOG_BAILEYS=true`
