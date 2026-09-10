# Lista de supressão do portal (LGPD Art. 18 + restauração de backup)

Status: **implementado** — rotina `server/src/scripts/apply-suppression-list.ts` (lacuna G-12 do
plano LGPD).

## O que é

A exclusão de conta no portal é um `DELETE` real: as linhas da conta saem das 7 tabelas do portal
(`PORTAL_ACCOUNT_TABLES`) na ordem FK-segura de `DELETION_ORDER` e fica só o registro de
auditoria (Art. 37) em `account_deletion_log`. Esse registro **não tem FK** justamente para
sobreviver à exclusão — e guarda apenas pseudônimos, nunca PII em claro:

| Coluna | Conteúdo | Observação |
| --- | --- | --- |
| `account_ref_hash` | `HMAC-SHA256(KIKIN_CLIENT_PORTAL_SECRET, id da conta)` | `accountRefHash()` — é a CHAVE da supressão |
| `email_hash` | HMAC do e-mail normalizado | correlação de pedidos, sem revelar o e-mail |
| `proof_method` | `password` \| `whatsapp_otp` | qual prova de identidade foi exigida |
| `removed_counts` | contagens por tabela | prova do que foi apagado |
| `ip_hash` | HMAC do IP (quando houve) | nunca o IP cru |

**A lista de supressão** é a reaplicação dessa exclusão: o script recalcula o `account_ref_hash`
de cada conta que existe hoje em `client_accounts`, compara com os hashes registrados e, para cada
conta que casa, remove as mesmas linhas — pela **mesma função** `purgePortalAccountRows()` usada
pela exclusão original.

## Por que existe

1. **Restauração de backup (o problema real).** Um dump do banco do portal anterior a um pedido de
   exclusão, se restaurado, **ressuscita** as contas que o titular mandou apagar. Sem esta rotina,
   a exclusão deixa de ser definitiva e o portal volta a tratar dados de quem pediu para sair.
2. **LGPD Art. 18, VI.** O titular tem direito à eliminação dos dados; o exercício desse direito não
   pode ser desfeito por um procedimento operacional (restore). Se o restore trouxer a conta de
   volta, é preciso apagá-la de novo — imediatamente e de forma verificável.
3. **Art. 37 (auditoria) é preservado.** A rotina NÃO apaga nem reescreve `account_deletion_log`:
   o registro do pedido original continua lá, com as contagens originais, e continua sendo o que
   permite provar que a exclusão foi cumprida.

## Como rodar

Depois de restaurar um backup do banco do **portal** (kikin_cliente), a partir de `server/`:

```bash
# 1) DRY-RUN — só relata o que seria feito. NÃO apaga nada. (padrão; é o mais seguro)
npm run suppression:report --prefix server

# 2) Saída estruturada (um objeto JSON no stdout), para automatizar/registrar a evidência
npm run suppression:report --prefix server -- --json

# 3) APPLY — executa a supressão de verdade
npm run suppression:apply --prefix server
npm run suppression:apply --prefix server -- --json
```

Equivalentes por variável de ambiente / argumento (o script é o mesmo):

```bash
SUPPRESSION_APPLY=true npx tsx server/src/scripts/apply-suppression-list.ts
npx tsx server/src/scripts/apply-suppression-list.ts --apply --json
npx tsx server/src/scripts/apply-suppression-list.ts --dry-run   # --dry-run vence --apply
```

**O modo ativo é sempre dito na primeira linha do log** — `MODO: DRY-RUN — NADA será apagado` ou
`MODO: APPLY — as contas suprimidas serão APAGADAS agora` — para nunca haver dúvida sobre o que
acabou de acontecer.

### O que a saída mostra

```json
{
  "mode": "apply",
  "suppressions": 2,          // pedidos de exclusão registrados (linhas distintas do log)
  "accountsScanned": 2,       // contas existentes varridas em client_accounts
  "matched": ["65c1eda6f833"],// hash CURTO (12 chars) das contas que casaram
  "purged": [{ "ref": "65c1eda6f833", "removed": { "push_subscriptions": 1, "...": 0 }, "total": 10 }],
  "failures": [],             // contas que NÃO puderam ser suprimidas (hash curto + motivo)
  "skipped": null             // motivo quando nada pôde ser reaplicado (banco antigo)
}
```

