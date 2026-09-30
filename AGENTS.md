# Project Instructions for kikin-cliente

## Grafo antes do código

**Toda pergunta sobre este código começa pelo grafo** — ele diz *onde* olhar; o arquivo vem depois,
para confirmar. `mcp__graphify__*` com `project_path` = a raiz absoluta deste repositório e um
`token_budget` explícito, ou `graphify query "<assunto>" --budget 1500`. Nunca leia
`graphify-out/graph.json` nem `graph.html`.

**Quem sincroniza é o controlador, no fim da tarefa** (`graphify update .`) — subagente reporta o que mudou e não roda o
update; o portão `controllerWriteGate` nega a escrita dele. **A tarefa não está concluída antes disso**,
e o controlador confere pelo marcador do report (`Built from commit`) contra o `git rev-parse HEAD`:
grafo atrás do código responde pelo estado anterior.

Passos, limites medidos, verificação e exceções: skill **`graph-before-code`**.

## Antes de propor: o que já foi decidido

O grafo responde **onde está** no código; a memória curada responde **o que já foi decidido e o que já
caiu** — e isso não existe em nenhum outro lugar. Antes de propor mudança, leia:

- `~/Documents/cerebro/Avaliações.md` — o que foi avaliado e **não** adotado, e o que sobreviveu.
- `~/Documents/cerebro/10-projetos/kikin.md` — o estado e as decisões duráveis do produto kikin.

É leitura por `read`/`grep`: não depende do app do Obsidian estar aberto.

## Constituição

`docs/CONSTITUICAO.md` traz os princípios invioláveis deste repositório, e um plano que os contrarie
está errado antes de ser executado. A arquitetura e as decisões tomadas estão em `docs/ARCHITECTURE.md`
e em `docs/ADR-*.md` — leia o ADR antes de propor mudar o que ele decidiu.

## Skills do projeto

Procedimentos recorrentes ficam em `.agents/skills/`, carregadas sob demanda:

- `kikin-cliente-gateway` — chamadas do portal para a API do Kikin: assinatura HMAC do gateway,
  headers `X-Service-*`, escopo por salão, idempotência, endpoints `/internal/client-portal`.
- `kikin-cliente-lgpd` — exclusão de conta, lista de supressão, opt-in de WhatsApp e restauração de
  backup: aqui se trata dado do cliente final, sob a LGPD.
- `kikin-cliente-migracao` — migrations SQL (`server/src/migrations`) e schema do banco do portal
  (`kikin_cliente`).

Prefira criar uma skill a acrescentar regra aqui: **este arquivo é lido em toda requisição**, enquanto
uma skill só custa contexto quando é de fato usada.

Instruções válidas apenas na sua máquina vão em `AGENTS.local.md` (não versionado), lido **depois**
deste arquivo. Não edite este arquivo para preferência pessoal.
