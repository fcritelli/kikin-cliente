import { Link } from "react-router-dom";

interface LegalPageProps {
  doc: "termos" | "privacidade";
}

/**
 * Operadores/subprocessadores reais do portal (nome, finalidade, dados, país e link).
 * Espelha `server/src/modules/lgpd/operators.ts` — a lista canônica da exportação LGPD.
 */
const PORTAL_OPERATORS = [
  {
    nome: "Meta Platforms (WhatsApp)",
    finalidade: "Envio das mensagens de WhatsApp (confirmações, lembretes e códigos de acesso)",
    dados: "Nome, telefone e conteúdo da mensagem",
    pais: "EUA (transferência internacional)",
    link: "https://www.facebook.com/privacy/policy/",
    linkLabel: "facebook.com/privacy/policy",
  },
  {
    nome: "Google LLC",
    finalidade: "Login com Google e entrega de notificações push do navegador",
    dados: "Nome, e-mail, identificador da conta e inscrição de push",
    pais: "EUA (transferência internacional)",
    link: "https://policies.google.com/privacy",
    linkLabel: "policies.google.com/privacy",
  },
  {
    nome: "Microsoft Corporation",
    finalidade: "Login com Microsoft (Entra ID)",
    dados: "Nome, e-mail e dados básicos do perfil",
    pais: "EUA (transferência internacional)",
    link: "https://privacy.microsoft.com/privacystatement",
    linkLabel: "privacy.microsoft.com/privacystatement",
  },
  {
    nome: "Asaas Gestão de Pagamentos Ltda",
    finalidade: "Cobrança e emissão de nota fiscal dos planos dos estabelecimentos",
    dados: "Nome/razão social, e-mail, CPF ou CNPJ, telefone e endereço (o cartão é informado diretamente na página hospedada do provedor)",
    pais: "Brasil",
    link: "https://www.asaas.com/politica-de-privacidade",
    linkLabel: "asaas.com/politica-de-privacidade",
  },
  {
    nome: "Cloudflare, Inc.",
    finalidade: "DNS, proxy e proteção da borda",
    dados: "Endereço IP e cabeçalhos HTTP",
    pais: "EUA (transferência internacional)",
    link: "https://www.cloudflare.com/privacypolicy/",
    linkLabel: "cloudflare.com/privacypolicy",
  },
  {
    nome: "HostPapa / ColoCrossing (hospedagem)",
    finalidade: "Hospedagem da aplicação, do banco de dados e dos backups",
    dados: "Todos os dados tratados pelo portal, em repouso",
    pais: "EUA (transferência internacional)",
    link: "https://www.hostpapa.com/privacy/",
    linkLabel: "hostpapa.com/privacy",
  },
  {
    nome: "Provedor de e-mail (SMTP) contratado",
    finalidade: "Envio do link de confirmação de e-mail e da redefinição de senha",
    dados: "Nome, e-mail e código/link de verificação",
    pais: "Conforme o provedor",
    link: "",
    linkLabel: "conforme o provedor contratado",
  },
  {
    nome: "Provedor de notificações push do seu navegador (Google, Mozilla ou Apple)",
    finalidade: "Entrega das notificações que você mesmo ativa",
    dados: "Inscrição de push e chaves do navegador",
    pais: "Conforme o navegador",
    link: "",
    linkLabel: "conforme o navegador",
  },
] as const;

/**
 * Termos de Uso e Política de Privacidade do portal do cliente.
 * Conteúdo inicial enxuto (MVP Fase 1) — o texto final deve ser revisado
 * juridicamente antes de produção.
 */
