# kikin-cliente — Estrutura do repositório

Padrão da família Kikin: raiz com `web/` (frontend) + `server/` (backend/gateway).
(Motivo: consistência com kikin/kikin-admin para Dockerfiles, Traefik, deploy e convenções.)

## Árvore

```
kikin-cliente/
├─ docs/                         # ADRs + design (fonte única aqui)
│  ├─ README.md  ARCHITECTURE.md  ADR-001…  ADR-002…  UI-FLOWS.md  ROADMAP.md
├─ web/                          # Frontend do cliente final (React/Vite)
│  ├─ src/
│  │  ├─ pages/                  # login, cadastro, meus-agendamentos, agendar, lgpd
│  │  ├─ components/             # UI reutilizável
│  │  ├─ lib/                    # api client (fetch p/ /api), helpers
│  │  └─ contexts/               # sessão do cliente
│  ├─ public/
│  ├─ nginx.conf                 # SPA + security headers (molde kikin)
│  └─ Dockerfile
├─ server/                       # GATEWAY (Node/Express TS)
│  ├─ src/
│  │  ├─ config.ts               # zod: ADMIN-style envs (banco, segredos, KIKIN_API_URL,
│  │  │                         #       KIKIN_SERVICE_TOKEN, smtp, rate limits)
│  │  ├─ db.ts                   # pool Postgres do portal (db kikin_cliente)
│  │  ├─ index.ts                # bootstrap/rotas (health, /api/v1/...)
│  │  ├─ middleware/             # auth, rate limit (IP + usuário), anti-bot
│  │  ├─ modules/
│  │  │  ├─ accounts/            # e-mail+senha: cadastro, verificação, login, reset, sessão
│  │  │  ├─ links/               # vínculo conta↔estabelecimento (hash LGPD) + claim
│  │  │  ├─ appointments/        # "meus agendamentos"; cancelar/remarcar
│  │  │  ├─ booking/             # agendar novo via slug do Kikin (booking público)
│  │  │  ├─ lgpd/                # consentimento, export e exclusão
│  │  │  └─ kikin/               # cliente HTTP p/ endpoints internos do Kikin (ADR-002)
│  │  └─ migrations/             # SQL do portal + runner (migra no boot)
│  ├─ test/                      # vitest (unit + integração)
│  └─ Dockerfile
├─ docker-compose.hml.yml        # hml: cliente.kikin.com.br (Postgres+web+server; Traefik)
├─ deploy-hml.sh                 # deploy no servidor (molde /kikin)
├─ env.hml.example
└─ README.md
```

## Convenções
- **Nomes de módulo em inglês** (accounts, links, appointments…), mensagens/UI em PT-BR.
- Documentos em `docs/`; cada decisão vira ADR (append-only).
- Banco próprio do portal: `kikin_cliente` (Postgres) com migrações versionadas (runner no boot).
- O gateway **nunca** guarda telefone/CPF do cliente em claro: colunas `*_hash`/`*_masked` (LGPD).
- Segurança de rede copiada dos projetos anteriores: rate limit por IP + por usuário,
  verificação de e-mail, reset de senha, anti-bot no signup.

## Infra (quando formos ao ar)
- Domínio: `cliente.kikin.com.br` (hml) — mesmo molde do kikin-admin (rede `kikin`, Traefik,
  certresolver `mytlschallenge`).
- Rotas Traefik: frontend (`/`) e API (`/api`) → containers `web` e `server`.
- White-label por estabelecimento (`saladofernando.cliente.kikin.com.br`) fica para a Fase 2/3.

## Fase atual
Fase 0 (design). Próximo: contrato dos endpoints internos do Kikin (ADR-002) e scaffold das
apps (accounts/links no `server`, páginas de login/cadastro no `web`).
