---
type: Investigation
title: Outbound não entrega (ack 463 / reach-out time-lock)
description: Número novo/frio não entrega outbound (preso em PENDING); 463 = restrição server-side da Meta, agravada por tctoken/cstoken ausentes no Baileys. Bump rc13 + surface do 463.
tags: [463, outbound, tctoken, reach-out, baileys, cve]
timestamp: 2026-07-08T00:00:00Z
---

# 463 — outbound não entrega (número novo/frio)

Sintoma (laudo vendora 2026-07-08): sessão nova por QR; `sendText` 201 PENDING, mídia
sobe pro mmg.whatsapp.net, mas destinatário NÃO recebe. Inbound OK, presença OK. Preso em
single-tick. Reproduz via API direta (não é o worker).

## Causa raiz (verificada no código + pesquisa)

**ack `463` = reach-out time-lock** da Meta: rate-limit de "abordagem fria" a contato sem
conversa prévia. Duas camadas: (1) número novo fazendo cold outreach; (2) Baileys não manda
`tctoken`/`cstoken` de forma útil → toda msg conta como reach-out → bate o limite rápido.

**Estado do rc.9 (verificado no fonte):**
- `tctoken` — lido e injetado na stanza (messages-send), e GRAVADO reativamente em
  `handlePrivacyTokenNotification` (messages-recv:724) quando o servidor empurra um
  `privacy_token` (após o contato interagir). Para contato FRIO o keystore está vazio →
  token não vai → contribui pro 463. (Correção a uma análise minha anterior: NÃO é "nunca
  grava"; é "só grava de contato aquecido".)
- `cstoken` — zero referências no Baileys inteiro (nem no master). PR #2438 (cstoken) segue
  ABERTO, não mergeado, em nenhuma release.

## PRs / versões (verificado via gh)

- #2257 (tctoken em profile/presença) + #2339 (ciclo de vida completo: colheita history-sync
  + IQ, expiração, re-emissão, recuperação no 463) — MERGEADOS, primeira release = **rc10**.
- Consenso da comunidade (Baileys#2441, whatsmeow#1074, waha#1992, evolution#2588): o fix de
  token **reduz** o 463 em conta não-restrita, **não elimina**. 463 de conta genuinamente
  restrita (número banido-e-restaurado) nenhuma lib resolve — é server-side.

## Fix aplicado no fork

1. **Bump Baileys rc.9 → rc13** (2026-07-08) — primário pelo **CVE-2026-48063 (9.3)**; de
   bônus traz a recuperação de 463 do rc10+. Ver VENDORA-PATCHES.md.
2. **Tier 1 — surface do 463 (IMPLEMENTADO 2026-07-08, commit no fork):** handler
   `messages.update` — (a) expõe `error`/`errorMessage` (de `messageStubParameters`) no
   webhook (limpos antes do create em messageUpdate); (b) grava status ERROR no banco também
   p/ `fromMe` (antes só `!key.fromMe`), acabando com o PENDING eterno. Ver VENDORA-PATCHES.md.

## Mitigação operacional (o que a comunidade de fato usa)

Aquecer número novo (inbound-first, ramp gradual ~7d), não fazer cold-blast de mídia, parar
churn de recriação de instância, tratar taxa alta de 463 como sinal de saúde da conta.
Relacionado: [send-pipeline](send-pipeline.md) (tabela de acks: 451/463/473/475/479).
