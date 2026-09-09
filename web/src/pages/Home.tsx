import { useNavigate } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Página do kikin-cliente (versão curta): nav + hero + rodapé.
 */
export function Home() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const go = (path: string) => () => navigate(path);
  const ctaHref = account ? "/conta" : "/cadastro";
  const ctaLabel = account ? "Ir para minha conta" : "Criar minha conta";

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-white text-black">
      {/* NAV */}
      <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 md:px-10 py-4 mix-blend-difference text-white">
        <a href="/" className="flex items-center gap-2 text-sm font-black lowercase tracking-tight">
          <img
            src="/kikin-symbol-white.png"
            alt="kikin"
            className="h-6 w-6 object-contain mix-blend-difference"
          />
          <span>
            kikin<span className="text-[#f97316]">.</span>
            <span className="font-bold opacity-80">cliente</span>
          </span>
        </a>
        <nav className="flex items-center gap-2 sm:gap-4 text-[11px] sm:text-xs font-bold uppercase tracking-wider">
          {account && (
            <button
              type="button"
              onClick={go("/conta")}
              className="hidden sm:inline-block px-3 py-2 rounded-full hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              Minha conta
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={go(account ? "/conta" : "/login")}
            className="text-white border-white bg-transparent hover:bg-white hover:text-black"
          >
            {account ? "Minha conta" : "Entrar"}
          </Button>
        </nav>
      </header>

      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-white px-6">
        <div className="pointer-events-none absolute -top-40 right-[-10%] h-[40rem] w-[40rem] rounded-full bg-blue-200/40 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-20%] left-[-8%] h-[34rem] w-[34rem] rounded-full bg-blue-100/60 blur-3xl" />
        <div className="relative z-10 max-w-6xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-600/30 bg-blue-600/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.25em] text-blue-700">
            <Sparkles className="h-3 w-3" /> Novo portal do cliente
          </span>
          <h1 className="mt-6 text-[11vw] leading-[1.02] font-display font-semibold tracking-[0.01em] sm:text-[8vw] md:text-[5.25rem] lg:text-[6.25rem]">
            Conectando você
            <br />
            <span className="italic text-blue-600">ao seu lugar preferido.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xs font-bold uppercase leading-relaxed tracking-wider text-black/70 sm:text-sm md:text-base">
            Agende, remaque e cancele horários no salão, barbeiro ou clínica — direto do seu
            celular, sem telefonemas.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={go(ctaHref)}>
              {ctaLabel} <ChevronRight className="h-4 w-4" />
            </Button>
            {!account && (
              <Button variant="outline" size="lg" onClick={go("/login")}>
                Já tenho conta
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-black/10 bg-white px-6 py-10 text-center">
        <a href="/" className="inline-flex items-center justify-center gap-2 text-base font-black lowercase tracking-tight">
          <img src="/kikin-symbol.png" alt="kikin" className="h-7 w-7 object-contain" />
          <span>
            kikin<span className="text-[#f97316]">.</span>
            <span className="font-bold opacity-70">cliente</span>
          </span>
        </a>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50">
          Portal do cliente · kikin-cliente (referência visual)
        </p>
      </footer>
    </div>
  );
}