export function LegalPage({ doc }: LegalPageProps) {
  const isPrivacy = doc === "privacidade";
  return (
    <div className="min-h-screen w-full bg-white text-black">
      <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-black/10">
        <a href="/" className="flex items-center gap-2 text-base font-black lowercase tracking-tight">
          <img src="/kikin-symbol.png" alt="kikin" className="h-6 w-6 object-contain" />
          <span>
            kikin<span className="text-[#f97316]">.</span>
            <span className="font-bold opacity-70">cliente</span>
          </span>
        </a>
        <Link to="/login" className="text-xs font-bold uppercase tracking-wider text-black/50 hover:text-black">
          Entrar
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-14">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-blue-600">
          {isPrivacy ? "Política de Privacidade" : "Termos de Uso"}
        </p>
        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight">
          {isPrivacy ? "Seus dados, com respeito" : "Bem-vindo ao portal do cliente"}
        </h1>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-black/70">
          {isPrivacy ? (
            <>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">1. O que coletamos</h2>
                <p className="mt-2">
                  Para criar sua conta no portal usamos seu nome e e-mail. Quando você fizer login com
                  Google ou Microsoft, usamos apenas o e-mail verificado do provedor para identificar
                  sua conta.
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">2. Como tratamos (LGPD)</h2>
                <p className="mt-2">
                  Dados de contato sensíveis como telefone ou documento — usados apenas para vincular
                  você ao seu cadastro no salão — nunca são armazenados em claro: guardamos somente
                  uma versão com hash e mascarada. Você pode solicitar exportação ou exclusão dos
                  seus dados a qualquer momento.
                </p>
                <p className="mt-2">
                  Se você frequenta um estabelecimento de <b>saúde ou estética</b> (clínicas de estética,
                  procedimentos injetáveis, por exemplo), as informações do seu atendimento podem ser
                  <b> dados pessoais sensíveis</b> relativos à saúde (Art. 11 da LGPD). Nesse caso elas
                  ficam registradas no cadastro do salão — não no portal — e são tratadas para a
                  finalidade de atendimento e segurança do procedimento, com consentimento específico
                  solicitado pelo estabelecimento. O portal guarda apenas o vínculo com aquele
                  estabelecimento.
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">3. Compartilhamento</h2>
                <p className="mt-2">
                  Seus dados são usados exclusivamente para operar o portal e conectar sua conta ao
                  salão que você frequenta. <b>Não vendemos dados.</b> Para funcionar, o portal usa
                  operadores que tratam dados apenas para as finalidades abaixo:
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-black/15">
                        <th className="py-2 pr-3 align-top font-black uppercase tracking-tight text-black">Operador</th>
                        <th className="py-2 pr-3 align-top font-black uppercase tracking-tight text-black">Finalidade</th>
                        <th className="py-2 pr-3 align-top font-black uppercase tracking-tight text-black">Dados</th>
                        <th className="py-2 pr-3 align-top font-black uppercase tracking-tight text-black">País</th>
                        <th className="py-2 align-top font-black uppercase tracking-tight text-black">Política</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PORTAL_OPERATORS.map((op) => (
                        <tr key={op.nome} className="border-b border-black/10 align-top">
                          <td className="py-2 pr-3 font-bold text-black">{op.nome}</td>
                          <td className="py-2 pr-3">{op.finalidade}</td>
                          <td className="py-2 pr-3">{op.dados}</td>
                          <td className="py-2 pr-3">{op.pais}</td>
                          <td className="py-2">
                            {op.link ? (
                              <a
                                href={op.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-blue-600 underline"
                              >
                                {op.linkLabel}
                              </a>
                            ) : (
                              op.linkLabel
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3">
                  O envio de mensagens por WhatsApp é operado em infraestrutura própria do kikin,
                  conectada à rede do WhatsApp (Meta Platforms).
                </p>
                <p className="mt-2">
                  Os itens com país estrangeiro envolvem <b>transferência internacional</b> (Art. 33 da
                  LGPD), feita com base nas hipóteses legais aplicáveis (execução de contrato e
                  consentimento) e com salvaguardas técnicas como TLS em trânsito, minimização e uso de
                  hash para identificadores sensíveis. Com o estabelecimento que você frequenta,
                  compartilhamos apenas o necessário ao atendimento (nome, contato e dados do horário).
                </p>
                <p className="mt-2">
                  A lista completa de operadores, com finalidade e país, também vem no arquivo JSON da
                  sua exportação (Perfil → Meus dados).
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">4. Exportar meus dados</h2>
                <p className="mt-2">
                  Na sua área do cliente (<b>Perfil → Meus dados (LGPD)</b>) você baixa, a qualquer
                  momento e sem pedir autorização a ninguém, um arquivo <b>JSON</b> com tudo o que o
                  portal guarda sobre você: dados da conta (nome, e-mail, WhatsApp mascarado), seus
                  vínculos com os estabelecimentos, os agendamentos que o portal consegue ler, seus
                  consentimentos e os dispositivos que recebem notificações.
                </p>
                <p className="mt-2">
                  O arquivo não inclui senha, códigos ou tokens de acesso — nada que permita entrar
                  na sua conta.
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">5. Excluir minha conta</h2>
                <p className="mt-2">
                  Também na área do cliente você exclui sua conta quando quiser. Para sua segurança,
                  pedimos uma prova de identidade — <b>sua senha</b> ou um <b>código enviado por
                  WhatsApp</b> no número cadastrado — e que você digite <b>EXCLUIR</b> para confirmar.
                </p>
                <p className="mt-2">
                  <b>O que é apagado:</b> a sua conta do portal, seus vínculos e consentimentos com os
                  estabelecimentos, suas sessões (você sai de todos os aparelhos) e as inscrições de
                  notificação no seu navegador.
                </p>
                <p className="mt-2">
                  <b>O que permanece:</b> o seu cadastro e os seus agendamentos dentro de cada salão,
                  barbearia ou clínica são dados do próprio estabelecimento e <b>não</b> são alterados
                  pela exclusão da conta no portal. Se você quiser que o estabelecimento remova ou
                  corrija esses dados, fale diretamente com ele — o contato aparece na própria tela
                  de exclusão. A exclusão fica registrada de forma auditável (data, forma de
                  confirmação e quantidades removidas), sem guardar seus dados pessoais em claro.
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">6. Por quanto tempo guardamos</h2>
                <p className="mt-2">
                  Guardamos cada dado apenas pelo tempo necessário à finalidade ou ao cumprimento de
                  uma obrigação legal:
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-black/15">
                        <th className="py-2 pr-3 align-top font-black uppercase tracking-tight text-black">Dado</th>
                        <th className="py-2 align-top font-black uppercase tracking-tight text-black">Prazo de retenção</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-black/10 align-top">
                        <td className="py-2 pr-3 font-bold text-black">Códigos de acesso (OTP)</td>
                        <td className="py-2">10 minutos ou até o primeiro uso</td>
                      </tr>
                      <tr className="border-b border-black/10 align-top">
                        <td className="py-2 pr-3 font-bold text-black">Cadastro temporário (antes da confirmação)</td>
                        <td className="py-2">30 minutos</td>
                      </tr>
                      <tr className="border-b border-black/10 align-top">
                        <td className="py-2 pr-3 font-bold text-black">Sessão de acesso e renovação</td>
                        <td className="py-2">Sessão de 2 horas, renovável por até 30 dias (você pode encerrar antes)</td>
                      </tr>
                      <tr className="border-b border-black/10 align-top">
                        <td className="py-2 pr-3 font-bold text-black">Links de confirmação de e-mail e redefinição de senha</td>
                        <td className="py-2">De 1 a 24 horas</td>
                      </tr>
                      <tr className="border-b border-black/10 align-top">
                        <td className="py-2 pr-3 font-bold text-black">Registros de conexão e acesso (IP, data e hora)</td>
                        <td className="py-2">6 meses — Marco Civil da Internet, Art. 15</td>
                      </tr>
                      <tr className="border-b border-black/10 align-top">
                        <td className="py-2 pr-3 font-bold text-black">Registro de notificações enviadas</td>
                        <td className="py-2">180 dias</td>
                      </tr>
                      <tr className="border-b border-black/10 align-top">
                        <td className="py-2 pr-3 font-bold text-black">Registro da exclusão da conta (auditoria)</td>
                        <td className="py-2">Mantido apenas enquanto necessário para comprovar a eliminação e atender a obrigações legais</td>
                      </tr>
                      <tr className="border-b border-black/10 align-top">
                        <td className="py-2 pr-3 font-bold text-black">Backup de conta excluída</td>
                        <td className="py-2">Até 30 dias, com descarte registrado em log</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-2">
                  O cadastro e o histórico de atendimento dentro de cada estabelecimento seguem a
                  política do próprio estabelecimento, que é o controlador desses dados.
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">7. Segurança</h2>
                <p className="mt-2">
                  Todo o tráfego entre o seu dispositivo e o portal é protegido por{" "}
                  <b>criptografia em trânsito (HTTPS/TLS)</b>. Em repouso, aplicamos proteção
                  criptográfica a campos sensíveis — como telefone e documento, guardados de forma
                  mascarada e com hash irreversível — e o acesso aos dados é restrito por autenticação.
                  A criptografia de disco da infraestrutura é uma medida em avaliação no nosso roadmap
                  de segurança, ainda não implantada, sem prazo prometido. Os dados de cartão de
                  pagamento são informados e processados diretamente pelo provedor de pagamentos
                  (Asaas, certificado PCI-DSS), em página de checkout hospedada do provedor: o kikin
                  não os coleta nem armazena. Se o provedor enviar, no payload do webhook, dados de
                  cartão mascarados, eles não são armazenados nem registrados em log.
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">8. Falar com o encarregado (DPO)</h2>
                <p className="mt-2">
                  Para exercer qualquer um dos seus direitos (Art. 18 da LGPD) ou tirar dúvidas sobre
                  o tratamento dos seus dados, fale com o nosso Encarregado de Proteção de Dados:{" "}
                  <a href="mailto:dpo@kikin.com.br" className="text-blue-600 underline">
                    dpo@kikin.com.br
                  </a>
                  . Você também pode usar o e-mail{" "}
                  <a href="mailto:privacidade@kikin.com.br" className="text-blue-600 underline">
                    privacidade@kikin.com.br
                  </a>
                  .
                </p>
                <p className="mt-2 text-xs italic text-black/40">
                  PLACEHOLDER — canal provisório, a confirmar pelo encarregado antes da publicação oficial.
                </p>
              </section>
              <p className="pt-2 text-xs text-black/40">
                Última atualização: 10 de setembro de 2026 — Versão 2026-09-10 (MVP). Documento final em
                revisão jurídica.
              </p>
            </>
          ) : (
            <>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">1. O serviço</h2>
                <p className="mt-2">
                  O portal do cliente kikin permite consultar, agendar, remarcar e cancelar horários
                  nos salões, barbeiros e clínicas parceiros, direto pelo celular.
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">2. Sua conta</h2>
                <p className="mt-2">
                  Você é responsável por manter sua senha em segurança. Contas criadas via Google ou
                  Microsoft seguem as regras de segurança desses provedores para o login.
                </p>
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">3. Cancelamentos</h2>
                <p className="mt-2">
                  Políticas de cancelamento e remarcação seguem as regras de cada estabelecimento.
                  Faltas recorrentes sem aviso podem estar sujeitas a restrições definidas pelo salão.
                </p>
              </section>
              <p className="pt-2 text-xs text-black/40">
                Versão 2026-09-04 (MVP). Documento final em revisão jurídica.
              </p>
            </>
          )}
        </div>

        <Link to="/" className="mt-10 inline-block text-xs font-bold uppercase tracking-[0.2em] text-black/50 hover:text-black">
          ← voltar para a home
        </Link>
      </main>
    </div>
  );
}
