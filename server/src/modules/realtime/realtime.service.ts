import { config } from "../../config.js";
import { buildSignature } from "../kikin/kikin-client.js";

/**
 * Relay de eventos em tempo real do Kikin para a área do cliente.
 *
 * O Kikin (fonte da verdade) publica eventos de agenda por salão. Este módulo
 * mantém UMA conexão SSE autenticada (HMAC de serviço — ADR-002) com o stream
 * interno do Kikin e repassa os eventos a um hub local. As rotas SSE do gateway
 * filtram por salão antes de entregar ao navegador do cliente.
 *
 * Os eventos carregam apenas metadados (nunca token de hold, telefone etc.);
 * quem recebe refaz a leitura na fonte.
 */

export interface RealtimeEvent {
  type: string;
  salonId: string;
  ts: string;
  appointmentId?: string | null;
  groupId?: string | null;
  staffId?: string | null;
  clientId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status?: string | null;
}

type EventListener = (event: RealtimeEvent) => void;

const listeners = new Set<EventListener>();

export function subscribeRealtimeEvents(listener: EventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function dispatch(event: RealtimeEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error("[realtime] Erro no listener:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Consumidor upstream (SSE do Kikin)
// ---------------------------------------------------------------------------

const RETRY_MS = 3000;
let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;

function baseUrl(): string {
  return (config.KIKIN_API_URL || "http://localhost:3000/internal/client-portal").replace(/\/$/, "");
}

async function connectUpstream() {
  try {
  if (stopped || controller) return;

  const { headers } = buildSignature({ method: "GET", path: "/events", scope: { salonIds: [] } });
  const url = `${baseUrl()}/events`;
  const localController = new AbortController();
  controller = localController;
  stopped = false;

  try {
    const res = await fetch(url, {
      headers: { ...headers, Accept: "text/event-stream" },
      signal: localController.signal,
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      console.error(`[realtime] Kikin respondeu ${res.status} no stream de eventos; nova tentativa em ${RETRY_MS}ms`);
      controller = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connectUpstream, RETRY_MS);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of raw.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as RealtimeEvent;
              if (event && typeof event.salonId === "string" && typeof event.type === "string") {
                dispatch(event);
              }
            } catch {
              // payload não-JSON (ex.: comentário) — ignora
            }
            break;
          }
        }
      }
    }

    // Fim natural da stream (sem abort manual): reconecta.
    if (!localController.signal.aborted) {
      console.warn("[realtime] Stream do Kikin encerrou; reconectando…");
      controller = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connectUpstream, RETRY_MS);
    }
  } catch (err: any) {
    if (!localController.signal.aborted) {
      console.warn("[realtime] Falha na conexão com o Kikin:", err?.message || err);
      controller = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connectUpstream, RETRY_MS);
    }
  }
  } catch (err2: any) {
    console.error("[realtime] Erro inesperado no stream upstream:", err2?.message || err2);
  }
}

/** Inicia o relay (idempotente). Chamado no boot do servidor. */
export function startRealtimeRelay(): void {
  if (!stopped || controller) return;
  stopped = false;
  void connectUpstream();
}

/** Para o relay (testes / shutdown). */
export function stopRealtimeRelay(): void {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  controller?.abort();
  controller = null;
}
