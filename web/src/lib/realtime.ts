import { getAccessToken } from "@/lib/api";

/**
 * Cliente SSE do portal (via fetch, com Authorization).
 *
 * Assina /api/v1/realtime/events do gateway, que já entrega apenas eventos dos
 * salões vinculados à conta. Conexão única por aba (singleton): componentes
 * registram listeners e recebem os eventos já tipados.
 */

export interface RealtimeSalonEvent {
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

type Listener = (event: RealtimeSalonEvent) => void;

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:3100/api/v1";
const RETRY_MS = 3000;

const listeners = new Set<Listener>();

let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let connectedToken: string | null = null;
let stopped = true;

function dispatch(event: RealtimeSalonEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // listener com erro não derruba os demais
    }
  }
}

async function connect() {
  if (!stopped || controller) return;
  const token = getAccessToken();
  if (!token) return;

  const localController = new AbortController();
  controller = localController;
  connectedToken = token;

  try {
    const res = await fetch(`${API_URL}/realtime/events`, {
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
      signal: localController.signal,
      cache: "no-store",
    });

    if (!res.ok || !res.body) {
      if (res.status === 401 || res.status === 403) {
        // Sessão inválida: quem cuida do fluxo de auth redireciona/loga de novo.
        teardown();
        return;
      }
      throw new Error(`HTTP ${res.status}`);
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
              const ev = JSON.parse(line.slice(6)) as RealtimeSalonEvent;
              if (ev && typeof ev.salonId === "string" && typeof ev.type === "string") {
                dispatch(ev);
              }
            } catch {
              // ignora
            }
            break;
          }
        }
      }
    }

    if (!localController.signal.aborted) {
      controller = null;
      scheduleRetry();
    }
  } catch {
    if (!localController.signal.aborted && getAccessToken()) {
      controller = null;
      scheduleRetry();
    }
  }
}

function scheduleRetry() {
  if (stopped) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, RETRY_MS);
}

function ensureConnected() {
  if (!getAccessToken()) return;
  if (controller && connectedToken === getAccessToken()) return;
  teardown();
  stopped = false;
  void connect();
}

function teardown() {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  controller?.abort();
  controller = null;
  connectedToken = null;
}

/** Assina os eventos do portal; retorna função para cancelar. */
export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  ensureConnected();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) teardown();
  };
}

/** Fecha a conexão (logout, troca de conta). */
export function disconnectRealtime() {
  teardown();
}
