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
  // SMTP opcional para e-mails de verificação/reset
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Em dev/hml sem SMTP: retorna o token de verificação na resposta
  EMAIL_VERIFY_RETURN_TOKEN: z.string().default(isProd ? "false" : "true"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // No boot, falha cedo com mensagens claras (não expor valores)
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  throw new Error("Config inválida do kikin-cliente/server:\n" + issues.join("\n"));
}

export const config = parsed.data;
export type AppConfig = typeof config;
