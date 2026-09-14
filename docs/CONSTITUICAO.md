# Constituição — kikin-cliente

**Versão:** 1.0.0 | **Extraída do repositório em:** 2026-09-14 | **Última emenda:** —

## Como usar

Leia antes de planejar. Todo plano traz uma seção **Conformidade** citando cada princípio
aplicável e como aquele plano o respeita. Conflito entre plano e constituição se resolve
**contra o plano** — ou esta constituição é emendada, com justificativa registrada aqui.

## I. Exclusão de conta é `DELETE`, não soft delete

**Regra:** O pedido de eliminação do titular apaga as linhas das 7 tabelas do portal, na
ordem FK-segura de `DELETION_ORDER`, dentro de **uma transação por conta** — tudo ou nada.
Não existe anonimização reversível nem marcação de inativo. A fonte única é
`purgePortalAccountRows()` em `server/src/modules/lgpd/lgpd.service.ts`.

**Verificação:** `server/src/test/lgpd.test.ts`; ausência de lista paralela de tabelas no
código.

**Detalhe:** skill `kikin-cliente-lgpd`.

## II. Backup restaurado exige reaplicar a supressão

**Regra:** Um dump anterior a um pedido de exclusão **ressuscita** contas que o titular
mandou apagar. Depois de qualquer restore do banco do portal, rode a lista de supressão —
primeiro `suppression:report` (dry-run), confira `matched`, depois `suppression:apply`.

**Verificação:** `npm run suppression:report --prefix server`; `matched` do report igual ao
número de contas suprimidas; um `apply` seguinte traz `matched: []`.

**Detalhe:** skill `kikin-cliente-lgpd` e `docs/SUPPRESSION-LIST.md`.

## III. A auditoria guarda pseudônimo, nunca PII

**Regra:** `account_deletion_log` não tem FK — de propósito, para sobreviver à exclusão — e
guarda apenas `account_ref_hash`, `email_hash`, `proof_method`, `removed_counts` e
`ip_hash`. Nunca e-mail, nome, telefone, IP cru ou UUID. A rotina de supressão **não**
reescreve essa tabela.

**Verificação:** inspeção das colunas gravadas; saída da rotina traz só hash curto (12
caracteres) e contagens.

**Detalhe:** skill `kikin-cliente-lgpd`.

## IV. O segredo do gateway é dedicado ao portal

**Regra:** O portal age em nome do salão com HMAC-SHA256 sobre a string canônica
`METHOD:PATH:CANONICAL_QUERY:BODY_HASH:SERVICE_ID:TIMESTAMP:NONCE:SCOPE_HEADER`, com
nonce anti-replay e escopo assinado. O segredo é **distinto do admin** — o gateway não
herda poderes do `requireInternalAdmin`. Mutações levam `X-Idempotency-Key`.

**Verificação:** assinatura confere; requisição com scope adulterado é rejeitada; replay
fora da janela devolve 401.

**Detalhe:** skill `kikin-cliente-gateway` e `docs/ADR-002-gateway-auth.md`.

## V. Migração aplicada não se edita — e a falha é silenciosa

**Regra:** O runner deste projeto **não guarda checksum**: `client_schema_migrations` tem
só `(filename, applied_at)` e o `migrate()` pula todo arquivo cujo **nome** já está lá.
Editar uma migration aplicada não tem efeito nenhum e não emite aviso. Schema mudou depois
de aplicado? Crie uma migration nova.

**Verificação:** leitura de `server/src/migrations/runner.ts`; `npx tsx
src/migrations/runner.ts status`.

**Detalhe:** skill `kikin-cliente-migracao`.

## VI. O portal não toca no Kikin

**Regra:** Cadastro, agendamentos e histórico clínico no Kikin pertencem ao
**estabelecimento**, que é o controlador daquela relação. A exclusão no portal tem escopo
próprio e não alcança o Kikin. Nenhuma rotina de conformidade do portal chama a API do
Kikin.

**Verificação:** ausência de chamada de rede nas rotinas de exclusão e supressão.

**Detalhe:** `docs/SUPPRESSION-LIST.md`.

## VII. O grafo se consulta com orçamento e se atualiza sempre

**Regra:** Antes de planejar, consulte o grafo pela via mais barata — MCP `query_graph` com
`token_budget` explícito, ou `get_node`/`get_neighbors` para um símbolo específico. **Nunca
leia `graphify-out/graph.json` nem `graph.html`**: são ~194k e ~166k tokens neste projeto.
`GRAPH_REPORT.md` (~4k tokens) só para revisão ampla de arquitetura. Para navegação por
área, `graphify-out/wiki/index.md` (~1,5k tokens, 72 artigos).

Depois de alterar código, rode `graphify update .`.

**Verificação:** a consulta declarou `token_budget`; `graph.json` com data posterior à mudança.

**Detalhe:** skill `graphify`.
