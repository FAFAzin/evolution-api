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

- **PIX nativo no formato W-API (RESOLVIDO 2026-07-03)** —
  `whatsapp.baileys.service.ts` (branch PIX de `buttonMessage`) +
  `helpers/interactiveMessage.helper.ts` (`buildPaymentBizNode`). Réplica byte-a-byte
  de uma mensagem PIX real da W-API capturada no wire pela instância staging. Quatro
  ajustes vs. o builder original: (1) nó biz **FLAT** `<biz native_flow_name="payment_info"/>`
  em vez do aninhado (o aninhado dispara o gate **473** do servidor); (2)
  `interactiveMessage.header = { hasMediaAttachment: false }`; (3)
  `nativeFlowMessage.messageVersion = 1`; (4) `templateId` numérico +
  `messageContextInfo.messageSecret` (destrava a entrega). **Renderização confirmada em
  aparelho real** enviando de conta Business (produção sempre usa Business). Diagnóstico
  completo e histórico dos experimentos (bot node → 451; matriz mixed×payload): `docs/brain/pix-discard.md`.

- **Teto de conexões do Prisma (2026-07-05)** — `repository.service.ts`
  (`cappedDbUrl` no construtor do `PrismaRepository`). Impõe `connection_limit`
  default (5, override `EVOLUTION_DB_CONNECTION_LIMIT`) na `DATABASE_CONNECTION_URI`
  se ela não tiver um. Motivo: `max_connections` do Postgres é do servidor inteiro;
  sem teto, o pool default da Evolution somou com web+worker do vendora no Postgres
  compartilhado de staging e estourou ("too many clients"), derrubando páginas
  (dashboard/ofertas) e login. Blinda a imagem mesmo se a env do Railway esquecer o
  `?...&connection_limit=`. No-op se a URI já tem o param.

- **Detecção do gate de passkey "Shortcake" (2026-07-05)** —
  `whatsapp.baileys.service.ts` (campo `passkeyRequired` + listeners
  `CB:notification,type:passkey_prologue_request` / `crsc_continuation`, reset a cada
  tentativa de conexão) + `instance.controller.ts` (exposto em
  `/instance/connectionState`). Contexto: rollout server-side da Meta (~29-30/06)
  exige assertion WebAuthn (rpId whatsapp.com, userVerification required) DEPOIS do
  registro de companion — cliente headless não consegue assinar, o pareamento nunca
  conclui e a instância regenerava QR para sempre. O patch só DETECTA e sinaliza
  (sem ack/handshake — suporte de protocolo não mergeado upstream;
  acompanhar WhiskeySockets/Baileys#2689 e evolution-foundation/evolution-api#2618).
  O dashboard do vendora usa a flag para parar o loop de QR e orientar o usuário.

- **Bridge de sessão via browser (2026-07-05)** — `instance.controller.ts`
  (`exportSession`/`importSession` + helpers `assertGlobalKey`/`resolveInstanceId`),
  `instance.router.ts` (rotas `GET /instance/exportSession/{name}`,
  `POST /instance/importSession/{name}`) e `dto/import-session.dto.ts`. Escape para
  contas gated por passkey (nos moldes do ConnectorZ da Z-API): loga a conta no
  web.whatsapp.com real, extrai a sessão e injeta aqui. `importSession` grava
  `creds` (string BufferJSON) no formato EXATO do `saveKey` do
  `use-multi-file-auth-state-prisma` (`Session.creds = JSON.stringify(<string
  BufferJSON>)` — duplo-encode intencional; o loader faz `JSON.parse` +
  `BufferJSON.reviver`), valida shape mínimo (`noiseKey` + `me.id`) e recarrega o
  socket. `exportSession` é o formato de referência + hook do teste de round-trip
  (`scripts/evolution-session-roundtrip.ts` no vendora). **Ambos exigem a GLOBAL
  API key** — exfiltrar creds é escalonamento mais forte que o token da instância
  (sessão clonada sobrevive à rotação de token). Server-side só (a extensão que
  produz as creds do browser fica no vendora, ainda não implementada).

## Config operacional (Railway staging, não é patch de código)

- **`CONFIG_BAILEYS_VERSION=2.3000.1040300918`** — pin da versão anunciada do WA Web.
  **É o fix da lista** (renderização confirmada em aparelho real, 2026-07-03): o bump de
  jun/2026 (>= 2.3000.1040549582) passou a exigir bot node que conta comum não pode usar
  (ack 451). Risco: versões velhas são recusadas no handshake com o tempo (405) — se a
  instância parar de conectar, reavaliar (alternativas mapeadas em
  `docs/brain/sendlist-discard.md`).
- **Instrumentação send-trace removida** (2026-07-03) — os logs `[send-trace]` e os
  listeners `CB:ack,class:message`/`CB:receipt` cumpriram o papel de diagnóstico e foram
  retirados; `LOG_BAILEYS` pode voltar a `error` e `LOG_LEVEL` ao padrão.

## Regras

1. Patch set mínimo — só correções que nos bloqueiam; nunca features próprias.
2. Todo patch listado aqui com link do commit/issue upstream.
3. Quando o upstream lançar release estável cobrindo os patches, rebase e
   retorno à imagem oficial (ou rebase da vendora-stable na nova tag).

## Build

GitHub Actions (`publish-vendora-image.yml`) → `ghcr.io/<owner>/evolution-api:vendora-2.4.0-rc2`
(+ tag `sha-<commit>` imutável para pin em produção).
