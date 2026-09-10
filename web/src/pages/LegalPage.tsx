import { Link } from "react-router-dom";

interface LegalPageProps {
  doc: "termos" | "privacidade";
}

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
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li><b>Meta Platforms</b> — envio das mensagens de WhatsApp (confirmações, lembretes e códigos de acesso) — <i>EUA</i>.</li>
                  <li><b>Sentry</b> — monitoramento de erros e desempenho da aplicação — <i>EUA</i>.</li>
                  <li><b>Google</b> — login com Google e entrega de notificações push do navegador — <i>EUA</i>.</li>
                  <li><b>Microsoft</b> — login com Microsoft — <i>EUA</i>.</li>
                  <li><b>Asaas</b> — cobrança e emissão de nota fiscal dos planos dos estabelecimentos — <i>Brasil</i>.</li>
                  <li><b>Cloudflare</b> — DNS, proxy e proteção da borda — <i>EUA</i>.</li>
                  <li><b>Provedor de e-mail (SMTP) contratado</b> — envio do link de confirmação de e-mail e da redefinição de senha — <i>conforme o provedor</i>.</li>
                  <li><b>Provedor de notificações push do seu navegador</b> (Google, Mozilla ou Apple, conforme o navegador) — entrega das notificações que você mesmo ativa — <i>conforme o navegador</i>.</li>
                </ul>
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
              <p className="pt-2 text-xs text-black/40">
                Versão 2026-09-10 (MVP). Documento final em revisão jurídica.
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
