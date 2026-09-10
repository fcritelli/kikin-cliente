import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import {
  api,
  ApiError,
  saveBlob,
  type DeletionChallenge,
} from "@/lib/api";

/**
 * Card "Meus dados (LGPD)" do Perfil (Art. 18 da LGPD):
 *  - Baixar meus dados → JSON do que o PORTAL guarda (download autenticado);
 *  - Excluir minha conta → modal com prova de identidade (senha OU código do WhatsApp) +
 *    digitar EXCLUIR.
 *
 * ESCOPO (importante e explícito na UI): a exclusão apaga SOMENTE a conta da área do cliente.
 * O cadastro do cliente e os agendamentos nos estabelecimentos NÃO são tocados — esses dados
 * são do salão; para removê-los lá o titular fala com o estabelecimento.
 */

export interface LinkedSalonRef {
  id: string;
  name: string;
  phone?: string | null;
}

function waLinkFor(phone?: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (!/^55\d{10,13}$/.test(d) && (d.length === 10 || d.length === 11)) d = "55" + d;
  return d && d.length >= 12 ? `https://wa.me/${d}` : null;
}

export function MyDataCard({ linkedSalons = [] }: { linkedSalons?: LinkedSalonRef[] }) {
  const { logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [challenge, setChallenge] = useState<DeletionChallenge | null>(null);
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmWord = challenge?.confirmWord || "EXCLUIR";
  const confirmOk = confirmText.trim().toUpperCase() === confirmWord;
  const proofOk =
    challenge?.method === "password" ? password.length > 0 : otpCode.replace(/\D/g, "").length === 6;
  const canDelete = !!challenge && confirmOk && proofOk && !busy;

  // Ao abrir o modal, descobrimos QUAL prova a conta exige (sem enviar mensagem ainda).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingChallenge(true);
    setError(null);
    setChallenge(null);
    setPassword("");
    setOtpCode("");
    setConfirmText("");
    setCodeSent(false);
    api
      .deleteAccountRequest(false)
      .then((c) => {
        if (!cancelled) setChallenge(c);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Não foi possível iniciar a exclusão.");
      })
      .finally(() => {
        if (!cancelled) setLoadingChallenge(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const downloadMyData = async () => {
    setExporting(true);
    setExportErr(null);
    setExportMsg(null);
    try {
      const { blob, filename } = await api.exportMyData();
      saveBlob(blob, filename);
      setExportMsg("Arquivo gerado. Confira a pasta de downloads do seu navegador.");
    } catch (err) {
      setExportErr(err instanceof ApiError ? err.message : "Não foi possível baixar seus dados agora.");
    } finally {
      setExporting(false);
    }
  };

  const sendCode = async () => {
    setSendingCode(true);
    setError(null);
    try {
      const c = await api.deleteAccountRequest(true);
      setChallenge(c);
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível enviar o código agora.");
    } finally {
      setSendingCode(false);
    }
  };

  const confirmDelete = async () => {
    if (!challenge || !canDelete) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount({
        confirm: confirmText.trim().toUpperCase(),
        ...(challenge.method === "password" ? { password } : { otpCode: otpCode.replace(/\D/g, "") }),
      });
      // A conta não existe mais: encerra a sessão local (e revoga o refresh, se ainda existir)
      // e volta para a home com o aviso de exclusão.
      await logout().catch(() => undefined);
      window.location.href = "/?conta=excluida";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível excluir sua conta agora.");
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">Meus dados (LGPD)</p>
      <p className="mt-2 text-sm leading-relaxed text-black/70">
        Guardamos o essencial para você entrar e agendar: <b>nome</b>, <b>e-mail</b> e, se você
        informar, seu <b>WhatsApp</b> (só em versão criptografada + máscara), além dos seus{" "}
        <b>vínculos com estabelecimentos</b>, das suas <b>preferências de aviso</b> e dos{" "}
        <b>agendamentos</b> que o portal consegue ler no kikin. Você pode baixar tudo isso ou
        excluir sua conta quando quiser.
      </p>

      {exportMsg && (
        <p className="mt-3 rounded-xl border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {exportMsg}
        </p>
      )}
      {exportErr && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {exportErr}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={exporting} onClick={() => void downloadMyData()}>
          {exporting ? "Gerando arquivo…" : "⬇ Baixar meus dados"}
        </Button>
        <Button
          size="sm"
          className="!bg-red-600 hover:!bg-red-700"
          onClick={() => setOpen(true)}
        >
          Excluir minha conta
        </Button>
      </div>
      <p className="mt-2 text-xs text-black/50">
        O download sai em JSON (arquivo aberto, texto legível). Consulte também nossa{" "}
        <a href="/privacidade" className="font-bold text-blue-600 hover:underline">Política de Privacidade</a>.
      </p>

      {/* ---------------------------------------------------------------- modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white p-5 sm:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <h3 className="text-lg font-black uppercase tracking-tight">Excluir minha conta?</h3>
            <p className="mt-2 text-sm text-black/60">
              Esta ação é definitiva e encerra sua conta na <b>área do cliente kikin</b>.
            </p>

            <div className="mt-4 rounded-xl bg-black/[0.03] px-4 py-3 text-xs leading-relaxed text-black/70">
              <p className="font-bold uppercase tracking-wider text-black/50">O que será apagado</p>
              <ul className="mt-1.5 grid gap-1">
                <li>• Sua conta do portal (nome, e-mail e WhatsApp cadastrados)</li>
                <li>• Seus vínculos e consentimentos com os estabelecimentos</li>
                <li>• Suas sessões (você sai de todos os aparelhos) e notificações push</li>
              </ul>
              <p className="mt-3 font-bold uppercase tracking-wider text-black/50">O que PERMANECE</p>
              <p className="mt-1.5">
                Seu <b>cadastro e seus agendamentos nos salões, barbearias e clínicas continuam
                intactos</b> — esses dados pertencem ao estabelecimento e não são alterados por
                aqui. Para remover ou alterar o que o salão guarda, fale diretamente com o
                estabelecimento.
              </p>
              {linkedSalons.length > 0 && (
                <ul className="mt-2 grid gap-1">
                  {linkedSalons.map((s) => {
                    const wa = waLinkFor(s.phone);
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-2">
                        <span>• {s.name}</span>
                        {wa && (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-green-700 hover:underline"
                          >
                            falar no WhatsApp
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {loadingChallenge && <p className="mt-4 text-sm text-black/50">Verificando como confirmar sua identidade…</p>}

            {challenge?.method === "password" && (
              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-wider text-black/50">
                  1. Confirme sua senha
                </p>
                <Input
                  className="mt-2"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Sua senha de login"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            {challenge?.method === "whatsapp_otp" && (
              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-wider text-black/50">
                  1. Confirme com o código do WhatsApp
                </p>
                <p className="mt-1 text-xs text-black/60">
                  Enviaremos um código de 6 dígitos para o seu número cadastrado{" "}
                  <b>{challenge.whatsappMask || ""}</b>.
                </p>
                {!codeSent ? (
                  <Button size="sm" variant="outline" className="mt-2" disabled={sendingCode} onClick={() => void sendCode()}>
                    {sendingCode ? "Enviando…" : "Enviar código no WhatsApp"}
                  </Button>
                ) : (
                  <>
                    <Input
                      className="mt-2 tracking-[0.4em]"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                    <button
                      type="button"
                      onClick={() => void sendCode()}
                      disabled={sendingCode}
                      className="mt-2 text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                    >
                      {sendingCode ? "Reenviando…" : "Reenviar código"}
                    </button>
                    {challenge.devCode && (
                      <p className="mt-1 text-xs text-black/40">Ambiente de teste — código: {challenge.devCode}</p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-black/50">
                2. Digite <span className="font-mono text-red-600">{confirmWord}</span> para confirmar
              </p>
              <Input
                className="mt-2 font-mono uppercase"
                placeholder={confirmWord}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </div>

            {error && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </p>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                className="!bg-red-600 hover:!bg-red-700"
                disabled={!canDelete}
                onClick={() => void confirmDelete()}
              >
                {busy ? "Excluindo…" : "Excluir minha conta"}
              </Button>
            </div>
            {!canDelete && !busy && !!challenge && (
              <p className="mt-2 text-center text-xs text-black/40">
                Preencha a confirmação de identidade e a palavra {confirmWord} para liberar o botão.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
