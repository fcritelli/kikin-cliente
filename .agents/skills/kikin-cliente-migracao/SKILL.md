---
name: kikin-cliente-migracao
description: "Use ao criar, alterar ou revisar migrations SQL do kikin-cliente (server/src/migrations), ou ao mexer no schema do banco do portal (kikin_cliente)."
---

# Migrations do kikin-cliente

## A armadilha que define este projeto

**O runner não guarda checksum.** A tabela `client_schema_migrations` tem só
`(filename, applied_at)`, e o `migrate()` pula todo arquivo cujo **nome** já está lá:

```ts
if (done.has(file)) continue;
```

Consequência direta: **editar uma migration já aplicada não tem efeito nenhum.** O
runner não re-executa e não avisa — ele simplesmente segue. Diferente do kikin-admin,
onde um checksum SHA-256 divergente aborta com erro, aqui a edição falha em silêncio.

Se o schema precisa mudar depois de aplicado, **crie uma migration nova**. Nunca
"conserte" o arquivo antigo, nem em HML.

## Criar uma migration

1. Arquivo em `server/src/migrations/`, nome `<YYYYMMDD><NNNN>_<descricao>.sql`.
   O runner casa com `/^(\d+_.+)\.sql$/` e ordena **lexicograficamente** — daí o
   sequencial com zeros à esquerda (`202609090009_...`).
2. SQL puro. O runner já envolve cada migration em `BEGIN`/`COMMIT`: não abra
   transação própria e **não use `CREATE INDEX CONCURRENTLY`** (inválido em transação).
3. Aplicar:
   ```bash
   npm run db:migrate --prefix server
   ```
4. Conferir o que está pendente — não há script npm para isso, chame o runner direto
   de `server/`:
   ```bash
   npx tsx src/migrations/runner.ts status
   ```

## O que este projeto NÃO tem

Não presuma paridade com o kikin-admin. Aqui:

- **não há papel de runtime separado** — o runner usa o mesmo `pool` de `../db.js`,
  sem `CREATEROLE`, sem `set_config('...runtime_password')`, sem `GRANT` para um papel
  de serviço. `GRANT` explícito aqui não é o padrão.
- **não há checksum** (ver acima).

Se em algum momento um papel de runtime for introduzido, esta skill precisa ser
atualizada — o silêncio da ausência de checksum passa a ser um risco maior.

## Concorrência

O runner serializa com `pg_advisory_lock(202609090001)`. Não remova.

## Depois de mexer no schema

Rode os testes (`npm test --prefix server`), o `typecheck` (`npm run typecheck --prefix
server`) e sincronize o grafo: `graphify update .`
