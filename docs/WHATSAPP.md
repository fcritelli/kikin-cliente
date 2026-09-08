# WhatsApp no Portal do Cliente — Estrutura de configuração e comunicação

Status: **estrutura implementada** — cadastro/login por OTP + mensagens plugáveis.
Transporte dev = `log` (não envia de verdade; código registrado e retornado). Provedor real
(Meta Cloud API ou Z-API) = só preencher env.

## Como o número é tratado (LGPD)
- **Em repouso:** nunca texto plano. Guardamos `hash` (busca/unicidade), `máscara` (exibição) e o
  valor **criptografado AES-256-GCM** (`client_accounts.whatsapp_phone_enc`; chave
  `WHATSAPP_PHONE_KEY`), usado apenas em memória para enviar.
- **Em trânsito:** o número chega no request (cadastro/OTP) ou é decriptado na hora do envio —
  nunca logado.

## Configuração (env do gateway)
```env
WHATSAPP_PROVIDER=log|meta|zapi
WHATSAPP_META_TOKEN=...          # Meta Cloud API
WHATSAPP_META_PHONE_ID=...
WHATSAPP_ZAPI_INSTANCE=...
WHATSAPP_ZAPI_TOKEN=...
WHATSAPP_DEV_RETURN_CODE=true    # dev: código OTP volta na resposta
WHATSAPP_PHONE_KEY=...           # AES-256-GCM (produção obrigatório)
```

## Cadastro/login por WhatsApp (OTP)
- POST `/accounts/whatsapp/request` `{phone}` → gera código 6 dígitos (hash), envia por WhatsApp,
  10 min; em dev responde `devCode`.
- POST `/accounts/whatsapp/verify` `{phone, code}` → `LOGIN` (conta com esse número) ou
  `NEED_REGISTER` (+`tempToken`).
- POST `/accounts/whatsapp/register` `{tempToken, fullName, consent, email?}` → cria a conta
  (e-mail **opcional**; `auth_provider='whatsapp'`) e **vincula automaticamente** todos os salões
  onde o número já está cadastrado (recuperação silenciosa; prova = OTP).
- UI: “Entrar com o WhatsApp” no login/cadastro (número → código → nome/termos quando novo).

## Mensagens automáticas (gatilhos)
| Evento | Destino |
|---|---|
| Confirmação de agendamento (novo/remarcado) | Cliente (opt-in) |
| Cancelamento/remarcação | Cliente (opt-in) e **salão** (aviso p/ agir) |
| OTP de cadastro/login | Cliente |
- Regra: cliente só recebe com opt-in (`whatsapp_optin_at`); salão recebe aviso no número dele.
- Falhas de envio **nunca quebram** o fluxo (logadas).

## Transportes
- `log`: registra a mensagem e (dev) expõe o código — permite desenvolver tudo sem provedor.
- `meta`: WhatsApp Cloud API (`graph.facebook.com/.../messages`).
- `zapi`: gateway BR (`send-text`).
- Padrão: falha controlada + configuração por env; adicionar provedor = novo caso no `sendWhatsApp`.

## Futuro
- Webhook de status/delivery e template OTP aprovado (Meta exige template de autenticação).
- Lembrete 24h/2h (job) e fila de mensagens.
- “Falar com o salão” via wa.me já disponível nos modais (número público do salão).
