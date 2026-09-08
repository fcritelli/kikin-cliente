import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export interface CinematicScrollProps {
  /** Texto grande fixo ao fundo (aparece por trás do portal). */
  label?: string;
  /** Chamada pequena exibida após o zoom (rodapé da seção). */
  caption?: string;
  videoSrc?: string;
  posterSrc?: string;
  accentClass?: string;
  className?: string;
}

/**
 * Seção cinematográfica de scroll — "portal" de vídeo circular que cresce até
 * preencher a tela (sem máscaras de lábios). Padrão neutro/moderno.
 */
export function CinematicScroll({
  label = "EM MOVIMENTO",
  caption = "Agende, remaque e cancele — tudo em um só lugar.",
  videoSrc = "https://res.cloudinary.com/dsuwzuaxp/video/upload/cinematic_drone_videos_shew9q.mp4",
  posterSrc = "https://res.cloudinary.com/dsuwzuaxp/video/upload/cinematic_drone_videos_shew9q.jpg",
  accentClass = "text-blue-600",
  className = "",
}: CinematicScrollProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const portal = portalRef.current;
    if (!wrap || !portal) return;

    if (videoRef.current) {
      videoRef.current.defaultMuted = true;
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
    }

    const ctx = gsap.context(() => {
      const size = () => (typeof window === "undefined" ? 320 : Math.min(window.innerWidth, 640));
      gsap.set(portal, { width: size() * 0.55, height: size() * 0.55 });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrap,
          start: "top top",
          end: "+=260%",
          scrub: 1,
          pin: pinRef.current,
          pinSpacing: true,
          anticipatePin: 1,
        },
      });

      tl.to(portal, { width: "150vw", height: "150vw", ease: "power1.inOut" }, 0);
      if (videoRef.current) {
        tl.fromTo(videoRef.current, { scale: 1.08 }, { scale: 1.3, ease: "none" }, 0);
      }
    }, wrap);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={wrapRef}
      className={`relative w-full bg-black text-white selection:bg-blue-600 selection:text-white ${className}`}
      style={{ minHeight: "320vh" }}
    >
      <div
        ref={pinRef}
        className="sticky top-0 flex h-screen w-full items-center justify-center overflow-hidden bg-black"
      >
        {/* Grande texto fixo atrás do portal */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[16vw] font-black uppercase leading-none tracking-[-0.04em] text-white/[0.06] select-none"
        >
          {label}
        </span>

        {/* Portal de vídeo que cresce */}
        <div
          ref={portalRef}
          className="relative overflow-hidden rounded-full shadow-[0_0_80px_-20px_rgba(37,99,235,0.6)]"
          style={{ width: 320, height: 320 }}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover will-change-transform"
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

        {/* Cantos com marca (clean, sem ícones de "beijo") */}
        <div className="pointer-events-none absolute inset-6 select-none">
          <span className="absolute left-0 top-0 h-5 w-5 border-l-2 border-t-2 border-white/40" />
          <span className="absolute right-0 top-0 h-5 w-5 border-r-2 border-t-2 border-white/40" />
          <span className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 border-white/40" />
          <span className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-white/40" />
        </div>

        {/* Legenda (fixa em uma das pontas) */}
        <p className="absolute bottom-10 left-1/2 w-full max-w-xl -translate-x-1/2 px-6 text-center text-[11px] font-bold uppercase leading-relaxed tracking-[0.2em] text-white/70 sm:text-xs">
          <span className={accentClass}>{label}.</span> {caption}
        </p>
      </div>
    </section>
  );
}

export default CinematicScroll;