- **Nunca** sai e-mail, nome, telefone, uuid ou hash completo — só hash curto + contagens. Se uma
  consulta falhar, o motivo é sanitizado (o id vira `[id]`) antes de ir para o log.
- **Idempotente:** aplicada a supressão, a conta não existe mais em `client_accounts`, então uma
  segunda execução encontra `matched: []` e não apaga nada. Pode rodar quantas vezes quiser.
- **Uma transação por conta:** as 7 tabelas saem juntas ou nenhuma sai (rollback). Supressão pela
  metade — conta de volta com dados órfãos — não é aceita.
- **Exit code:** `0` quando não havia nada a fazer; `1` se alguma conta deveria ser suprimida e
  não foi (nesse caso, trate a falha e rode de novo).

## O que a rotina NÃO faz

- **Não toca no Kikin.** Nenhuma leitura, nenhuma escrita, nenhuma chamada de rede. O cadastro do
  cliente, os agendamentos e o histórico clínico no Kikin pertencem ao **ESTABELECIMENTO** (que é
  o controlador daquela relação) e continuam intactos — exatamente o mesmo escopo da exclusão
  pedida pelo titular na área do cliente.
- **Não reescreve a auditoria.** Não insere nem apaga linhas em `account_deletion_log` (nada de
  registros duplicados a cada execução).
- **Não apaga dados de terceiros.** Contas cujo HMAC não casa com nenhum pedido de exclusão ficam
  exatamente como estão. Um hash "fantasma" (de conta que já não existe) não apaga nada.
- **Não faz "anonimização" reversível nem soft delete.** É remoção de linha, igual à exclusão
  original.
- **Não cria lista nova de tabelas.** Reaproveita `purgePortalAccountRows()` — a fonte única é
  `PORTAL_ACCOUNT_TABLES` + `DELETION_ORDER` em `server/src/modules/lgpd/lgpd.service.ts`.

## Quando rodar

- **Sempre depois de restaurar um backup/dump do banco do portal** (drill de restore, recuperação
  de incidente, clonagem de ambiente a partir de produção, importação de dados) — primeiro o
  `suppression:report`, confira a contagem de `matched`, depois `suppression:apply`.
- **Depois de aplicar, verifique:** `matched` do report tem que ser igual ao número de contas
  suprimidas; um `apply` seguinte deve trazer `matched: []`. Guarde o JSON como evidência do
  procedimento (Art. 37).
- **Em qualquer ambiente** que use a mesma `KIKIN_CLIENT_PORTAL_SECRET` do banco de origem. Se o
  segredo mudou (ou é outro), os HMACs não casam: o report sai com `matched: []` — nesse caso a
  supressão precisa ser refeita pela origem, com o segredo correto. É uma falha **visível** de
  propósito: melhor não apagar nada do que apagar a conta errada.
- Pré-requisito: banco já migrado (`npm run db:migrate --prefix server`). Em banco antigo, sem a
  tabela `account_deletion_log`, a rotina não explode: informa o motivo em `skipped` e não apaga
  nada.

## Onde está no código

| Arquivo | Papel |
| --- | --- |
| `server/src/modules/lgpd/lgpd.service.ts` | `PORTAL_ACCOUNT_TABLES`, `DELETION_ORDER`, `hmac()`, `accountRefHash()`, `purgePortalAccountRows(tx, accountId)`, `deleteAccount()` (auditoria) |
| `server/src/scripts/apply-suppression-list.ts` | rotina da lista de supressão (dry-run/apply/json) |
| `server/src/migrations/202609090009_account_deletion_log.sql` | tabela de auditoria que serve de lista de supressão |
| `server/src/test/suppressionList.test.ts` | testes (100% mockados, sem banco real) |

Referência do outro repositório: `kikin/server/src/scripts/apply-suppression-list.ts` (mesma ideia
para a supressão do Kikin — lá a ação é anonimizar; aqui, apagar as linhas do portal).
