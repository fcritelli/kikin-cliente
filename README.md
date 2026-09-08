# kikin-cliente

Portal do **cliente final** da plataforma Kikin — quem agenda no salão/barbeiro/clínica
(corte, barba, consulta, terapia…).

- Frontend próprio em `cliente.kikin.com.br` (white-label por estabelecimento no futuro:
  `saladofernando.cliente.kikin.com.br`).
- Backend próprio (gateway) que conversa com a API do Kikin.
- Login do cliente final: **e-mail + senha**.

Documentos de decisão/arquitetura em [`docs/`](docs/README.md); estrutura em [`docs/STRUCTURE.md`](docs/STRUCTURE.md).

Status: fase de design (Fase 0). Decisões aceitas: ADR-001 (conta em banco próprio do portal,
vínculo por hash LGPD) e ADR-002 (gateway age em nome do salão via token de serviço no MVP;
chave por estabelecimento na Fase 2).
