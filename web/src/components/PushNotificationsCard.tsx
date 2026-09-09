import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  disablePush,
  enablePush,
  PushError,
  readPushState,
  type PushState,
} from "@/lib/push";

const CAPTION_ON =
  "Você receberá avisos de confirmação, cancelamento e remarcação de horários mesmo com a aba do portal fechada.";
const CAPTION_OFF =
  "Avisos no celular/desktop mesmo com a aba fechada. Tudo começa por um toque seu: o navegador pedirá a permissão.";

/**
 * Cartão "Receber no celular (push)" (área do cliente → Perfil).
 * Nunca pede permissão sozinho: só pela AÇÃO do usuário no botão Ativar.
 * Estados sem suporte (navegador/http sem localhost/gateway sem VAPID) não renderizam.
 */
export function PushNotificationsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    setState(await readPushState());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!state) return null; // lendo estado inicial
  if (state.kind === "unsupported" || state.kind === "unavailable" || state.kind === "server-disabled") {
    return null; // recurso não disponível neste navegador/contexto/servidor
  }

  const run = async (action: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ text: okMsg, ok: true });
    } catch (err) {
      setFeedback({
        text: err instanceof PushError ? err.message : "Não foi possível concluir. Tente novamente.",
        ok: false,
      });
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const on = state.kind === "on";
  const denied = state.kind === "denied";

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">Receber no celular (push)</p>
      <p className="mt-1 text-sm leading-relaxed text-black/60">{denied ? "As notificações estão bloqueadas no navegador." : on ? CAPTION_ON : CAPTION_OFF}</p>

      {denied ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-black/50">
            Para ativar, libere a permissão de notificações para este site (cadeado na barra de
            endereço → “Notificações”) e volte aqui.
          </p>
          <div className="mt-3">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
              Verificar de novo
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span
            className={
              "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider " +
              (on ? "border-green-600/30 bg-green-50 text-green-700" : "border-black/15 bg-black/[0.03] text-black/50")
            }
          >
            {on ? "Ativado" : "Desativado"}
          </span>
          <Button
            size="sm"
            variant={on ? "outline" : "primary"}
            disabled={busy}
            onClick={() => (on ? void run(disablePush, "Notificações desativadas.") : void run(enablePush, "Pronto! Você passará a receber os avisos por aqui."))}
          >
            {busy ? "Aguarde…" : on ? "Desativar" : "Ativar"}
          </Button>
        </div>
      )}

      {feedback && (
        <p className={"mt-3 rounded-lg px-3 py-2 text-xs font-medium " + (feedback.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
          {feedback.text}
        </p>
      )}
    </section>
  );
}
