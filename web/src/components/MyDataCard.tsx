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
 * SEM SENHA E SEM WHATSAPP (conta Google/Microsoft): não há prova nenhuma, então a UI conduz o
 * titular a CONFIRMAR um WhatsApp agora (código enviado para o número informado) e só depois
 * pede a palavra EXCLUIR — o OTP de exclusão vai para o número recém-confirmado. Só se nem isso
 * for possível é que aparece o caminho do suporte: o titular não pode depender de terceiros para
 * exercer o Art. 18, IV/VI.
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

  // Conta sem senha e sem WhatsApp (Google/Microsoft): confirmar um número agora é o caminho
  // de prova. `proofUnavailable` só aparece se, depois de confirmar, ainda não houver prova —
  // aí sim o titular é encaminhado ao suporte.
  const [needsWhatsapp, setNeedsWhatsapp] = useState(false);
  const [proofUnavailable, setProofUnavailable] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [waCode, setWaCode] = useState("");
  const [waSent, setWaSent] = useState(false);
  const [waMask, setWaMask] = useState<string | null>(null);
  const [waDevCode, setWaDevCode] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waMsg, setWaMsg] = useState<string | null>(null);

  const confirmWord = challenge?.confirmWord || "EXCLUIR";
  const confirmOk = confirmText.trim().toUpperCase() === confirmWord;
  const proofOk =
    challenge?.method === "password" ? password.length > 0 : otpCode.replace(/\D/g, "").length === 6;
  const canDelete = !!challenge && !needsWhatsapp && confirmOk && proofOk && !busy;

  /** Conta sem prova: em vez de erro, abre o passo de confirmar o WhatsApp. */
  function isNeedsWhatsapp(err: unknown): boolean {
    return err instanceof ApiError && err.code === "PROOF_UNAVAILABLE" && err.reason() === "NEEDS_WHATSAPP";
  }

  /** Pede o desafio de exclusão; devolve null quando a conta ainda não tem prova. */
  const fetchChallenge = async (sendCode: boolean): Promise<DeletionChallenge | null> => {
    try {
      return await api.deleteAccountRequest(sendCode);
    } catch (err) {
      if (isNeedsWhatsapp(err)) return null;
      throw err;
    }
  };

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
    setNeedsWhatsapp(false);
    setProofUnavailable(false);
    setWaPhone("");
    setWaCode("");
    setWaSent(false);
    setWaMask(null);
    setWaDevCode(null);
    setWaMsg(null);
    fetchChallenge(false)
      .then((c) => {
        if (cancelled) return;
        if (c) setChallenge(c);
        else setNeedsWhatsapp(true); // conta sem senha e sem WhatsApp: confirmar o número agora
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
      const c = await fetchChallenge(true);
      if (c) {
        setChallenge(c);
        setCodeSent(true);
      } else {
        // A prova sumiu entre a abertura do modal e o clique: volta ao caminho do WhatsApp.
        setChallenge(null);
        setNeedsWhatsapp(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível enviar o código agora.");
    } finally {
      setSendingCode(false);
    }
  };

  /** Passo 1 do caminho "sem prova": envia o código para o número informado. */
  const sendWhatsappConfirmation = async () => {
    if (waPhone.replace(/\D/g, "").length < 10) {
      setError("Informe um WhatsApp com DDD válido.");
      return;
    }
    setWaBusy(true);
    setError(null);
    try {
      const res = await api.confirmWhatsappRequest(waPhone);
      setWaSent(true);
      setWaMask(res.masked);
      setWaDevCode(res.devCode ?? null);
      setWaMsg(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível enviar o código agora.");
    } finally {
      setWaBusy(false);
    }
  };

  /**
   * Passo 2: confere o código. Confirmado o número, a conta passa a ter prova por OTP e o
   * modal segue para o desafio de exclusão (aí sim com a palavra EXCLUIR).
   */
  const confirmWhatsapp = async () => {
    if (waCode.replace(/\D/g, "").length !== 6) {
      setError("Informe o código de 6 dígitos enviado por WhatsApp.");
      return;
    }
    setWaBusy(true);
    setError(null);
    try {
      await api.confirmWhatsapp(waPhone, waCode.replace(/\D/g, ""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível confirmar este WhatsApp agora.");
      setWaBusy(false);
      return;
    }
    setWaBusy(false);

    // Número confirmado: a conta já tem prova. Buscamos o desafio de exclusão (sem enviar o
    // código ainda — o titular clica em "Enviar código no WhatsApp" quando quiser).
    let c: DeletionChallenge | null = null;
    try {
      c = await fetchChallenge(false);
    } catch {
      c = null;
    }
    setNeedsWhatsapp(false);
    setWaSent(false);
    setWaCode("");
    if (c) {
      setChallenge(c);
      setCodeSent(false);
      setWaMsg(`WhatsApp confirmado: ${c.whatsappMask || waMask || "número informado"}.`);
    } else {
      // Confirmou o número e ainda assim não há prova: agora sim o suporte.
      setProofUnavailable(true);
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

            {/* Conta sem senha e sem WhatsApp (Google/Microsoft): confirmar o número agora é o
                caminho do titular — não o suporte. Só depois disso pedimos a palavra EXCLUIR. */}
            {needsWhatsapp && (
              <div className="mt-4 rounded-xl border border-blue-600/20 bg-blue-50/60 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wider text-black/50">
                  1. Confirme seu WhatsApp agora
                </p>
                <p className="mt-1 text-xs leading-relaxed text-black/70">
                  Sua conta entrou por <b>Google/Microsoft</b>, então não tem senha nem WhatsApp
                  cadastrado. Para excluir a conta você mesmo, informe um número e confirme o
                  código que enviaremos para ele — o código de exclusão vai para esse mesmo número.
                </p>
                <Input
                  className="mt-2"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-label="Seu WhatsApp com DDD"
                  placeholder="(11) 98888-7777"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                  disabled={waSent}
                />
                {!waSent ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={waBusy}
                    onClick={() => void sendWhatsappConfirmation()}
                  >
                    {waBusy ? "Enviando…" : "Enviar código no WhatsApp"}
                  </Button>
                ) : (
                  <>
                    <p className="mt-2 text-xs text-black/60">
                      Enviamos um código de 6 dígitos para <b>{waMask || "seu WhatsApp"}</b>.
                    </p>
                    <Input
                      className="mt-2 tracking-[0.4em]"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={waCode}
                      onChange={(e) => setWaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                    {waDevCode && (
                      <p className="mt-1 text-xs text-black/40">Ambiente de teste — código: {waDevCode}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button size="sm" disabled={waBusy} onClick={() => void confirmWhatsapp()}>
                        {waBusy ? "Confirmando…" : "Confirmar número"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => void sendWhatsappConfirmation()}
                        disabled={waBusy}
                        className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                      >
                        {waBusy ? "Reenviando…" : "Reenviar código"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWaSent(false);
                          setWaCode("");
                          setError(null);
                        }}
                        disabled={waBusy}
                        className="text-xs font-bold text-black/50 hover:underline cursor-pointer"
                      >
                        Trocar o número
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {proofUnavailable && (
              <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm leading-relaxed text-black/70">
                Não conseguimos confirmar nenhum número para provar sua identidade agora. Sua conta
                <b> não foi excluída</b>. Fale com o <b>suporte do kikin</b> para concluir a
                exclusão da área do cliente.
              </p>
            )}

            {waMsg && (
              <p className="mt-4 rounded-xl border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
                {waMsg}
              </p>
            )}

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

            {/* A palavra EXCLUIR só é pedida quando existe prova de identidade disponível. */}
            {challenge && (
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
            )}

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
