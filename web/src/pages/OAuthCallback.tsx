import { useEffect, useRef, useState, type FormEvent } from "react";
import { WHATSAPP_OPTIN_OPTIONAL_NOTE } from "@/lib/lgpdCopy";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  ApiError,
  oauthRedirectUri,
  resolveOAuthCallbackProvider,
  type SocialProvider,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

/**
 * Callback OAuth do portal (rota /auth): o Google/Microsoft redireciona para cá
 * com ?code (e ?state no caso da Microsoft). Enviamos o código ao gateway:
 *  - conta já existe (por provider ou e-mail)  -> SUCCESS  -> /conta
 *  - conta nova                                -> NEED_SETUP -> mini passo nome+termos
 */
export function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { applySession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);

  // Mini passo pós-OAuth (NEED_SETUP)
  const [pending, setPending] = useState<{ tempToken: string; fullName: string } | null>(null);

  const afterLogin = () => {
    const raw = sessionStorage.getItem("kc_next");
    sessionStorage.removeItem("kc_next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/conta";
  };
  const [setupName, setSetupName] = useState("");
  const [setupConsent, setSetupConsent] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  // Convite do estabelecimento (link /e/<slug> guardado pelo AuthPage): o cadastro com
  // Google/Microsoft também pede o WhatsApp e já sai vinculado ao salão.
  const pendingSlug = (() => {
    try {
      const raw = sessionStorage.getItem("kc_next") || "";
      const m = raw.match(/^\/e\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  })();
  const [setupPhone, setSetupPhone] = useState("");
  const [setupOptIn, setSetupOptIn] = useState(false);
  const [setupSalonName, setSetupSalonName] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingSlug) return;
    let active = true;
    api
      .bookingSalon(pendingSlug)
      .then((meta) => {
        if (active) setSetupSalonName(meta.name);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pendingSlug]);

  const runSocial = async (provider: SocialProvider, code: string) => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.social(provider, { code, redirectUri: oauthRedirectUri() });
      if (outcome.status === "SUCCESS") {
        const me = await applySession(outcome.tokens);
        navigate(me ? afterLogin() : "/login?erro=sessao", { replace: true });
        return;
      }
      // NEED_SETUP: mostra nome (pré-preenchido) + aceite de termos
      setPending({ tempToken: outcome.tempToken, fullName: outcome.socialUser.fullName });
      setSetupName(outcome.socialUser.fullName || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível concluir o login. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (handled.current) return;
    const code = searchParams.get("code");
    if (!code) {
      // Sem code: /auth aberto direto -> manda para o login
      navigate("/login", { replace: true });
      return;
    }
    handled.current = true;
    const provider = resolveOAuthCallbackProvider(searchParams.get("state"));
    if (provider === "invalid") {
      setError("Sessão OAuth inválida. Tente entrar novamente.");
      return;
    }
    runSocial(provider, code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!setupName.trim() || setupName.trim().length < 2) return setError("Informe seu nome.");
    if (!setupConsent) return setError("É necessário aceitar os termos e a política de privacidade.");
    const phoneDigits = setupPhone.replace(/\D/g, "");
    if (pendingSlug && phoneDigits.length < 10) {
      return setError("Informe seu WhatsApp com DDD para vincular o estabelecimento.");
    }
    if (!pending) return;
    setSetupBusy(true);
    try {
      const res = await api.completeSocial({
        tempToken: pending.tempToken,
        fullName: setupName.trim(),
        consent: true,
        ...(pendingSlug ? { salonRef: pendingSlug, phone: phoneDigits, whatsappOptIn: setupOptIn } : {}),
      });
      await applySession(res.tokens);
      navigate(afterLogin(), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao finalizar o cadastro.");
    } finally {
      setSetupBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white px-6 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 right-[-10%] h-[30rem] w-[30rem] rounded-full bg-blue-200/40 blur-3xl" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 sm:p-8 text-center shadow-[0_20px_60px_-20px_rgba(0,0,0,0.15)]">
        <img src="/kikin-symbol.png" alt="kikin" className="mx-auto h-9 w-9 object-contain" />

        {pending ? (
          <form onSubmit={submitSetup} className="mt-6 text-left">
            <h1 className="text-xl font-black uppercase tracking-tight">Quase lá!</h1>
            <p className="mt-2 text-sm leading-relaxed text-black/60">
              Sua identidade foi confirmada pelo provedor. Confirme seu nome e aceite os termos
              para criar sua conta no portal.
            </p>
            <div className="mt-6 space-y-4">
              <div>
                <Label htmlFor="setup-name">Nome</Label>
                <Input id="setup-name" autoComplete="name" value={setupName} onChange={(e) => setSetupName(e.target.value)} />
              </div>
              {pendingSlug && (
                <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3.5">
                  <p className="text-xs font-semibold leading-relaxed text-blue-800">
                    Convite de <b>{setupSalonName || pendingSlug}</b>. Informe seu WhatsApp para o estabelecimento já
                    aparecer no seu painel.
                  </p>
                  <div>
                    <Label htmlFor="setup-phone">Seu WhatsApp (com DDD)</Label>
                    <Input
                      id="setup-phone"
                      type="tel"
                      autoComplete="tel"
                      value={setupPhone}
                      onChange={(e) => setSetupPhone(e.target.value)}
                      placeholder="(11) 98765-4321"
                    />
                  </div>
                  <label className="flex items-start gap-2.5 text-xs leading-relaxed text-blue-900/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setupOptIn}
                      onChange={(e) => setSetupOptIn(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                    />
                    <span>Confirmo que este número é meu WhatsApp e aceito receber confirmações e lembretes por ele.</span>
                  </label>
                  {/* LGPD Art. 18, VIII — consentir é opcional e a recusa não tira o serviço */}
                  <p className="mt-2 text-[11px] leading-relaxed text-blue-900/70">{WHATSAPP_OPTIN_OPTIONAL_NOTE}</p>
                </div>
              )}
              <label className="flex items-start gap-2.5 text-xs leading-relaxed text-black/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={setupConsent}
                  onChange={(e) => setSetupConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                />
                <span>
                  Li e aceito os <Link to="/termos" className="font-bold text-blue-600 hover:underline">Termos de Uso</Link> e a{" "}
                  <Link to="/privacidade" className="font-bold text-blue-600 hover:underline">Política de Privacidade</Link>.
                </span>
              </label>
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={setupBusy}>
                {setupBusy ? "Criando conta..." : "Criar minha conta"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-6">
            <h1 className="text-xl font-black uppercase tracking-tight">
              {busy ? "Conectando..." : error ? "Algo deu errado" : "Redirecionando..."}
            </h1>
            {error ? (
              <>
                <p className="mt-3 text-sm text-black/60">{error}</p>
                <Button type="button" variant="outline" className="mt-6" onClick={() => navigate("/login")}>
                  Voltar para o login
                </Button>
              </>
            ) : (
              <p className="mt-3 text-sm text-black/60">Um instante enquanto validamos sua identidade…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
