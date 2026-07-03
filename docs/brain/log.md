---
type: Log
---
2026-07-03 — initialized OKF knowledge base (mega-brain)
2026-07-03 — documented send pipeline + list/pix discard investigations (análise estática dos dois caminhos)
2026-07-03 — added [send-trace] instrumentation patch (relay + ack + receipt) to locate discard stage
2026-07-03 — traces: ack/receipts limpos p/ list e pix → descarte é validação do receptor (estágio 3)
2026-07-03 — causa raiz lista: WA Web >=2.3000.1040549582 exige bot node biz_bot=1 em 1:1 (InfiniteAPI#494); fix aplicado
2026-07-03 — pix: gated por WhatsApp Pay (alta confiança); biz node corrigido p/ payment_info; copy segue default
2026-07-03 — reteste fix v1: bot node → servidor REJEITA (ack 451 lista); pix payment_info → ack 473 = confirmação do gating; bot node revertido
2026-07-03 — pin CONFIG_BAILEYS_VERSION=2.3000.1040300918 no staging: lista volta a ack limpo + receipts; aguardando confirmação de renderização no aparelho
