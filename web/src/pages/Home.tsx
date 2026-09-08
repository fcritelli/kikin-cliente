import { ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Página do kikin-cliente (versão curta): nav + hero + rodapé.
 */
export function Home() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-white text-black">
      {/* NAV */}
      <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 md:px-10 py-4 mix-blend-difference text-white">
        <a href="#" className="flex items-center gap-2 text-sm font-black lowercase tracking-tight">
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
          <Button variant="outline" size="sm" className="text-white border-white bg-transparent hover:bg-white hover:text-black">
            Entrar
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
          <h1 className="mt-6 text-[13vw] leading-[0.9] font-black uppercase tracking-[-0.04em] sm:text-[11vw] md:text-[7rem] lg:text-[8.5rem]">
            Sua agenda,
            <br />
            <span className="text-blue-600">em movimento.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xs font-bold uppercase leading-relaxed tracking-wider text-black/70 sm:text-sm md:text-base">
            Agende, remaque e cancele horários no salão, barbeiro ou clínica — direto do seu
            celular, sem telefonemas.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => (window.location.href = "/cadastro")}>
              Criar minha conta <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="lg" onClick={() => (window.location.href = "/login")}>
              Já tenho conta
            </Button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-black/10 bg-white px-6 py-10 text-center">
        <div className="flex items-center justify-center gap-2 text-base font-black lowercase tracking-tight">
          <img src="/kikin-symbol.png" alt="kikin" className="h-7 w-7 object-contain" />
          <span>
            kikin<span className="text-[#f97316]">.</span>
            <span className="font-bold opacity-70">cliente</span>
          </span>
        </div>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50">
          Portal do cliente · kikin-cliente (referência visual)
        </p>
      </footer>
    </div>
  );
}
