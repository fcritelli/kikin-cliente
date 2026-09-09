import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Cadastro/login pelo WhatsApp (OTP): digita o número → enviamos o código por WhatsApp →
 * confirma. Conta inexistente → 1º acesso pede nome + termos (+ e-mail opcional) e já
 * vincula os cadastros existentes do número. Em dev sem provedor, o código aparece na tela.
 */
function consumeNext(): string {
  const raw = sessionStorage.getItem("kc_next");
  sessionStorage.removeItem("kc_next");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/conta";
}

export function WhatsAppAuthPanel() {
  const navigate = useNavigate();
  const { applySession } = useAuth();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"phone" | "code" | "register">("phone");
  const [phone, setPhone] = useState("");
  const [masked, setMasked] = useState("");
  const [devCode, setDevCode] = useState("");
  const [code, setCode] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setStep("phone");
    setError(null);
    setCode("");
    setDevCode("");
    setTempToken("");
  };

  const requestCode = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 10) return setError("Informe um WhatsApp com DDD válido.");
    setError(null);
    setBusy(true);
    try {
      const res = await api.whatsappRequest(phone);
      setMasked(res.masked);
      setDevCode(res.devCode || "");
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível enviar o código.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) return setError("Digite o código de 6 dígitos.");
    setError(null);
    setBusy(true);
    try {
      const out = await api.whatsappVerify(phone, code);
      if (out.status === "LOGIN") {
        const me = await applySession(out.tokens);
        navigate(me ? consumeNext() : "/login", { replace: true });
        return;
      }
      setTempToken(out.tempToken);
      setStep("register");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Código inválido.");
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (fullName.trim().length < 2) return setError("Informe seu nome.");
    if (!consent) return setError("É necessário aceitar os termos e a política de privacidade.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("E-mail inválido.");
    setError(null);
    setBusy(true);
    try {
      const res = await api.whatsappRegister({ tempToken, fullName: fullName.trim(), consent, email: email.trim() || null });
      const me = await applySession(res.tokens);
      navigate(me ? consumeNext() : "/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao criar a conta.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setStep("phone"); setError(null); }}
          className="w-full h-11 px-4 border border-green-600/40 bg-green-50 hover:bg-green-100 text-green-800 font-semibold text-sm rounded-xl flex items-center justify-center gap-3 transition-all cursor-pointer"
        >
          <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4 0-.5.2-.7l.5-.6c.1-.2.2-.3.1-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.9.9-1.2 2.1-.6 3.4a11.5 11.5 0 0 0 4.5 4.5c1.3.6 2.5.4 3.4-.5.2-.2.3-.5.4-.7v-.5c0-.2-.1-.3-.3-.4Z" />
          </svg>
          Entrar com o WhatsApp
        </button>
      ) : (
        <div className="rounded-xl border border-green-600/30 bg-green-50/40 p-4">
          {step === "phone" && (
            <div className="grid gap-3">
              <p className="text-xs text-black/60">Informe seu WhatsApp — enviaremos um código para confirmar.</p>
              <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98765-4321" autoFocus />
              {error && <p className="text-xs font-medium text-red-600">{error}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={reset}>Cancelar</Button>
                <Button disabled={busy} onClick={requestCode}>{busy ? "Enviando…" : "Enviar código"}</Button>
              </div>
            </div>
          )}

          {step === "code" && (
            <div className="grid gap-3">
              <p className="text-xs text-black/60">
                Enviamos um código para <b>{masked}</b>. Digite abaixo:
              </p>
              <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus />
              {devCode && (
                <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800">
                  Ambiente de desenvolvimento (sem provedor de WhatsApp): código = <b>{devCode}</b>
                </p>
              )}
              {error && <p className="text-xs font-medium text-red-600">{error}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setStep("phone")}>Voltar</Button>
                <Button disabled={busy} onClick={verifyCode}>{busy ? "Confirmando…" : "Confirmar código"}</Button>
              </div>
            </div>
          )}

          {step === "register" && (
            <div className="grid gap-3">
              <p className="text-xs font-bold text-black/70">Quase lá — complete seu cadastro</p>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" />
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail (opcional)" />
              <label className="flex items-start gap-2.5 text-xs text-black/60 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-600" />
                <span>
                  Li e aceito os <Link to="/termos" className="font-bold text-green-700 hover:underline">Termos de Uso</Link> e a{" "}
                  <Link to="/privacidade" className="font-bold text-green-700 hover:underline">Política de Privacidade</Link>.
                </span>
              </label>
              {error && <p className="text-xs font-medium text-red-600">{error}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={reset}>Cancelar</Button>
                <Button disabled={busy} onClick={register}>{busy ? "Criando…" : "Criar minha conta"}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
