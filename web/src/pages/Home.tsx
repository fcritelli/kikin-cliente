import { CalendarHeart, ChevronRight, Sparkles } from "lucide-react";
import { CinematicScroll } from "@/components/ui/CinematicScroll";
import { Button } from "@/components/ui/Button";

/**
 * Página moderna de referência (kikin-cliente).
 * Direção: hero tipográfico + seção cinematográfica com scroll (lip-scroll-zoomin)
 * + CTA + rodapé — inspiração visual de "ui-ux-pro-max-skill".
 */
export function Home() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-white text-black">
      {/* NAV */}
      <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 md:px-10 py-4 mix-blend-difference text-white">
        <a href="#" className="text-sm font-black uppercase tracking-[0.3em]">
          Kikin<span className="text-blue-500">.</span>Cliente
        </a>
        <nav className="flex items-center gap-2 sm:gap-4 text-[11px] sm:text-xs font-bold uppercase tracking-wider">
          <a href="#experiencia" className="hover:opacity-70">Experiência</a>
          <a href="#sobre" className="hover:opacity-70">Sobre</a>
          <a href="#cta" className="hidden sm:inline hover:opacity-70">Começar</a>
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

      {/* SCROLL CINEMÁTICO — portal circular expandindo (sem "beijo") */}
      <section id="experiencia">
        <CinematicScroll
          label="Seu horário"
          caption="do círculo ao mundo: acompanhe sua agenda com um novo olhar — simples, rápido, do seu jeito."
          accentClass="text-blue-400"
        />
      </section>

      {/* CTA */}
      <section id="cta" className="relative bg-black text-white px-6 py-28 text-center">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-4xl font-black uppercase tracking-tight sm:text-6xl">
            Pronto para <span className="text-blue-400">começar?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-xs font-semibold uppercase tracking-wider text-white/60 sm:text-sm">
            Crie sua conta em segundos e veja seus próximos horários em um só lugar.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              className="bg-white text-black hover:bg-blue-500 hover:text-white"
              onClick={() => (window.location.href = "/cadastro")}
            >
              <CalendarHeart className="h-4 w-4" /> Criar conta grátis
            </Button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-black/10 bg-white px-6 py-10 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-black/60">
          Kikin<span className="text-blue-600">.</span>Cliente — referência visual
        </p>
        <p className="mt-2 text-[11px] text-black/40">
          Tailwind + shadcn/ui + GSAP · componente LipScrollZoominAnimation
        </p>
      </footer>
    </div>
  );
}
