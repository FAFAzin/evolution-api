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

## Próximo passo

Mesma instrumentação de [send-pipeline](send-pipeline.md); teste A/B: PIX com body preenchido
e/ou total_amount > 0 vs atual, na instância `vendora_cmr40kiah0006hkdstmybpd68`.
