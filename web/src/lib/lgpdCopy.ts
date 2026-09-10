/**
 * Textos de LGPD da interface do portal do cliente.
 *
 * Ficam aqui (e não soltos em cada tela) porque a informação ao titular precisa ser IGUAL em todos
 * os pontos de coleta — divergir entre telas é o jeito mais fácil de virar inconsistência em
 * auditoria. Ajuste o texto aqui e todas as telas acompanham.
 */

/**
 * LGPD Art. 18, VIII — o titular precisa saber que pode NÃO consentir e o que acontece se não
 * consentir. Vale para o opt-in de WhatsApp (lembretes) e para as notificações push: são
 * consentimentos separados do contrato, então a recusa não pode custar o serviço.
 */
export const WHATSAPP_OPTIN_OPTIONAL_NOTE =
  "Opcional: se você não marcar, continua agendando, remarcando e cancelando normalmente — " +
  "você apenas não recebe confirmações e lembretes por WhatsApp. Pode marcar ou desmarcar " +
  "depois, por estabelecimento, em Perfil → Meus dados.";

/** Mesmo princípio para as notificações no navegador. */
export const PUSH_OPTIN_OPTIONAL_NOTE =
  "Opcional: as notificações no navegador podem ser desligadas a qualquer momento, a seu critério, " +
  "sem qualquer prejuízo ao uso do portal.";
