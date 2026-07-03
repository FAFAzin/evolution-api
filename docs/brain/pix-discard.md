---
type: Investigation
title: PIX nativo (payment_info) descartado 100%
description: sendButtons type pix nunca renderiza — interactiveMessage sem body, flow de pagamento e ordem zerada são os suspeitos.
tags: [pix, payment_info, nativeFlow, sendButtons, discard]
timestamp: 2026-07-03T00:00:00Z
---

# PIX nativo — descarte 100%

**Sintoma:** `sendButtons` com botão `type: pix` → nativeFlow `payment_info` nunca renderiza,
mesmo com `buildInteractiveBizNode()` (fix que motivou o fork buildar do fonte da tag).
O vendora-bot contorna com `cta_copy` (`EVOLUTION_PIX_MODE=copy`).

## Como o PIX é montado

Branch exclusivo em `buttonMessage()` (whatsapp.baileys.service.ts ~linha 3691):

- `interactiveMessage.nativeFlowMessage.buttons = [{ name: 'payment_info', buttonParamsJson }]`
- `buttonParamsJson` (`toJSONString`, ~linha 3620): ordem **zerada** (total_amount 0, item com
  name vazio e quantity 0) + `payment_settings[0].pix_static_code` real (merchant_name, key, key_type).
- `messageParamsJson: { from: 'api', templateId: uuid }` (igual aos tipos que funcionam).
- Nó em claro: `<biz><interactive type="native_flow" v="1"><native_flow v="9" name="mixed"/></interactive></biz>`.

## Diferenças vs tipos que RENDERIZAM (reply/CTA/carrossel — mesmo relayMessage, mesmo biz node)

1. **Sem `body`/`header`/`footer`** — o branch PIX é o único interactiveMessage sem body;
   o branch CTA (funciona) sempre tem `body.text`. Suspeito nº 1.
2. **Natureza do flow**: `payment_info` é flow de pagamento — no oficial só sai de conta
   Business com ordem real; servidor pode strippar o nó biz de contas sem privilégio e o
   receptor descarta o flow sem a anotação.
3. **Ordem zerada**: total 0 / quantity 0 pode ser rejeitado por validação nova do receptor.

Descarte 100% (vs intermitente da lista) sugere validação determinística, não rollout.

## Diagnóstico (2026-07-03)

**Traces:** ack limpo + receipts sem retry → descarte no receptor (ou strip server-side da
anotação), igual à lista. **Pesquisa upstream (confiança ALTA):** `payment_info` é **gated
por conta com WhatsApp Pay/Business** — williamprado/whatsmeow#7 (30/06/2026) testou com
stanza corretíssima em conta comum e foi descartado; watinkdev#241 recebeu erro 473
"exige WhatsApp Pay". A comunidade inteira convergiu no workaround `cta_copy` (nosso
`EVOLUTION_PIX_MODE=copy`).

## Matriz de experimentos (2026-07-03, todos com send-trace)

| Biz node | Payload | Resultado |
|---|---|---|
| `mixed` | completo (order + payment_settings) | servidor aceita, **cliente descarta** (baseline histórico) |
| `payment_info` | completo | **ack 473** (self-chat E número real) |
| `payment_info` | mínimo estilo W-API (sem order/payment_settings) | **ack 473** |
| `mixed` | mínimo estilo W-API | ack limpo, **mas nunca entrega** (controle de texto no mesmo segundo entregou; PIX sem receipt do destinatário) |

## ✅ CASO ENCERRADO (2026-07-03)

**PIX nativo (`payment_info`) é impossível em conta sem WhatsApp Pay/Business — por
qualquer combinação de payload/anotação.** Todas as células da matriz falham: anotação
`payment_info` → 473 explícito; anotação `mixed` → aceite + drop silencioso pré-entrega
(payload completo E mínimo). Não é bug de código; é gating de capability da conta.

**Decisão:** `EVOLUTION_PIX_MODE=copy` (cta_copy) é a solução definitiva no vendora-bot.
O builder do fork mantém payload completo + biz `payment_info` — falha rápida e explícita
(473 vira `messages.update` status ERROR) em conta comum, e é o formato correto caso a
conta um dia tenha a capability. Reavaliar apenas se: conta Business com pagamentos
habilitados, ou upstream/comunidade demonstrar render em conta comum.

Referência W-API: o webhook deles ecoa payload mínimo — replicamos exatamente e não
entrega em conta comum; presumivelmente o produto deles roda em contas com capability.
Detalhe do probe: chave PIX em formato inválido também causa descarte silencioso.
