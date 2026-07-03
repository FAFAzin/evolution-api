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

## Investigações (ambas encerradas em 2026-07-03)

- [sendlist-discard](sendlist-discard.md) — ✅ RESOLVIDO: pin `CONFIG_BAILEYS_VERSION=2.3000.1040300918`; render confirmado em aparelho real.
- [pix-discard](pix-discard.md) — ✅ RESOLVIDO: PIX nativo renderiza de conta Business com formato W-API (biz FLAT + header + messageVersion + messageSecret); render confirmado no aparelho.

## Operação

- Instância de teste: `vendora_cmr40kiah0006hkdstmybpd68`
- Probe: `../vendora-bot/scripts/evolution-probe.ts`
- Debug no Railway: `LOG_LEVEL` com DEBUG + `LOG_BAILEYS=true`
