import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  googleAuthorizeUrl,
  microsoftAuthorizeUrl,
  VITE_GOOGLE_CLIENT_ID,
  VITE_MICROSOFT_CLIENT_ID,
} from "@/lib/api";

interface SocialButtonsProps {
  action: "login" | "signup";
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
      <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

const SOCIAL_STYLE =
  "w-full h-11 px-4 border border-black/15 bg-white hover:bg-black/[0.03] text-black font-semibold text-sm rounded-xl flex items-center justify-center gap-3 transition-all shadow-sm active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

/**
 * Botões "Continuar com Google/Microsoft" (mesma mecânica do Kikin): redirecionam
 * para o provedor com response_type=code; o retorno cai em /auth (callback), que
 * envia o código ao gateway.
 */
export function SocialButtons({ action }: SocialButtonsProps) {
  const [pending, setPending] = useState<"google" | "microsoft" | null>(null);
  const googleReady = Boolean(VITE_GOOGLE_CLIENT_ID);
  const microsoftReady = Boolean(VITE_MICROSOFT_CLIENT_ID);

  const verb = action === "login" ? "Entrar" : "Cadastrar";

  const goGoogle = () => {
    if (!googleReady || pending) return;
    setPending("google");
    window.location.href = googleAuthorizeUrl(VITE_GOOGLE_CLIENT_ID);
  };
  const goMicrosoft = () => {
    if (!microsoftReady || pending) return;
    setPending("microsoft");
    window.location.href = microsoftAuthorizeUrl(VITE_MICROSOFT_CLIENT_ID);
  };

  return (
    <div className="grid gap-2.5">
      <button
        type="button"
        onClick={goGoogle}
        disabled={!googleReady || pending !== null}
        title={googleReady ? undefined : "Login Google ainda não configurado neste ambiente"}
        className={cn(SOCIAL_STYLE)}
      >
        <GoogleIcon />
        <span>{pending === "google" ? "Conectando ao Google..." : `${verb} com o Google`}</span>
      </button>
      <button
        type="button"
        onClick={goMicrosoft}
        disabled={!microsoftReady || pending !== null}
        title={microsoftReady ? undefined : "Login Microsoft ainda não configurado neste ambiente"}
        className={cn(SOCIAL_STYLE)}
      >
        <MicrosoftIcon />
        <span>{pending === "microsoft" ? "Conectando à Microsoft..." : `${verb} com a Microsoft`}</span>
      </button>
    </div>
  );
}
