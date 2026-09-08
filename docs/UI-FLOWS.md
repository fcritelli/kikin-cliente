# Área do Cliente — Fluxo/Telas do MVP (wireframe textual)

Fluxo do cliente final em `cliente.kikin.com.br`.

## 1. Entrada
- `cliente.kikin.com.br` (ou, futuramente, `saladofernando.cliente.kikin.com.br`).
- CTA: **Entrar** | **Criar conta** | **Agendar como convidado** (link para o booking público).

## 2. Conta (Fase 1)
- **Criar conta**: e-mail, senha (min 8), nome; checkbox de consentimento LGPD.
  → e-mail de verificação → conta ativa.
- **Login**: e-mail + senha. **Esqueci senha**: link de redefinição por e-mail.
- Segurança: rate limit por IP (signup/login/forgot), anti-bot; senha com hash forte;
  sessão com refresh token; logout.

## 3. Primeiro acesso — vínculo
- Tela "Encontre seus agendamentos": opcional informar **telefone** (e futuramente CPF).
- O gateway casa por **hash** com clientes/agendamentos do(s) estabelecimento(s)
  (LGPD: nunca em claro) e pergunta: "Este é você? Confirmar vínculo".
- Resultado: conta vinculada ao(s) estabelecimento(s) → "Meus agendamentos".

## 4. Home (Meus agendamentos)
- Próximos: data/hora, serviço, profissional, estabelecimento, status.
- Ações por item: **Remarcar** (escolhe novo horário disponível) | **Cancelar** (confirmação).
- Card "Agendar novo" → catálogo/horários do estabelecimento (fluxo existente do Kikin,
  pré-preenchido com dados do cliente logado).
- Multi-estabelecimento: seletor de unidade (quando vinculado a mais de um).

## 5. LGPD / Conta
- "Meus dados": e-mail, nome, telefone (máscara), consentimento.
- **Exportar meus dados** (gera pacote) e **Excluir minha conta** (com confirmação por
  e-mail; propaga exclusão quando necessário).

## 6. Notificações (fase posterior)
- Preferências por canal (e-mail/WhatsApp) e confirmação/lembrete dos agendamentos.

## Notas de UX
- Mobile-first (a maioria agenda pelo celular).
- Sem cadastro obrigatório para agendar (convidado continua existindo); a conta é um upgrade.
- Após agendar logado, pergunta "quer ativar lembretes?" para capturar consentimento.
