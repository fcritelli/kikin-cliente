# ADR-002 — O gateway “age em nome do salão” (autenticação na API do Kikin)

Status: **ACEITO** (MVP: token de serviço; Fase 2: chave por estabelecimento)

## O que significa “agir em nome do salão”
O portal realiza operações que pertencem ao **domínio do estabelecimento** na API do Kikin
(ver agenda/disponibilidade, buscar cliente por hash, criar/cancelar/remarcar agendamento).
“Agir em nome do salão” = o **gateway se identifica como o estabelecimento** para o Kikin, de
modo que:

- o Kikin aplica o **escopo de dados daquele salão** (nunca vê outro salão);
- as ações ficam **contextualizadas no salão** (logs/auditoria do lado Kikin apontam o salão);
- o **cliente final nunca recebe/usa credenciais do dono do salão** — o portal é o único
  autorizado, com credencial própria.

Não usamos a senha do dono nem o token do kikin-admin para isso.

## Mecanismo
### MVP — Token de serviço dedicado (recomendação aceita)
- O gateway possui um **segredo de serviço** (estilo do `KIKIN_SERVICE_TOKEN`/HMAC usado pelo
  kikin-admin) e chama **endpoints internos NOVOS e restritos** no Kikin
  (`/internal/client-portal/...`), com middleware próprio (não o do admin).
- Cada chamada carrega `salon_id`; o Kikin **valida o escopo pelo token** (por enquanto o token
  é único e confiável — o gateway é quem resolve a qual salão a conta está vinculada).
- Fluxo do "claim": o portal envia `{ hash_phone }` e `salon_id`; o Kikin devolve os clientes
  que casam por aquele hash **naquele salão** (nunca por outro).
- Agendar novo: o gateway chama o Kikin na **mesma lógica do booking público via slug**
  (`/booking/:slug/book` interno), com os dados do cliente logado.
- Cancelar/remarcar: endpoints de sessão autenticados no portal que acionam o Kikin com o
  `client_id` vinculado.

### Fase 2 (white-label / multi-cliente) — Chave de API por estabelecimento
- Cada salão ganha uma chave `client_portal_*` (emitida/revogada no kikin-admin).
- O gateway usa a chave **do estabelecimento** para o qual está agindo; o Kikin valida escopo
  por salão (menor privilégio) e auditoria por salão.
- Os endpoints internos permanecem os mesmos — muda só a autenticação/autorização.

## Contrato (próximo passo)
Endpoints internos a detalhar (método, request/response, erros):
- `GET /internal/client-portal/clients?salon_id&hash_phone` (busca candidatos mascarados)
- `GET /internal/client-portal/appointments?client_id&salon_id&future`
- `POST /internal/client-portal/book` (via slug; corpo com client_id/serviços/horário)
- `POST /internal/client-portal/cancel` e `.../reschedule`
- `DELETE /internal/client-portal/link` (desvincular conta, opcional)

## Segurança
- Rate limit por IP e por usuário do portal; o token de serviço nunca exposto ao browser.
- Logs sem dados cru do cliente (hash/máscara apenas).
