/**
 * Operadores/subprocessadores que tratam dados pessoais do PORTAL DO CLIENTE.
 *
 * LISTA ÚNICA (fonte da verdade): usada pela exportação LGPD Art. 18, VII (informação sobre
 * compartilhamento) e, futuramente, pela Política de Privacidade do site — nenhuma das duas
 * mantém cópia própria, para não divergirem.
 *
 * DECISÕES DE PRODUTO (obrigatórias):
 *  - Todo item diz NOME, FINALIDADE e PAÍS (onde o tratamento ocorre) e, além disso,
 *    `baseLegal` e `transferenciaInternacional` — este último é o que o Art. 33 exige
 *    deixar claro: quem está nos EUA recebe transferência internacional de dados.
 *  - Transferência internacional NÃO é um fim em si: ela acontece para executar o serviço
 *    pedido pelo titular (Art. 7º, V) e, quando o canal depende de opt-in nosso (lembretes
 *    de WhatsApp, notificações push), com o consentimento do titular (Art. 7º, I).
 *  - O portal não vende, não aluga e não cede dados pessoais para publicidade: a lista
 *    abaixo é EXATAMENTE o conjunto de terceiros que operam o serviço.
 *
 * HONESTIDADE SOBRE O CONTEÚDO: os itens 7 e 8 dependem da configuração do ambiente
 * (SMTP) e do navegador do titular, então o país não é fixo — por isso
 * `transferenciaInternacional: "conforme_provedor"` em vez de um "sim"/"nao" inventado.
 */

/** Base legal do compartilhamento/transferência (Art. 7º da LGPD). */
export type LegalBasis =
  | "execucao_do_servico"
  | "consentimento"
  | "execucao_do_servico_e_consentimento";

/**
 * "sim" e "nao" são afirmações verificadas; "conforme_provedor" é usado quando a
 * localização do tratamento depende do ambiente/navegador e não pode ser afirmada.
 */
export type InternationalTransfer = "sim" | "nao" | "conforme_provedor";

export interface OperatorInfo {
  /** Nome comercial/jurídico do operador (com o produto entre parênteses quando ajuda). */
  nome: string;
  /** Para que o portal usa este operador — em linguagem do titular. */
  finalidade: string;
  /** Onde o tratamento acontece ("conforme provedor"/"conforme navegador" quando variável). */
  pais: string;
  baseLegal: LegalBasis;
  transferenciaInternacional: InternationalTransfer;
}

/** Lista única de operadores. A ORDEM é a exibida na política e no arquivo de exportação. */
export const OPERATORS: readonly OperatorInfo[] = [
  {
    nome: "Meta Platforms (WhatsApp Business Cloud API)",
    finalidade: "envio de confirmações e lembretes",
    pais: "EUA",
    baseLegal: "execucao_do_servico_e_consentimento",
    transferenciaInternacional: "sim",
  },
  {
    nome: "Functional Software, Inc. (Sentry)",
    finalidade: "monitoramento de erros",
    pais: "EUA",
    baseLegal: "execucao_do_servico",
    transferenciaInternacional: "sim",
  },
  {
    nome: "Google LLC",
    finalidade: "login OAuth e Web Push (Chrome/FCM)",
    pais: "EUA",
    baseLegal: "execucao_do_servico_e_consentimento",
    transferenciaInternacional: "sim",
  },
  {
    nome: "Microsoft Corporation",
    finalidade: "login OAuth (Entra)",
    pais: "EUA",
    baseLegal: "execucao_do_servico",
    transferenciaInternacional: "sim",
  },
  {
    nome: "Asaas Gestão de Pagamentos Ltda",
    finalidade: "cobrança, assinatura e NFS-e",
    pais: "Brasil",
    baseLegal: "execucao_do_servico",
    transferenciaInternacional: "nao",
  },
  {
    nome: "Cloudflare, Inc.",
    finalidade: "DNS, proxy e proteção de borda",
    pais: "EUA",
    baseLegal: "execucao_do_servico",
    transferenciaInternacional: "sim",
  },
  {
    nome: "Provedor de e-mail (SMTP configurado no ambiente)",
    finalidade: "envio de verificação de e-mail e redefinição de senha",
    pais: "conforme provedor",
    baseLegal: "execucao_do_servico",
    transferenciaInternacional: "conforme_provedor",
  },
  {
    nome: "Provedor de Web Push do navegador (Google/Mozilla/Apple)",
    finalidade: "entrega de notificações",
    pais: "conforme navegador",
    baseLegal: "consentimento",
    transferenciaInternacional: "conforme_provedor",
  },
];

/**
 * Nota do compartilhamento (Art. 18, VII + Art. 33): acompanha a lista no arquivo de
 * exportação e deve ser reaproveitada pela Política de Privacidade.
 */
export const OPERATORS_NOTE =
  "Compartilhamos seus dados com os operadores/subprocessadores listados acima somente para " +
  "operar o portal, cada um com a finalidade indicada. Os itens marcados com " +
  'transferenciaInternacional: "sim" tratam dados nos EUA e, portanto, configuram TRANSFERÊNCIA ' +
  "INTERNACIONAL de dados pessoais (LGPD Art. 33) — ela ocorre para executar o serviço que você " +
  "pediu (Art. 7º, V) e, quando o canal depende de opt-in (lembretes de WhatsApp e notificações " +
  'push), com o seu consentimento (Art. 7º, I). Os itens marcados com "conforme_provedor" ' +
  "dependem da configuração do ambiente (SMTP) ou do seu navegador e podem também envolver " +
  "transferência internacional. O portal NÃO vende, não aluga e não cede seus dados para " +
  "publicidade.";

/** Frase acrescentada ao `aviso` do arquivo: diz que o export lista os operadores. */
export const AVISO_OPERADORES =
  "Este arquivo também lista, na seção COMPARTILHAMENTO, todos os operadores/subprocessadores " +
  "com quem o portal compartilha dados pessoais (LGPD Art. 18, VII), com finalidade, país e " +
  "indicação de transferência internacional.";

/** Cópia rasa e segura da lista (o export nunca entrega a referência do módulo). */
export function exportOperators(): OperatorInfo[] {
  return OPERATORS.map((o) => ({ ...o }));
}
