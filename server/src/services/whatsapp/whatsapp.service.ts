import crypto from "node:crypto";
import { config } from "../../config.js";
import { normalizePhoneBR } from "../../utils/phone.js";

/**
 * Comunicação por WhatsApp — estrutura plugável (estrutura/config; envio real depende do
 * provedor). Transportes: 'log' (dev — registra e não envia de verdade), 'meta' (WhatsApp
 * Cloud API) e 'zapi' (gateway BR). O código/OTP é gerado pelo gateway; o usuário o digita
 * no app (não precisamos de webhook de entrada nesta versão).
 *
 * LGPD: números só existem em memória (vindos do request ou decriptados na hora de enviar);
 * em repouso guardamos hash + máscara + valor criptografado (AES-256-GCM).
 */

export type WhatsAppProviderName = "log" | "meta" | "zapi";

export interface WhatsAppSendResult { ok: boolean; transport: WhatsAppProviderName; to: string; log?: string }

export function providerName(): WhatsAppProviderName {
  const p = (config.WHATSAPP_PROVIDER || "log").toLowerCase();
  return p === "meta" || p === "zapi" ? p : "log";
}

function phoneToWaId(raw: string): string {
  const digits = normalizePhoneBR(raw);
  return digits.startsWith("55") ? digits : `55${digits}`;
}

async function sendViaMeta(to: string, message: string): Promise<boolean> {
  if (!config.WHATSAPP_META_TOKEN || !config.WHATSAPP_META_PHONE_ID) {
    throw new Error("WHATSAPP_META_TOKEN/WHATSAPP_META_PHONE_ID não configurados.");
  }
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${config.WHATSAPP_META_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.WHATSAPP_META_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    }
  );
  if (!res.ok) throw new Error(`Meta WhatsApp respondeu ${res.status}: ${await res.text()}`);
  return true;
}

async function sendViaZapi(to: string, message: string): Promise<boolean> {
  if (!config.WHATSAPP_ZAPI_INSTANCE || !config.WHATSAPP_ZAPI_TOKEN) {
    throw new Error("WHATSAPP_ZAPI_INSTANCE/WHATSAPP_ZAPI_TOKEN não configurados.");
  }
  const res = await fetch(
    `https://api.z-api.io/instances/${config.WHATSAPP_ZAPI_INSTANCE}/token/${config.WHATSAPP_ZAPI_TOKEN}/send-text`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", clienttoken: config.WHATSAPP_ZAPI_TOKEN },
      body: JSON.stringify({ phone: phoneToWaId(to).slice(2), message }),
    }
  );
  if (!res.ok) throw new Error(`Z-API respondeu ${res.status}: ${await res.text()}`);
  return true;
}

/** Envia uma mensagem (tentativa). Falhas NUNCA quebram o fluxo de negócio. */
export async function sendWhatsApp(rawPhone: string, message: string): Promise<WhatsAppSendResult> {
  const to = phoneToWaId(rawPhone);
  const transport = providerName();
  try {
    if (transport === "meta") {
      await sendViaMeta(to, message);
    } else if (transport === "zapi") {
      await sendViaZapi(to, message);
    } else {
      console.log(`[WhatsApp:log] para ${to}:\n${message}`);
    }
    return { ok: true, transport, to, log: message.slice(0, 200) };
  } catch (err: any) {
    console.error("[WhatsApp] falha no envio:", err?.message || err);
    return { ok: false, transport, to };
  }
}

// ---------------- cifra (número em repouso) ----------------

function phoneKey(): Buffer {
  const raw = config.WHATSAPP_PHONE_KEY || "dev-whatsapp-phone-key-32bytes!";
  return crypto.createHash("sha256").update(raw).digest(); // 32 bytes
}

export function encryptPhone(rawPhone: string): string {
  const normalized = normalizePhoneBR(rawPhone);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", phoneKey(), iv);
  const enc = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptPhone(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", phoneKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
