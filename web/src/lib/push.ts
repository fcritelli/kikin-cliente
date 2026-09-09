import { getAccessToken } from "@/lib/api";

/**
 * Web Push do portal — util do navegador (kikin-cliente web).
 *
 * Fluxo 100% por AÇÃO do usuário (botão "Receber no celular" na área do cliente):
 *   1. registra o service worker (/sw.js) — só em contexto seguro (https ou localhost);
 *   2. busca a chave pública VAPID no gateway (GET /api/v1/push/public-key);
 *   3. pede permissão (Notification.requestPermission) e assina (PushManager.subscribe);
 *   4. grava a inscrição no gateway (POST /api/v1/push/subscribe).
 * Desativar = DELETE da inscrição + unsubscribe local. Tudo fail-soft: falha nunca deixa
 * o restante do app quebrado — erros viram PushError com mensagem amigável.
 *
 * O gateway responde 503 PUSH_NOT_CONFIGURED quando VAPID não está configurado → aqui o
 * estado vira "server-disabled" e a UI não oferece o controle.
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:3100/api/v1";
const SW_PATH = "/sw.js";
const SW_SCOPE = "/";
const ENABLED_KEY = "kc_push_enabled";

export class PushError extends Error {}

export type PushState =
  | { kind: "unsupported" } // navegador sem Push API/Service Worker/Notification
  | { kind: "unavailable" } // contexto não seguro (http fora do localhost)
  | { kind: "server-disabled" } // gateway sem VAPID (503)
  | { kind: "denied" } // permissão bloqueada no navegador
  | { kind: "off" } // pode ativar (permissão pendente ou sem inscrição)
  | { kind: "on" }; // ativo

function browserSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function secureContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return window.location.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
}

async function fetchPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/push/public-key`, { cache: "no-store" });
    if (!res.ok) return null; // 503 PUSH_NOT_CONFIGURED etc.
    const data = await res.json();
    return typeof data?.publicKey === "string" ? data.publicKey : null;
  } catch {
    return null; // rede fora — assume desabilitado por ora (fail-soft)
  }
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
    // Garante um SW ativo antes de assinar (skipWaiting no sw.js já ativa rápido).
    if (!reg.active) await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Estado atual do recurso, para a UI decidir o que mostrar.
 * Não pede permissão nem registra nada — só leitura.
 */
export async function readPushState(): Promise<PushState> {
  if (!browserSupported()) return { kind: "unsupported" };
  if (!secureContext()) return { kind: "unavailable" };
  if (Notification.permission === "denied") return { kind: "denied" };
  const publicKey = await fetchPublicKey();
  if (!publicKey) return { kind: "server-disabled" };
  let hasSubscription = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    hasSubscription = Boolean(sub);
  } catch {
    hasSubscription = false;
  }
  const flagged = localStorage.getItem(ENABLED_KEY) === "1";
  if (Notification.permission === "granted" && hasSubscription && flagged) return { kind: "on" };
  return { kind: "off" };
}

/**
 * Ativa (ação do usuário): registra o SW, pede permissão, assina e grava no gateway.
 * Lança PushError com mensagem amigável em qualquer falha — nunca derruba a UI.
 */
export async function enablePush(): Promise<void> {
  if (!browserSupported()) throw new PushError("Seu navegador não suporta notificações push.");
  if (!secureContext()) {
    throw new PushError("Notificações exigem conexão segura (https) ou localhost.");
  }
  if (Notification.permission === "denied") {
    throw new PushError("As notificações estão bloqueadas nas configurações do navegador. Libere a permissão e tente de novo.");
  }
  const publicKey = await fetchPublicKey();
  if (!publicKey) {
    throw new PushError("As notificações ainda não estão disponíveis para o seu cadastro. Tente novamente mais tarde.");
  }
  const reg = await registerServiceWorker();
  if (!reg) {
    throw new PushError("Não foi possível preparar as notificações neste navegador.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushError("Permissão de notificações não concedida. Você pode ativar de novo quando quiser.");
  }
  let subscription = await reg.pushManager.getSubscription().catch(() => null);
  if (!subscription) {
    subscription = await reg.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
      .catch(() => null);
  }
  if (!subscription) {
    throw new PushError("Não foi possível assinar o serviço de notificações. Tente novamente.");
  }
  const json = subscription.toJSON();
  const res = await fetch(`${API_URL}/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    let code = "";
    try {
      code = (await res.json())?.code || "";
    } catch {
      /* corpo não-JSON */
    }
    if (res.status === 401 || res.status === 403) {
      throw new PushError("Sua sessão expirou. Entre de novo e reative as notificações.");
    }
    if (res.status === 503 && code === "PUSH_NOT_CONFIGURED") {
      throw new PushError("As notificações ainda não estão disponíveis para o seu cadastro. Tente novamente mais tarde.");
    }
    throw new PushError("Não foi possível ativar as notificações. Tente novamente.");
  }
  localStorage.setItem(ENABLED_KEY, "1");
}

/** Desativa (ação do usuário): remove do gateway e cancela a assinatura local. Fail-soft. */
export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE).catch(() => null);
    const subscription = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
    if (subscription) {
      const endpoint = subscription.endpoint;
      try {
        await fetch(`${API_URL}/push/subscribe`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ endpoint }),
        });
      } catch {
        // falha de rede no DELETE: segue — remove a assinatura local mesmo assim
      }
      await subscription.unsubscribe().catch(() => undefined);
    }
  } finally {
    localStorage.removeItem(ENABLED_KEY);
  }
}
