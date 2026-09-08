# WhatsApp no Portal do Cliente — Estrutura (estágio: consentimento + seams; provedor depois)

Status: design aceito na sessão de produto (sem provedor conectado ainda).

## Princípio
- O **telefone do vínculo É o número do WhatsApp** (identificador). Normalização BR com DDI 55;
  **nunca** guardamos o número cru — apenas `phone_hash` (HMAC, salt = segredo do serviço) e
  `phone_masked`. Isso já é o que `account_establishment_links` faz.
- WhatsApp é um **canal plugável** (confirmação, lembrete, aviso de cancelamento/remarcação,
  OTP de verificação). Nenhuma implementação de envio existe ainda — os pontos de gatilho e o
  consentimento já ficam prontos.

## Consentimento (LGPD) — já implementado
- `account_establishment_links.whatsapp_optin_at` (timestamptz): registrado quando o cliente
  confirma que o número é o WhatsApp dele e autoriza confirmações/lembretes.
- Captura nos pontos de primeiro contato:
  - **Booking** (`/agendar/:slug`, passo "Seus dados"): checkbox *"Confirmo que este número é meu
    WhatsApp e aceito receber a confirmação do agendamento e lembretes por ele."*
  - **Claim** (`/conta` → "Encontre seus agendamentos"): mesmo checkbox.
  - Logado: o opt-in é repassado ao auto-vínculo (`/links/auto`); convidado → contexto em
    sessionStorage é levado ao cadastro → auto-vínculo grava o opt-in.
- **Sem opt-in** → continua agendando normalmente (telefone só como identidade); envios de
  WhatsApp só ocorrem com `whatsapp_optin_at` presente.

## Gatilhos mapeados (futuro)
| Evento | Canal/destino |
|---|---|
| Confirmação de agendamento (criado/remarcado) | Cliente (opt-in) e salão |
| Lembrete (ex.: 24h / 2h antes) | Cliente (opt-in) |
| Cancelamento/remarcação | Salão (aviso) |
| Verificação/OTP de número (provar que é o WhatsApp do cliente) | Cliente — quando implementarmos |
| "Falar com o salão" | Cliente — **já funciona** via `https://wa.me/<telefone do salão>` (número público do salão) |

## Seam técnico (para quando houver provedor)
```
interface WhatsAppSender {
  send(input: { to: WaId; template: "booking_confirmed" | "reminder" | "salon_notified" | "otp"; vars: Record<string,string> }): Promise<void>;
}
```
- `WaId` = telefone normalizado com DDI (55…) — já é o formato que o portal usa no hash.
- Provedores candidatos: Meta WhatsApp Cloud API (oficial), Twilio, Z-API/Evolution (gateways BR).
- Config futura: `WHATSAPP_PROVIDER` + credenciais no gateway; hooks chamados após os eventos
  acima, sempre guardando falhas em log (nunca quebra o fluxo de agendamento).

## Fora de escopo agora
- Envio/OTP real, templates aprovados pelo Meta, fila de mensagens, webhook de status.
- Número do salão como WhatsApp oficial do estabelecimento (curadoria do salão no admin).
