import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export interface LogoFluidScrollProps {
  /** Texto grande que fica atrás da logo em movimento. */
  label?: string;
  caption?: string;
  videoSrc?: string;
  posterSrc?: string;
  className?: string;
}

/**
 * Scroll cinematográfico com a FLUIDEZ DA LOGO DO KIKIN:
 * o vídeo é revelado através do próprio símbolo da logo, que cresce do tamanho
 * mínimo até ocupar a tela — sem formatos alheios (nem lábios, nem círculo).
 */
export function LogoFluidScroll({
  label = "Seu horário",
  caption = "uma experiência fluida: agende, remaque e cancele com a leveza do kikin.",
  videoSrc = "https://res.cloudinary.com/dsuwzuaxp/video/upload/cinematic_drone_videos_shew9q.mp4",
  posterSrc = "https://res.cloudinary.com/dsuwzuaxp/video/upload/cinematic_drone_videos_shew9q.jpg",
  className = "",
}: LogoFluidScrollProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const mask = maskRef.current;
    if (!wrap || !mask) return;

    if (videoRef.current) {
      videoRef.current.defaultMuted = true;
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
    }

    const ctx = gsap.context(() => {
      const getInitial = () => {
        if (typeof window === "undefined") return 260;
        if (window.innerWidth < 640) return 170;
        if (window.innerWidth < 1024) return 220;
        return 300;
      };

      const applySize = (px: number) => {
        mask.style.setProperty("--logoW", `${px}px`);
        mask.style.webkitMaskSize = `${px}px auto`;
        mask.style.maskSize = `${px}px auto`;
      };

      applySize(getInitial());

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrap,
          start: "top top",
          end: "+=260%",
          scrub: 1.1,
          pin: pinRef.current,
          pinSpacing: true,
          anticipatePin: 1,
          onUpdate: (self) => {
            const start = getInitial();
            const current = start + Math.pow(self.progress, 2.2) * 4200;
            applySize(current);
          },
        },
      });

      if (videoRef.current) {
        tl.fromTo(videoRef.current, { scale: 1 }, { scale: 1.28, ease: "none" }, 0);
      }
    }, wrap);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={wrapRef}
      className={`relative w-full bg-black text-white selection:bg-[#f97316] selection:text-black ${className}`}
      style={{ minHeight: "320vh" }}
    >
      <div
        ref={pinRef}
        className="sticky top-0 flex h-screen w-full items-center justify-center overflow-hidden bg-black"
      >
        {/* Água-marca tipográfica ao fundo */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15vw] font-black uppercase leading-none tracking-[-0.04em] text-white/[0.05] select-none"
        >
          {label}
        </span>

        {/* Vídeo revelado pela SILHUETA DA LOGO DO KIKIN */}
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div
            ref={maskRef}
            className="relative flex h-full w-full items-center justify-center overflow-hidden"
            style={{
              WebkitMaskImage: "url('/kikin-symbol-white.png')",
              maskImage: "url('/kikin-symbol-white.png')",
              WebkitMaskPosition: "50% 50%",
              maskPosition: "50% 50%",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskSize: "var(--logoW, 260px) auto",
              maskSize: "var(--logoW, 260px) auto",
              transition: "mask-size 0.04s linear, -webkit-mask-size 0.04s linear",
            }}
          >
            <video
              ref={videoRef}
              className="h-full w-full object-cover will-change-transform"
              loop
              muted
              playsInline
              autoPlay
              preload="auto"
              poster={posterSrc}
            >
              <source src={videoSrc} type="video/mp4" />
            </video>
          </div>
        </div>

        {/* Legenda */}
        <p className="absolute bottom-10 left-1/2 z-20 w-full max-w-xl -translate-x-1/2 px-6 text-center text-[11px] font-bold uppercase leading-relaxed tracking-[0.2em] text-white/70 sm:text-xs">
          <span className="text-[#f97316]">{label}.</span> {caption}
        </p>
      </div>
    </section>
  );
}

export default LogoFluidScroll;
