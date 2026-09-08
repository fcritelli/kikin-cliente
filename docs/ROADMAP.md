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
  `GET /salons`, `GET /clients` (busca por hash do telefone, candidatos mascarados) e
  `GET /appointments` (próximos agendamentos do client vinculado). Salões autorizados via
  `CLIENT_PORTAL_ALLOWED_SALON_IDS` no Kikin.
- [x] Primeiro acesso: tela "Encontre seus agendamentos" — escolher estabelecimento + telefone →
  candidatos mascarados → confirmar ("sou eu") — cria vínculo `account_establishment_links`
  (LGPD: só hash + máscara; dedupe: mesmo telefone não vincula a duas contas).
- [x] "Meus próximos horários" listando agendamentos futuros do(s) vínculo(s).
- [ ] Fase futura: telefone também por CPF; vínculo multi-estabelecimento já suportado pelo schema.
**Agendamentos**
- Meus agendamentos futuros (do(s) estabelecimento(s) vinculados).
- Cancelar (com confirmação) e remarcar (regra de janela simples).
- Agendar novo: fluxo reusando agenda/catálogo do Kikin com dados do cliente logado.
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
