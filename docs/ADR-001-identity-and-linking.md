# ADR-001 — Identidade e vínculo do cliente final

Status: **ACEITO** (produto: Opção A)
Data: decisão do produto — banco próprio do portal.

## Decisão
A conta do cliente final vive em **banco próprio do portal** (`client_accounts`, sessões,
vínculos `account_establishments`). O vínculo com os registros `clients`/agendamentos do Kikin
é feito por **identificador derivado — hash HMAC do telefone (e, futuramente, CPF) normalizado**,
no padrão LGPD do Kikin (nunca número em claro; apenas máscara + hash).

## Fluxo de vínculo (“claim”)
1. Cliente cria/login na conta (e-mail+senha).
2. Primeiro acesso: tela “Encontre seus agendamentos” — informa **telefone** (fase futura: CPF).
3. O portal calcula o hash e pede ao Kikin (endpoint interno) agendamentos/clients que casam
   por esse hash no(s) estabelecimento(s) autorizados.
4. O portal mostra candidatos mascarados e o cliente **confirma** (“sou eu”) → cria vínculo
   entre conta e o(s) client_id(s) do Kikin (guardamos o client_id externo + hash, sem dado cru).
5. A partir daí, “meus agendamentos” consultam pelo client_id vinculado.

## Deduplicação (estratégia)
- **Normalização antes do hash**: telefone → apenas dígitos, com DDI BR (55) quando 10/11
  dígitos; CPF → dígitos (e validação DV); tudo minúsculo/trim. Só o hash é armazenado/indexado.
- **Chave primária de busca**: hash(telefone); **secundária**: hash(CPF) (fase futura).
- **Mesma pessoa em vários salões**: o mesmo hash casa com `clients` de vários estabelecimentos
  → vínculos múltiplos para a MESMA conta (visão unificada no portal). Se o mesmo hash já estiver
  vinculado a OUTRA conta, não duplicamos: na confirmação, informamos “este telefone já está
  vinculado a outra conta” e oferecemos login na conta existente (evita contas duplicadas).
- **Erros de digitação/duplicados no Kikin** (ex.: cliente criado duas vezes com telefones
  parecidos): o portal mostra os candidatos mascarados e pede confirmação explícita; a fusão de
  registros duplicados fica para o salão (kikin-admin), não automática no portal.
- **Sem tele/CPF em claro em logs ou respostas** — sempre mascarar (ex.: `(11) ****-0000`).

## Consequências
- Novo serviço (gateway) com banco próprio e migrações próprias.
- Kikin expõe endpoints internos restritos que recebem **hash** (nunca o número cru).
- LGPD: consentimento no cadastro; export/exclusão do portal (e propagação ao Kikin quando
  aplicável).
