import type { Request } from "express";
import rateLimit from "express-rate-limit";

export function clientIp(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function shouldSkip(_req: Request): boolean {
  return process.env.NODE_ENV === "test";
}

function make(options: {
  windowMs: number;
  max: number;
  message: { error: string; code: string };
  keyOf?: (req: Request) => string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: options.message,
    keyGenerator: (req) => options.keyOf ? options.keyOf(req) : clientIp(req),
    skip: shouldSkip,
  });
}

export const globalApiLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: "Limite de requisições excedido. Tente novamente em instantes.", code: "RATE_LIMITED" },
});

export const signupLimiter = make({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Limite de criação de contas atingido. Tente mais tarde.", code: "RATE_LIMITED" },
});

export const loginLimiter = make({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: "Muitas tentativas de login. Aguarde 1 minuto.", code: "RATE_LIMITED" },
});

export const emailTokenLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Muitos e-mails solicitados. Aguarde 15 minutos.", code: "RATE_LIMITED" },
});

export const publicBookingLimiter = make({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: { error: "Muitas tentativas de agendamento. Aguarde alguns minutos.", code: "RATE_LIMITED" },
});

/**
 * LGPD Art. 18 — exportação dos dados (operação pesada: banco + endpoints internos do Kikin).
 * Limite por CONTA, no mesmo espírito do /export-data do Kikin.
 */
export const lgpdExportLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Limite de exportações atingido. Aguarde 15 minutos.", code: "RATE_LIMITED" },
  keyOf: (req) => {
    const id = (req as any).account?.accountId;
    return id ? `user:${id}` : `ip:${clientIp(req)}`;
  },
});

/** LGPD Art. 18 — exclusão de conta: janela curta e poucas tentativas (prova de identidade). */
export const lgpdDeleteLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Limite de tentativas de exclusão. Aguarde 15 minutos.", code: "RATE_LIMITED" },
  keyOf: (req) => {
    const id = (req as any).account?.accountId;
    return id ? `user:${id}` : `ip:${clientIp(req)}`;
  },
});

/**
 * LGPD Art. 18 — confirmar/conferir o WhatsApp da conta logada (envia código por WhatsApp).
 * Limite PRÓPRIO, por conta: quem entrou por Google/Microsoft precisa confirmar um número ANTES
 * de pedir a exclusão; dividir o orçamento de `lgpdDeleteLimiter` faria o titular bater no limite
 * justamente no último passo (o DELETE) e ficar sem conseguir excluir a própria conta.
 */
export const lgpdWhatsappConfirmLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Limite de confirmações de WhatsApp atingido. Aguarde 15 minutos.", code: "RATE_LIMITED" },
  keyOf: (req) => {
    const id = (req as any).account?.accountId;
    return id ? `user:${id}` : `ip:${clientIp(req)}`;
  },
});

export const perUserLimiter = make({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Muitas requisições. Aguarde um instante.", code: "RATE_LIMITED" },
  keyOf: (req) => {
    const id = (req as any).account?.accountId;
    return id ? `user:${id}` : `ip:${clientIp(req)}`;
  },
});
