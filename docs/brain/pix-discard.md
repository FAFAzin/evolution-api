---
type: Investigation
title: PIX nativo (payment_info) — RESOLVIDO (formato W-API)
description: "RESOLVIDO 2026-07-03: PIX nativo renderiza com biz node FLAT + header + messageVersion=1 + messageSecret, de conta Business. Réplica capturada da W-API no wire."
tags: [pix, payment_info, nativeFlow, sendButtons, resolved]
timestamp: 2026-07-03T00:00:00Z
---

# ✅ RESOLVIDO (2026-07-03) — receita que renderiza

Enviando de **conta Business**, PIX nativo renderiza no destinatário com este formato
(réplica byte-a-byte de uma mensagem real da W-API capturada no wire da instância staging):

1. Nó biz **FLAT** em claro: `<biz native_flow_name="payment_info"/>` (NÃO o aninhado —
   o aninhado dispara ack 473 do servidor).
2. `interactiveMessage.header = { hasMediaAttachment: false }`.
3. `nativeFlowMessage.messageVersion = 1`.
4. `templateId` numérico (Date.now()) + `messageContextInfo.messageSecret` (32 bytes).
5. `buttonParamsJson` = payload completo (order + payment_settings + pix_static_code) —
   idêntico ao que já tínhamos; nunca foi o problema.

Confirmado em aparelho real (2 envios, ack limpo + delivery receipts). Código:
`buildPaymentBizNode` + branch PIX de `buttonMessage`. **Requer remetente Business**
(produção do vendora-bot sempre usa) → `EVOLUTION_PIX_MODE=native` viável.

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

## 🔬 CAPTURA DA W-API NO WIRE (2026-07-03) — a virada

Recebemos um PIX real da W-API na instância staging (receptor Baileys, `LOG_BAILEYS=trace`)
e comparamos stanza + proto decriptado com o nosso. **O payload de pagamento é IDÊNTICO**
(o webhook da W-API era truncado; eles mandam `pix_static_code` completo). A diferença é a
EMBALAGEM:

| Campo | W-API (renderiza) | Nosso antigo (não) |
|---|---|---|
| **Nó biz (wire)** | **FLAT** `<biz native_flow_name='payment_info'/>` | aninhado `<biz><interactive><native_flow name='payment_info'/>` → **473** |
| **stanza type** | `text` (passa limpo) | `text` mas biz aninhado → gate |
| `interactiveMessage.header` | `{ hasMediaAttachment: false }` | ausente |
| `nativeFlowMessage.messageVersion` | `1` | ausente |
| `templateId` | numérico (ms) | UUID string |
| conta remetente | Business (`verified_name` na stanza) | — |

**Fix aplicado (commit 070d013c):** `buildPaymentBizNode()` (flat) + header + messageVersion=1
+ templateId numérico + messageSecret. Réplica byte-a-byte do que a W-API emite. Requer
remetente Business (produção sempre usa). Resultado do teste: ver log.

**Histórico (por que demorou):** matriz `mixed`×payload e `payment_info` aninhado foram todas
testadas antes desta captura e falhavam (473 ou drop). O `messageSecret` destravou a ENTREGA;
o nó biz FLAT destrava o GATE 473; header/messageVersion completam o formato que RENDERIZA.
Detalhe do probe: chave PIX em formato inválido também causa descarte silencioso.
