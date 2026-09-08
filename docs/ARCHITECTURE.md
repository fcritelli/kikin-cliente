# kikin-cliente — Arquitetura (v1)

## Visão

```
┌────────────────────── cliente.kikin.com.br ──────────────────────┐
│  Frontend Cliente (React, white-label por estabelecimento)        │
│    https://cliente.kikin.com.br                                   │
│    https://saladofernando.cliente.kikin.com.br  (fase futura)     │
│                  │                                                │
│  Gateway API Cliente (backend próprio — novo serviço)            │
│   • Contas do cliente final (e-mail+senha) e sessões [DB própria] │
│   • Vínculo cliente ↔ estabelecimento (hash LGPD)                 │
│   • Orquestração com a API do Kikin (agenda, catálogo, booking)   │
│   • Consentimento/LGPD (export/exclusão)                          │
│                  │                                                │
│        HTTP — age em nome do salão (ADR-002)                      │
│                  ▼                                                │
│  Kikin API (ex.: hml.kikin.com.br/api)                            │
│   clientes, agendamentos, serviços, profissionais, booking/slug   │
└───────────────────────────────────────────────────────────────────┘
```

## Princípios
- **Não misturar** com o app de gestão do salão nem com o kikin-admin.
- O Kikin continua dono da verdade de agenda/catálogo; o portal é a camada do cliente.
- **LGPD first**: telefone/CPF do cliente nunca em claro no portal (máscara + hash); consentimento;
  exportar/excluir.
- Segurança de rede (lições anteriores): rate limit por IP e por usuário, verificação de
  e-mail, reset de senha, anti-bot no signup.

## Decisões aceitas
- ADR-001: conta do cliente em **banco próprio do portal**; vínculo com `clients` do Kikin por
  **hash** (LGPD); “claim” no primeiro acesso.
- ADR-002: gateway **age em nome do salão** — MVP com assinatura HMAC (padrão kikin-admin) + endpoints
  internos restritos; Fase 2 com chave de API por estabelecimento.

## Agendar novo
Reusa a **mesma lógica do booking público do Kikin (via slug do estabelecimento)**, com dados
do cliente logado pré-preenchidos. Cancelar/remarcar usam endpoints de sessão (autenticados).

## Fases
Ver `ROADMAP.md`.
