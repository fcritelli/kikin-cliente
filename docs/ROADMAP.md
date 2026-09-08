# Área do Cliente Kikin — Roadmap (proposta)

## Fase 0 — Design (agora)
- [x] Decisões: e-mail+senha; portal próprio (`cliente.kikin.com.br`); backend gateway; white-label futura.
- [ ] ADR-001 (modelo de conta/vínculo) — pendente escolha do produto (recomendação: banco próprio + hash LGPD).
- [ ] ADR-002 (como o gateway autentica na API do Kikin).
- [ ] Esboço das telas (fluxo) do MVP.
- [ ] Definir repo novo do portal (sugestão: novo monorepo `kikin-client-portal`) + DNS em hml.

## Fase 1 — MVP
**Conta**
- [x] Signup/login com e-mail+senha; verificação de e-mail; reset de senha; logout.
- [x] Login/cadastro social Google e Microsoft (code flow, mesmo padrão do Kikin: gateway troca o
  código server-side). Conta nova passa por mini passo pós-OAuth (nome + termos LGPD); e-mail já
  existente é vinculado ao provedor e entra direto.
- [ ] Registrar OAuth apps do portal (`GOOGLE_CLIENT_ID`/`MICROSOFT_CLIENT_ID`) com redirect
  autorizado = `CLIENT_APP_URL + '/auth'` (dev `http://localhost:5174/auth`; hml `https://cliente.kikin.com.br/auth`).
- [x] Rate limit (signup/login/forgot), proteção anti-bot.
**Vínculo**
- [x] Endpoints internos no Kikin (`/internal/client-portal`) com HMAC X-Service-* (ADR-002):
  `GET /salons` (metadados), `GET /clients/search` (busca GLOBAL por hash do telefone,
  candidatos mascarados com nome do salão) e `GET /appointments` (próximos agendamentos do
  client vinculado). Decisão de produto: todos os salões têm área do cliente (sem allowlist por
  env); o controle "salão tem/não tem" virá no painel kikin-admin (futuro).
- [x] Primeiro acesso: tela "Encontre seus agendamentos" — informa o telefone (sem escolher salão)
  → candidatos mascarados de todos os salões → confirmar ("sou eu") — cria vínculo
  `account_establishment_links` (LGPD: só hash + máscara; dedupe: mesmo telefone não vincula a
  duas contas).
- [x] "Meus próximos horários" listando agendamentos futuros do(s) vínculo(s).
- [x] **Área logada com navegação lateral**: Dashboard (visão geral + agendar + próximos) ·
  Consultas (próximas e histórico com status) · Estabelecimentos (vínculos: cadastro mascarado,
  opt-in de WhatsApp, agendar neste, recuperar por WhatsApp) · Perfil (nome editável, e-mail,
  WhatsApp único editável — guardado só hash+máscara em client_accounts).
- [x] **Portal = único método de agendamento**: sem página pública por slug e sem lista global.
  O cliente agenda dentro do `/conta` (no estabelecimento vinculado; na 1ª vez escolhe o
  estabelecimento, que vira o vínculo). Convidado sem conta não agenda.
- [x] **Telefone = WhatsApp**: opt-in de consentimento no vínculo (`whatsapp_optin_at`) capturado
  no booking/claim; "falar com o salão" via wa.me já ativo; envio/OTP plugável (ver docs/WHATSAPP.md).
- [ ] Fase futura: telefone também por CPF; vínculo multi-estabelecimento já suportado pelo schema.
**Agendamentos**
- [x] Meus agendamentos futuros (do(s) estabelecimento(s) vinculados).
- [x] Agendar dentro do /conta (modal): serviços → profissional → data/horário reais → confirmar.
  Vinculado → agenda direto no cadastro do client (sem redigitar telefone; POST interno /book).
  1ª vez (sem vínculo) → escolhe o estabelecimento e agenda como novo client (telefone = WhatsApp
  + opt-in), e o vínculo é criado automaticamente. Dados do agendamento via proxy público do Kikin.
- [x] Auto-vínculo pós-booking: conta logada agenda e o client daquele salão é vinculado sozinho
  (`/links/auto`); convidado que cria a conta com o mesmo telefone entra com o salão já vinculado.
- [x] Cancelar e remarcar pela área do cliente com regra justa (no Kikin, fonte da verdade):
  janela de 6h antes do início (por salão em `settings.clientPortal.cancelWindowHours`); remarcar é
  troca atômica (novo horário reservado → antigo só então cancelado), com passo explícito de
  intenção antes de escolher o novo horário; limite suave móvel (3 cancelamentos-no-shows em 30
  dias) bloqueia agendar/cancelar online com aviso claro, sem multas.
**LGPD/UX**
- Consentimento no cadastro; "Meus dados" (exportar/excluir conta).
- Mensagens de confirmação por e-mail (e WhatsApp em fase posterior).

## Fase 2
- Histórico de atendimentos e "repetir agendamento".
- Preferências (profissional/serviços favoritos, aniversário).
- Fila de espera / aviso de vaga.
- Notificações via WhatsApp.
- White-label leve por estabelecimento (cor/logo via configuração simples).

## Fase 3
- Templates/design por logo (`saladofernando.cliente.kikin.com.br` com identidade própria).
- Fidelidade (pontos/selos), pacotes, vale-presente.
- Convênios (clínica): guias/consultas do paciente.
- Métricas do portal por estabelecimento (ativação, no-show, recorrência).

## Critérios de saída do MVP
- Login completo (signup, verificação, reset) com testes.
- Cliente vê agenda futura e consegue cancelar/remarcar/agendar no próprio salão.
- Export e exclusão de conta funcionando (LGPD).
- Rodando em homologação `cliente.kikin.com.br` (hml) com domínio próprio e HTTPS.
