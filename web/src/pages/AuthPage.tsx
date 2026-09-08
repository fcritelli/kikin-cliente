import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { SocialButtons } from "@/components/auth/SocialButtons";
import { WhatsAppAuthPanel } from "@/components/auth/WhatsAppAuthPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { cn } from "@/lib/utils";

export type AuthMode = "login" | "signup";

interface AuthPageProps {
  mode: AuthMode;
}

/**
 * Página de login/cadastro do portal do cliente — mesma forma do Kikin:
 * Google/Microsoft (continuar com) + e-mail/senha.
 */
export function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { applySession } = useAuth();
  const [tab, setTab] = useState<AuthMode>(mode);
  const [view, setView] = useState<"form" | "forgot" | "reset" | "sent">("form");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const created = searchParams.get("criada") === "1";

  // ---- formulário e-mail/senha
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);

  const switchTab = (next: AuthMode) => {
    setTab(next);
    setView("form");
    setError(null);
  };

  const submitPasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Preencha e-mail e senha.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.login({ email, password });
      const me = await applySession(res.tokens);
      if (!me) {
        // login deu tokens mas /me falhou (conta desativada entre os passos)
        setError("Não foi possível carregar sua conta. Tente novamente.");
        return;
      }
      navigate("/conta", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        setSentEmail(email);
        setView("sent");
      } else {
        setError(err instanceof ApiError ? err.message : "Erro ao entrar. Tente novamente.");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (tab === "signup") {
      if (!fullName.trim() || fullName.trim().length < 2) return setError("Informe seu nome.");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Informe um e-mail válido.");
      if (!password || password.length < 8) return setError("A senha deve ter no mínimo 8 caracteres.");
      if (password !== confirmPassword) return setError("As senhas não conferem.");
      if (!consent) return setError("É necessário aceitar os termos e a política de privacidade.");
    }
    setBusy(true);
    try {
      const res = await api.signup({ fullName, email, password, consent });
      // Em dev/hml (EMAIL_VERIFY_RETURN_TOKEN) o token volta na resposta: confirma na hora.
      if (res.verificationToken) {
        await api.verifyEmail(res.verificationToken);
        navigate("/login?criada=1", { replace: true });
        return;
      }
      setSentEmail(res.email);
      setView("sent");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao criar conta. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email) return setError("Informe seu e-mail.");
    setBusy(true);
    try {
      const res = await api.forgotPassword(email);
      if (res.resetToken) {
        setResetToken(res.resetToken);
        setView("reset");
        return;
      }
      setSentEmail(email);
      setView("sent");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao solicitar redefinição.");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!resetToken) return setError("Token de redefinição ausente.");
    if (!password || password.length < 8) return setError("A senha deve ter no mínimo 8 caracteres.");
    if (password !== confirmPassword) return setError("As senhas não conferem.");
    setBusy(true);
    try {
      await api.resetPassword(resetToken, password);
      setView("form");
      switchTab("login");
      alert("Senha redefinida! Entre com sua nova senha.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao redefinir senha.");
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.resendVerification(sentEmail);
      if (res.verificationToken) {
        await api.verifyEmail(res.verificationToken);
        navigate("/login?criada=1", { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao reenviar verificação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-white px-6 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 right-[-10%] h-[30rem] w-[30rem] rounded-full bg-blue-200/40 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-20%] left-[-8%] h-[26rem] w-[26rem] rounded-full bg-blue-100/60 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2 text-xl font-black lowercase tracking-tight">
            <img src="/kikin-symbol.png" alt="kikin" className="h-8 w-8 object-contain" />
            <span>
              kikin<span className="text-[#f97316]">.</span>
              <span className="font-bold opacity-70">cliente</span>
            </span>
          </Link>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.15)]">
          {created && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
              Conta criada e e-mail confirmado! Agora entre com sua senha.
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {view === "sent" ? (
            <div className="text-center">
              <h1 className="text-xl font-black uppercase tracking-tight">Verifique seu e-mail</h1>
              <p className="mt-3 text-sm leading-relaxed text-black/60">
                Enviamos um link de confirmação para <b className="text-black">{sentEmail}</b>.
                Clique no link para ativar sua conta e depois entre.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={resendVerification} disabled={busy}>
                  Reenviar e-mail
                </Button>
                <Button type="button" variant="ghost" onClick={() => switchTab("login")}>
                  Já confirmei — quero entrar
                </Button>
              </div>
            </div>
          ) : view === "forgot" ? (
            <form onSubmit={submitForgot}>
              <h1 className="text-xl font-black uppercase tracking-tight">Recuperar senha</h1>
              <p className="mt-2 text-sm text-black/60">Informe o e-mail da sua conta e enviaremos um link de redefinição.</p>
              <div className="mt-6 space-y-4">
                <div>
                  <Label htmlFor="forgot-email">E-mail</Label>
                  <Input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Enviando..." : "Enviar link de redefinição"}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setView("form")}>
                  Voltar para o login
                </Button>
              </div>
            </form>
          ) : view === "reset" ? (
            <form onSubmit={submitReset}>
              <h1 className="text-xl font-black uppercase tracking-tight">Nova senha</h1>
              <p className="mt-2 text-sm text-black/60">Escolha uma nova senha com no mínimo 8 caracteres.</p>
              <div className="mt-6 space-y-4">
                <div>
                  <Label htmlFor="reset-pass">Nova senha</Label>
                  <Input id="reset-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div>
                  <Label htmlFor="reset-pass2">Confirme a nova senha</Label>
                  <Input id="reset-pass2" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Salvando..." : "Redefinir senha"}
                </Button>
              </div>
            </form>
          ) : (
            <>
              {/* Abas Login / Cadastro */}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/[0.04] p-1 mb-6">
                {(["login", "signup"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => switchTab(t)}
                    className={cn(
                      "rounded-lg py-2 text-sm font-bold uppercase tracking-wider transition-all cursor-pointer",
                      tab === t ? "bg-white text-black shadow-sm" : "text-black/50 hover:text-black"
                    )}
                  >
                    {t === "login" ? "Entrar" : "Cadastrar"}
                  </button>
                ))}
              </div>

              <h1 className="text-xl font-black uppercase tracking-tight">
                {tab === "login" ? "Bem-vindo de volta" : "Crie sua conta"}
              </h1>
              <p className="mt-1.5 text-sm text-black/60">
                {tab === "login"
                  ? "Entre para ver sua agenda no salão."
                  : "Agende, remaque e cancele horários — rápido e sem telefone."}
              </p>

              <div className="mt-6 grid gap-2.5">
                <SocialButtons action={tab} />
                <WhatsAppAuthPanel />
              </div>

              <div className="my-6 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.2em] text-black/40">
                <span className="h-px flex-1 bg-black/10" />
                ou com e-mail
                <span className="h-px flex-1 bg-black/10" />
              </div>

              {tab === "login" ? (
                <form onSubmit={submitPasswordLogin} className="space-y-4">
                  <div>
                    <Label htmlFor="login-email">E-mail</Label>
                    <Input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-pass">Senha</Label>
                      <button type="button" onClick={() => setView("forgot")} className="mb-1.5 text-xs font-bold text-blue-600 hover:underline cursor-pointer">
                        Esqueci minha senha
                      </button>
                    </div>
                    <Input id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Entrando..." : "Entrar"}
                  </Button>
                </form>
              ) : (
                <form onSubmit={submitSignup} className="space-y-4">
                  <div>
                    <Label htmlFor="signup-name">Nome</Label>
                    <Input id="signup-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" />
                  </div>
                  <div>
                    <Label htmlFor="signup-email">E-mail</Label>
                    <Input id="signup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
                  </div>
                  <div>
                    <Label htmlFor="signup-pass">Senha</Label>
                    <Input id="signup-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
                  </div>
                  <div>
                    <Label htmlFor="signup-pass2">Confirme a senha</Label>
                    <Input id="signup-pass2" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <label className="flex items-start gap-2.5 text-xs leading-relaxed text-black/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                    />
                    <span>
                      Li e aceito os <Link to="/termos" className="font-bold text-blue-600 hover:underline">Termos de Uso</Link> e a{" "}
                      <Link to="/privacidade" className="font-bold text-blue-600 hover:underline">Política de Privacidade</Link>.
                    </span>
                  </label>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Criando conta..." : "Criar minha conta"}
                  </Button>
                </form>
              )}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-black/40">
          <Link to="/" className="hover:text-black">← voltar para a home</Link>
        </p>
      </div>
    </div>
  );
}
