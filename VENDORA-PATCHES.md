# Fork vendora.bot — política de patches

Fork mínimo da Evolution API para uso self-hosted do vendora.bot.

## Por quê

- A imagem Docker Hub `2.4.0-rc2` NÃO corresponde ao fonte da tag git
  `2.4.0-rc2`: o fonte da tag já contém o fix do botão PIX nativo
  (buildInteractiveBizNode em buttonMessage), a imagem publicada não.
- Buildar do fonte da tag garante integridade fonte↔imagem e nos dá
  autonomia para correções pontuais sem esperar release upstream.

## Base

- Branch `vendora-stable` = tag upstream `2.4.0-rc2` (commit 5624bda)
  + arquivos deste fork (workflow de build e este documento).

## Patches de código aplicados

- **biz `payment_info` no PIX** — `whatsapp.baileys.service.ts` +
  `helpers/interactiveMessage.helper.ts`: anuncia `native_flow name="payment_info"`
  no biz node do PIX (antes: `mixed`), formato conforme oxidezap/whatsapp-rust#628 e
  InfiniteAPI. Resultado: o servidor passou a responder **ack error=473** ("exige
  WhatsApp Pay") em vez de aceitar e descartar — confirma que PIX nativo é gated por
  conta Business com pagamentos; workaround permanece `EVOLUTION_PIX_MODE=copy` no
  vendora-bot. Diagnóstico: `docs/brain/pix-discard.md`.
- **bot node (`<bot biz_bot="1"/>`) — TESTADO E REVERTIDO (2026-07-03)**: injetado em
  interativas 1:1 conforme InfiniteAPI#494, o servidor rejeitou o envio com ack
  error=451 (listMessage, conta comum, self-chat). Helper `buildBotNode()` mantido
  para experimentos. Diagnóstico: `docs/brain/sendlist-discard.md`.

- **send-trace (debug, temporário)** — `whatsapp.baileys.service.ts`: logs `[send-trace]`
  (nível DEBUG) correlacionando envio interactive/list (`relayMessage`) com ack do servidor
  (`CB:ack,class:message`) e receipts de dispositivo (`CB:receipt`). Suporte à investigação
  dos descartes de lista/PIX (`docs/brain/sendlist-discard.md`, `docs/brain/pix-discard.md`).
  Sem issue upstream — patch de instrumentação do fork; remover quando a causa for isolada.
  Ativação: `LOG_LEVEL` contendo `DEBUG` (stanza XML completa: `LOG_BAILEYS=trace`).

## Regras

1. Patch set mínimo — só correções que nos bloqueiam; nunca features próprias.
2. Todo patch listado aqui com link do commit/issue upstream.
3. Quando o upstream lançar release estável cobrindo os patches, rebase e
   retorno à imagem oficial (ou rebase da vendora-stable na nova tag).

## Build

GitHub Actions (`publish-vendora-image.yml`) → `ghcr.io/<owner>/evolution-api:vendora-2.4.0-rc2`
(+ tag `sha-<commit>` imutável para pin em produção).
