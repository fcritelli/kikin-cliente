import { z } from "zod";

const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1, "DATABASE_URL (Postgres do portal) é obrigatória"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET deve ter ao menos 32 caracteres"),
  JWT_EXPIRES_IN: z.string().default("2h"),
  CLIENT_APP_URL: z.string().url().default("http://localhost:5174"),
  // Comunicação com a API interna do Kikin (ADR-002 — HMAC, padrão kikin-admin)
  KIKIN_API_URL: z.string().url().default("http://localhost:3000/internal/client-portal"),
  KIKIN_CLIENT_PORTAL_ID: z.string().default("client-portal"),
  KIKIN_CLIENT_PORTAL_SECRET: z.string().min(1, "KIKIN_CLIENT_PORTAL_SECRET obrigatória"),
  // Base da API PÚBLICA do Kikin (proxy do booking por slug — mesma usada pelo /agendar do Kikin)
  KIKIN_PUBLIC_URL: z.string().url().default("http://localhost:3000/api/v1"),
  // SMTP opcional para e-mails de verificação/reset
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Em dev/hml sem SMTP: retorna o token de verificação na resposta
  EMAIL_VERIFY_RETURN_TOKEN: z.string().default(isProd ? "false" : "true"),
  // OAuth social (Google/Microsoft). Código trocado server-side, padrão do Kikin.
  // Client IDs OAuth devem ter authorized redirect = OAUTH_REDIRECT_URI (default CLIENT_APP_URL + '/auth').
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().url().optional(),
  CORS_ORIGINS: z.string().optional(), // lista separada por vírgula; default CLIENT_APP_URL
  // ---- WhatsApp (estrutura plugável; 'log' em dev não envia de verdade) ----
  WHATSAPP_PROVIDER: z.string().default("log"), // 'log' | 'meta' | 'zapi'
  WHATSAPP_META_TOKEN: z.string().optional(),
  WHATSAPP_META_PHONE_ID: z.string().optional(),
  WHATSAPP_ZAPI_INSTANCE: z.string().optional(),
  WHATSAPP_ZAPI_TOKEN: z.string().optional(),
  // Dev/hml sem provedor: o código OTP retorna na resposta (igual e-mail/EMAIL_VERIFY_RETURN_TOKEN)
  WHATSAPP_DEV_RETURN_CODE: z.string().default(isProd ? "false" : "true"),
  // Chave AES-256-GCM para criptografar números em repouso (enviar mensagem exige o número;
  // LGPD: nunca texto plano no banco). Dev default; produção deve setar.
  WHATSAPP_PHONE_KEY: z.string().min(16).optional(),
});

function cleanTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // No boot, falha cedo com mensagens claras (não expor valores)
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  throw new Error("Config inválida do kikin-cliente/server:\n" + issues.join("\n"));
}

// URI de retorno única do OAuth (o botão do web redireciona para CLIENT_APP_URL + '/auth').
export const OAUTH_REDIRECT_URI =
  parsed.data.OAUTH_REDIRECT_URI || `${cleanTrailingSlash(parsed.data.CLIENT_APP_URL)}/auth`;

export const CORS_ORIGINS = (parsed.data.CORS_ORIGINS || parsed.data.CLIENT_APP_URL)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const config = parsed.data;
export type AppConfig = typeof config;
