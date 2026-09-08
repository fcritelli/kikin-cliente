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
  (nunca número cru), candidatos mascarados, confirmação "sou eu" e listagem de próximos
  agendamentos. Tabela `account_establishment_links` (hash + máscara; telefone único por conta).
- `kikin/` — cliente HMAC da API interna do Kikin (ADR-002): `/internal/client-portal` com
  `GET /salons`, `GET /clients` (hash_phone), `GET /appointments` — implementados no backend do
  Kikin (middleware `requireClientPortalService`, salões autorizados por env).
- Regras de negócio do social:
  1. E-mail do provedor já existe no portal → **vincula** `google_id`/`microsoft_id` (se for o
     primeiro acesso social), marca e-mail verificado e **entra direto** (`SUCCESS`).
  2. E-mail não existe → devolve `NEED_SETUP` com `tempToken` (15 min); o web mostra o mini passo
     pós-OAuth (nome + aceite de termos LGPD) e chama `/accounts/social/complete` para criar a conta.

## Web (web/src)
- Rotas: `/` (Home), `/login`, `/cadastro`, `/auth` (callback OAuth + mini passo NEED_SETUP),
  `/conta` (área do cliente pós-login, protegida), `/termos` e `/privacidade`.
- `contexts/AuthContext.tsx` valida a sessão salva via `/accounts/me` no boot e tenta `refresh`
  quando o access token expirou; `lib/api.ts` centraliza o cliente HTTP e os helpers de OAuth.

## Agendar novo
Reusa a **mesma lógica do booking público do Kikin (via slug do estabelecimento)**, com dados
do cliente logado pré-preenchidos. Cancelar/remarcar usam endpoints de sessão (autenticados).

## Fases
Ver `ROADMAP.md`.
