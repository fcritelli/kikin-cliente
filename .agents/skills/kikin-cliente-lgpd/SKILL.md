---
name: kikin-cliente-lgpd
description: "Use ao mexer em exclusão de conta, lista de supressão, opt-in de WhatsApp, ou ao restaurar backup do banco do portal — o kikin-cliente trata dados do cliente final e responde a pedidos de eliminação sob a LGPD."
---

# LGPD e exclusão de conta no kikin-cliente

O portal trata dados do **cliente final**. A exclusão de conta aqui **não é soft delete
nem anonimização**: é `DELETE` real de linhas. Isso tem consequências operacionais que
esta skill existe para não deixar passar.

Fonte: `docs/SUPPRESSION-LIST.md` e `server/src/modules/lgpd/lgpd.service.ts`.

## A regra operacional mais importante

**Toda vez que você restaurar um backup/dump do banco do portal** — drill de restore,
recuperação de incidente, clonagem de ambiente a partir de produção, importação de
dados — **rode a lista de supressão**. Um dump anterior a um pedido de exclusão
**ressuscita** contas que o titular mandou apagar. Sem reaplicar, a exclusão deixa de ser
definitiva e o portal volta a tratar dados de quem pediu para sair — violando o Art. 18,
VI.

```bash
# 1) DRY-RUN — padrão, não apaga nada. SEMPRE comece por aqui.
npm run suppression:report --prefix server

# 2) Saída estruturada, para guardar como evidência (Art. 37)
npm run suppression:report --prefix server -- --json

# 3) APPLY — só depois de conferir `matched` no report
npm run suppression:apply --prefix server
```

Equivalentes: `SUPPRESSION_APPLY=true npx tsx server/src/scripts/apply-suppression-list.ts`,
`--apply`, `--json`, `--dry-run`. **`--dry-run` vence `--apply`** quando os dois aparecem.
A primeira linha do log sempre declara o modo ativo — `MODO: DRY-RUN — NADA será apagado`
ou `MODO: APPLY — as contas suprimidas serão APAGADAS agora`. Se essa linha não estiver
onde você espera, pare.

## O que a auditoria guarda (e o que ela deliberadamente não guarda)

`account_deletion_log` **não tem FK** — de propósito, para sobreviver à exclusão. Ela
guarda só pseudônimos:

| Coluna | Conteúdo |
|---|---|
| `account_ref_hash` | `HMAC-SHA256(KIKIN_CLIENT_PORTAL_SECRET, id da conta)` via `accountRefHash()` — é a **chave** da supressão |
| `email_hash` | HMAC do e-mail normalizado |
| `proof_method` | `password` \| `whatsapp_otp` — qual prova de identidade foi exigida |
| `removed_counts` | contagens por tabela — prova do que foi apagado |
| `ip_hash` | HMAC do IP; **nunca o IP cru** |

Nunca PII em claro. Preserve isso: é o que permite provar a exclusão sem recriar o dado
que ela deveria eliminar.

## Garantias que a rotina oferece — não as quebre

- **Fonte única das tabelas:** `PORTAL_ACCOUNT_TABLES` + `DELETION_ORDER` em
  `lgpd.service.ts`. Não crie lista paralela de tabelas em lugar nenhum; use
  `purgePortalAccountRows(tx, accountId)`, a mesma função da exclusão original.
- **Uma transação por conta:** as 7 tabelas saem juntas ou nenhuma sai. Supressão pela
  metade — conta de volta com dados órfãos — não é aceita.
- **Idempotente:** aplicada a supressão, a conta não existe mais em `client_accounts`; uma
  segunda execução traz `matched: []`. Pode rodar quantas vezes quiser.
- **Sem PII na saída:** apenas hash curto (12 chars) e contagens. Erros são sanitizados
  (o id vira `[id]`) antes de ir para o log.
- **Exit code:** `0` = nada a fazer; `1` = alguma conta deveria ter sido suprimida e não
  foi. Trate a falha e rode de novo.
- **Não reescreve a auditoria:** nada de inserir ou apagar linhas em
  `account_deletion_log` — isso criaria registros duplicados a cada execução.

## O que a rotina NÃO faz (e não deve passar a fazer)

- **Não toca no Kikin.** Nenhuma leitura, escrita ou chamada de rede. Cadastro,
  agendamentos e histórico clínico no Kikin pertencem ao **estabelecimento**, que é o
  controlador daquela relação — e continuam intactos. É exatamente o escopo da exclusão
  pedida na área do cliente.
- **Não apaga dados de terceiros.** Conta cujo HMAC não casa com nenhum pedido fica como
  está. Hash "fantasma" não apaga nada.
- **Não faz anonimização reversível nem soft delete.**

## Diagnóstico

**`matched: []` quando você esperava supressões** quase sempre significa segredo
diferente: a rotina só casa HMACs calculados com a **mesma** `KIKIN_CLIENT_PORTAL_SECRET`
do banco de origem. Se o segredo mudou, a supressão precisa ser refeita na origem, com o
segredo correto. É uma falha **visível de propósito** — melhor não apagar nada do que
apagar a conta errada.

**`skipped` preenchido** = banco antigo, sem a tabela `account_deletion_log`. A rotina não
explode; informa o motivo e não apaga nada. Pré-requisito é o banco migrado
(`npm run db:migrate --prefix server`).

## Testes

`server/src/test/suppressionList.test.ts` e os demais em `server/src/test/`
(`lgpd.test.ts`, `lgpdOptinCopy.test.ts`) são **100% mockados, sem banco real**. Um teste
verde aqui não prova comportamento contra Postgres — valide em ambiente real antes de
rodar `apply`.
