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
