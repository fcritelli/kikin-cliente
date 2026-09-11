---
name: kikin-cliente-gateway
description: "Use ao implementar ou revisar chamadas do portal do cliente para a API do Kikin — assinatura HMAC do gateway, headers X-Service-*, escopo por salão, idempotência, ou ao mexer nos endpoints /internal/client-portal."
---

# Gateway do kikin-cliente (HMAC em nome do salão)

Decisão em `docs/ADR-002-gateway-auth.md` (status: **ACEITO**). Leia o ADR antes de
mudar qualquer coisa aqui — ele é a fonte, esta skill é o resumo operacional.

## O princípio

O portal executa operações que pertencem ao **domínio do estabelecimento** (ver
agenda, buscar cliente, criar/cancelar/remarcar agendamento). O gateway **se identifica
como o serviço `client-portal`** para o Kikin, de modo que:

- o Kikin aplica o **escopo de dados daquele salão** (nunca vê outro salão);
- as ações ficam contextualizadas no salão (auditoria aponta o salão);
- **o cliente final nunca recebe nem usa credenciais do dono do salão.**

## Mecanismo

HMAC-SHA256 sobre uma string canônica — o **mesmo padrão do kikin-admin**
(`generateAdminSignature` + `requireInternalAdmin`), com uma diferença que não pode ser
perdida de vista: **o segredo é dedicado ao client-portal**. O gateway **não herda
poderes do admin**.

```
METHOD:PATH:CANONICAL_QUERY:BODY_HASH:SERVICE_ID:TIMESTAMP:NONCE:SCOPE_HEADER
```

- `BODY_HASH` = sha256 do corpo; vazio quando `GET` sem corpo.
- `X-Service-Scope` **entra na assinatura** — por isso o escopo não pode ser adulterado.

### Headers

| Header | Conteúdo |
|---|---|
| `X-Service-Id` | identidade do serviço (`client-portal`) |
| `X-Service-Timestamp` | epoch ms (tolerância de skew, ex.: ±2 min) |
| `X-Service-Nonce` | UUID por chamada — anti-replay (TTL 2 min no Kikin) |
| `X-Service-Scope` | JSON do escopo assinado, ex.: `{"salonIds":["..."]}` |
| `X-Service-Signature` | HMAC-SHA256 da string canônica (hex) |
| `X-Trace-Id` | correlação |

O Kikin recomputa, compara **em tempo constante**, checa o nonce (replay) e o
timestamp (expiração). Replay além da janela → **401**.

### Idempotência

Mutações — `book`, `cancel`, `reschedule` — enviam `X-Idempotency-Key`, e o Kikin
deduplica. Uma retentativa de rede não pode virar dois agendamentos.

### Endpoints internos

`/internal/client-portal/...`, com middleware próprio no Kikin — mesmo esquema HMAC,
segredo e escopo distintos do `requireInternalAdmin`:

- `GET /clients?salon_id&hash_phone` — candidatos mascarados para o claim
- `GET /appointments?client_id&salon_id&future` — meus agendamentos
- `POST /book` — agenda via **slug** (mesma lógica do booking público)
- `POST /cancel`, `POST /reschedule`
- `POST /link` (opcional) — confirmar vínculo

## Fase 2 (white-label)

Mesmo esquema, com **chave por estabelecimento** emitida/revogada no kikin-admin: o
gateway assina com a chave do salão em questão e o Kikin valida o escopo pelo segredo
usado (menor privilégio e auditoria por salão). **A string canônica e os endpoints não
mudam** — se uma mudança sua alteraria a string canônica, ela quebra a Fase 2.

## Regras de segurança que não se negociam

- **Segredo nunca no browser.** Rotacionável, e distinto do segredo do admin.
- **Logs sem dado cru do cliente** — apenas hash ou máscara.
- Autenticação do cliente final é outra coisa: JWT via `requireAuth`
  (`server/src/middleware/auth.ts`), que exige `payload.type === "access"` e responde
  **401** com `{ code: "UNAUTHORIZED", error }`.

## Antes de considerar pronto

`npm run typecheck --prefix server`, `npm test --prefix server`, e `graphify update .`
