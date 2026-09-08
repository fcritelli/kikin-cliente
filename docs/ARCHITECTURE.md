# kikin-cliente — Arquitetura (v1)

## Visão

```
┌────────────────────── cliente.kikin.com.br ──────────────────────┐
│  Frontend Cliente (React, white-label por estabelecimento)        │
│    https://cliente.kikin.com.br                                   │
│    https://saladofernando.cliente.kikin.com.br  (fase futura)     │
│                  │                                                │
│  Gateway API Cliente (backend próprio — novo serviço)            │
│   • Contas do cliente final (e-mail+senha) e sessões [DB própria] │
│   • Vínculo cliente ↔ estabelecimento (hash LGPD)                 │
│   • Orquestração com a API do Kikin (agenda, catálogo, booking)   │
│   • Consentimento/LGPD (export/exclusão)                          │
│                  │                                                │
│        HTTP — age em nome do salão (ADR-002)                      │
│                  ▼                                                │
│  Kikin API (ex.: hml.kikin.com.br/api)                            │
│   clientes, agendamentos, serviços, profissionais, booking/slug   │
└───────────────────────────────────────────────────────────────────┘
```

## Princípios
- **Não misturar** com o app de gestão do salão nem com o kikin-admin.
- O Kikin continua dono da verdade de agenda/catálogo; o portal é a camada do cliente.
- **LGPD first**: telefone/CPF do cliente nunca em claro no portal (máscara + hash); consentimento;
  exportar/excluir.
- Segurança de rede (lições anteriores): rate limit por IP e por usuário, verificação de
  e-mail, reset de senha, anti-bot no signup.

## Decisões aceitas
- ADR-001: conta do cliente em **banco próprio do portal**; vínculo com `clients` do Kikin por
  **hash** (LGPD); “claim” no primeiro acesso.
- ADR-002: gateway **age em nome do salão** — MVP com assinatura HMAC (padrão kikin-admin) + endpoints
  internos restritos; Fase 2 com chave de API por estabelecimento.
- Login social (Fase 1): Google/Microsoft no **mesmo padrão do Kikin** — o web redireciona para o
  provedor (`response_type=code`) e o gateway troca o código server-side (`GOOGLE_CLIENT_ID/SECRET`,
  `MICROSOFT_CLIENT_ID/SECRET`), validando o e-mail verificado do provedor. O retorno cai em
  `CLIENT_APP_URL + '/auth'` (rota `/auth` do web).

## Estrutura do gateway (server/src/modules)
- `accounts/` — `accounts.service.ts` (signup, verificação/reset de e-mail, login, sessões com
  refresh rotativo) e `social.service.ts` (troca/validação do código OAuth, vínculo ou criação de
  conta). Em `client_accounts`, contas sociais guardam `google_id`/`microsoft_id` (único, parcial),
  `avatar_url` e `auth_provider`; `password_hash` fica nulo quando a conta é 100% social.
- `links/` — vínculo conta ↔ `client(s)` do Kikin (ADR-001): claim por telefone com hash HMAC
  (nunca número cru), candidatos mascarados de TODOS os salões (sem escolha de estabelecimento),
  confirmação "sou eu", listagem de próximos agendamentos e **auto-vínculo pós-booking**
  (`/links/auto` — o agendamento recém-feito vincula o client daquele salão sem confirmação).
  Tabela `account_establishment_links` (hash + máscara; multi-vínculo por conta; dedupe entre contas).
- `booking/` — proxy do booking **público** do Kikin (`GET/POST /booking/:slug/{salon,services,
  staff,slots,book}` via `KIKIN_PUBLIC_URL`) e `GET /booking/salons` (catálogo p/ "Agendar novo").
  O Kikin continua dono da agenda/catálogo; o portal reusa o mesmo contrato do `/agendar` antigo.
- `kikin/` — cliente HMAC da API interna do Kikin (ADR-002): `/internal/client-portal` com
  `GET /salons`, `GET /clients/search` (hash_phone global), `GET /appointments` e os POSTs
  `/cancel` e `/reschedule` — implementados no backend do Kikin (middleware
  `requireClientPortalService`). Todos os salões participam; controle "salão tem/não tem portal"
  fica para o kikin-admin (decisão de produto, fase futura).
- Política da área do cliente (cancelar/remarcar) vive **no Kikin**: janela de cancelamento (default
  6h, por salão via `settings.clientPortal`) + limite suave móvel (default 3 eventos — cancelamentos
  do cliente com nota `[portal]` + no-shows — em 30 dias); erros tipados
  (`CANCELLATION_WINDOW_CLOSED`, `ABUSE_LIMIT_REACHED`) repassados pelo gateway à UI.
  Remarcação = **troca atômica**: cria o novo grupo de horários e só então cancela o antigo, tudo
  numa transação; a UI pede intenção explícita antes de mostrar o seletor de novo horário.
- Regras de negócio do social:
  1. E-mail do provedor já existe no portal → **vincula** `google_id`/`microsoft_id` (se for o
     primeiro acesso social), marca e-mail verificado e **entra direto** (`SUCCESS`).
  2. E-mail não existe → devolve `NEED_SETUP` com `tempToken` (15 min); o web mostra o mini passo
     pós-OAuth (nome + aceite de termos LGPD) e chama `/accounts/social/complete` para criar a conta.

## Web (web/src)
- Rotas: `/` (Home), `/login`, `/cadastro`, `/auth` (callback OAuth + mini passo NEED_SETUP),
  `/agendar/:slug` (booking — o link que o salão passa), `/conta` (área do cliente pós-login,
  protegida), `/termos` e `/privacidade`.
- `contexts/AuthContext.tsx` valida a sessão salva via `/accounts/me` no boot e tenta `refresh`
  quando o access token expirou; `lib/api.ts` centraliza o cliente HTTP e os helpers de OAuth.
- `/agendar/:slug`: serviços → profissional → data/horário (disponibilidade real do Kikin) → dados
  → confirmar. Logado → vínculo automático na hora; convidado → "criar conta e acompanhar" guarda o
  contexto `{salonId, phone}` (sessionStorage) para o `/conta` vincular sozinho após o cadastro.

## Agendar novo
O portal **proxy** os endpoints públicos do booking do Kikin (mesmo contrato do `/agendar` antigo),
com a área logada pré-preenchendo o fluxo; o vínculo com o client é consequência do agendamento.
Cancelar/remarcar usam endpoints de sessão (autenticados) — fase seguinte.

## Fases
Ver `ROADMAP.md`.
