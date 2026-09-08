# ADR-002 — O gateway “age em nome do salão” (autenticação na API do Kikin)

Status: **ACEITO** (revisado: mesmo esquema seguro do kikin-admin — HMAC assinado)

## O que significa “agir em nome do salão”
O portal realiza operações que pertencem ao **domínio do estabelecimento** na API do Kikin
(ver agenda/disponibilidade, buscar cliente por hash, criar/cancelar/remarcar agendamento).
“Agir em nome do salão” = o **gateway se identifica como o estabelecimento** para o Kikin, de
modo que:

- o Kikin aplica o **escopo de dados daquele salão** (nunca vê outro salão);
- as ações ficam **contextualizadas no salão** (logs/auditoria apontam o salão);
- o **cliente final nunca recebe/usa credenciais do dono do salão**.

## Mecanismo — mesmo padrão seguro do kikin-admin
Em vez de bearer token simples, cada chamada do gateway é **assinada com HMAC-SHA256** de uma
string canônica, exatamente como o `kikin-admin` → Kikin (`generateAdminSignature` +
`requireInternalAdmin`). Diferenças: identidade é o **serviço (gateway)**, não um operador
humano, e o segredo é **dedicado ao client-portal** (não reusa o do admin).

### Headers
| Header | Conteúdo |
| --- | --- |
| `X-Service-Id` | identidade do serviço (`client-portal`) — equivale ao `X-Admin-User-Id` |
| `X-Service-Timestamp` | epoch ms (tolerância de skew, ex.: ±2 min) |
| `X-Service-Nonce` | UUID por chamada (anti-replay; cache TTL 2 min no Kikin) |
| `X-Service-Scope` | JSON com o escopo assinado (ex.: `{"salonIds":["..."]}`) — como o `X-Admin-Permissions` |
| `X-Service-Signature` | HMAC-SHA256 da string canônica (hex) |
| `X-Trace-Id` | correlação |

### String canônica (igual à do admin, com escopo no lugar de permissões)
```
METHOD:PATH:CANONICAL_QUERY:BODY_HASH:SERVICE_ID:TIMESTAMP:NONCE:SCOPE_HEADER
```
- `BODY_HASH` = sha256 do corpo (vazio quando GET sem corpo).
- `X-Service-Scope` entra na assinatura (não pode ser adulterado).
- Verificação no Kikin: recomputa, compara em tempo constante, checa nonce (replay) e
  timestamp (expiração). Replay além da janela → 401.

### Idempotência
Mutações (`book`, `cancel`, `reschedule`) enviam `X-Idempotency-Key` e o Kikin deduplica
(como as ações do kikin-admin).

### Endpoints internos (roteador dedicado no Kikin)
`/internal/client-portal/...` com **middleware próprio** (mesmo esquema HMAC, porém segredo e
escopo distintos do `requireInternalAdmin` — o gateway NÃO herda poderes do admin):
- `GET /clients?salon_id&hash_phone` — candidatos mascarados p/ o claim;
- `GET /appointments?client_id&salon_id&future` — meus agendamentos;
- `POST /book` — agenda via **slug** (mesma lógica do booking público) com dados do cliente;
- `POST /cancel` e `POST /reschedule`;
- `POST /link` (opcional) — confirmar vínculo.

## Fase 2 (white-label / multi-cliente) — chave por estabelecimento
Mesmo esquema HMAC, com **chave (segredo) por estabelecimento** emitida/revogada no kikin-admin:
o gateway assina com a chave do salão em questão; o Kikin valida escopo pelo segredo usado
(menor privilégio, auditoria por salão). Não muda a string canônica nem os endpoints.

## Segurança resumida
- HMAC + nonce + timestamp + escopo assinado + idempotency (não é bearer simples).
- Segredo dedicado ao client-portal (rotacionável); nunca no browser.
- Logs sem dado cru do cliente (hash/máscara apenas).
