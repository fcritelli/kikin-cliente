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
              </section>
              <section>
                <h2 className="text-base font-black uppercase tracking-tight text-black">3. Compartilhamento</h2>
                <p className="mt-2">
                  Seus dados são usados exclusivamente para operar o portal e conectar sua conta ao
                  salão que você frequenta. Não vendemos dados.
                </p>
              </section>
              <p className="pt-2 text-xs text-black/40">
                Versão 2026-09-04 (MVP). Documento final em revisão jurídica.
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
