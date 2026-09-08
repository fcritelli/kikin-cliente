import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import {
  signupLimiter,
  loginLimiter,
  emailTokenLimiter,
  perUserLimiter,
} from "../../middleware/rate-limit.js";
import * as accounts from "./accounts.service.js";
import * as social from "./social.service.js";

const router = Router();

function clientIpOf(req: any): string | null {
  const ip = (req.ip as string) || req.socket?.remoteAddress || null;
  return ip;
}

const signupSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "A senha deve ter no mínimo 8 caracteres"),
  fullName: z.string().min(2, "Informe seu nome"),
  consent: z.boolean().refine((v) => v === true, "Consentimento obrigatório"),
});

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

const tokenBodySchema = z.object({
  token: z.string().min(10),
});

const emailSchema = z.object({ email: z.string().email("E-mail inválido") });

router.post("/signup", signupLimiter, async (req, res) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const result = await accounts.signup(parsed.data);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

router.post("/verify-email", emailTokenLimiter, async (req, res) => {
  try {
    const parsed = tokenBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", error: "Token obrigatório" });
    }
    await accounts.verifyEmail(parsed.data.token);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

router.post("/resend-verification", emailTokenLimiter, async (req, res) => {
  try {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const token = await accounts.resendVerification(parsed.data.email);
    return res.json({ ok: true, ...(token ? { verificationToken: token } : {}) });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

router.post("/forgot-password", emailTokenLimiter, async (req, res) => {
  try {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const token = await accounts.requestPasswordReset(parsed.data.email);
    return res.json({ ok: true, ...(token ? { resetToken: token } : {}) });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

router.post("/reset-password", emailTokenLimiter, async (req, res) => {
  try {
    const parsed = z.object({ token: z.string().min(10), password: z.string().min(8) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", error: "Token e senha (mín. 8) são obrigatórios" });
    }
    await accounts.resetPassword(parsed.data.token, parsed.data.password);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

const socialCodeSchema = z.object({
  code: z.string().min(1, "Código OAuth obrigatório").optional(),
  credential: z.string().min(1).optional(),
  redirectUri: z.string().optional(),
});

const socialSetupSchema = z.object({
  tempToken: z.string().min(10),
  fullName: z.string().min(2, "Informe seu nome"),
  consent: z.boolean().refine((v) => v === true, "Consentimento obrigatório"),
});

// POST /api/v1/accounts/google — fluxo OAuth Google (mesmo padrão do Kikin: code flow)
router.post("/google", loginLimiter, async (req, res) => {
  try {
    const parsed = socialCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", error: parsed.error.issues[0]?.message || "Payload inválido" });
    }
    const profile = await social.verifyProvider("google", parsed.data);
    const outcome = await social.socialLoginOrSetup("google", profile, {
      ip: clientIpOf(req),
      userAgent: req.headers["user-agent"] || null,
    });
    return res.json(outcome);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// POST /api/v1/accounts/microsoft — fluxo OAuth Microsoft (code flow)
router.post("/microsoft", loginLimiter, async (req, res) => {
  try {
    const parsed = socialCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", error: parsed.error.issues[0]?.message || "Payload inválido" });
    }
    const profile = await social.verifyProvider("microsoft", parsed.data);
    const outcome = await social.socialLoginOrSetup("microsoft", profile, {
      ip: clientIpOf(req),
      userAgent: req.headers["user-agent"] || null,
    });
    return res.json(outcome);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// POST /api/v1/accounts/social/complete — mini passo pós-OAuth (nome + termos LGPD)
router.post("/social/complete", signupLimiter, async (req, res) => {
  try {
    const parsed = socialSetupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const result = await social.completeSocialSignup({
      tempToken: parsed.data.tempToken,
      fullName: parsed.data.fullName,
      consent: parsed.data.consent,
      ip: clientIpOf(req),
      userAgent: req.headers["user-agent"] || null,
    });
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const result = await accounts.login({
      email: parsed.data.email,
      password: parsed.data.password,
      ip: clientIpOf(req),
      userAgent: req.headers["user-agent"] || null,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

router.post("/refresh", perUserLimiter, async (req, res) => {
  try {
    const parsed = z.object({ refreshToken: z.string().min(10) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", error: "refreshToken obrigatório" });
    }
    const tokens = await accounts.rotateSession(parsed.data.refreshToken, {
      ip: clientIpOf(req),
      userAgent: req.headers["user-agent"] || null,
    });
    if (!tokens) {
      return res.status(401).json({ code: "INVALID_REFRESH", error: "Sessão inválida ou expirada." });
    }
    return res.json({ tokens });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

router.post("/logout", async (req, res) => {
  const refreshToken = (req.body as any)?.refreshToken as string | undefined;
  if (refreshToken) await accounts.revokeSession(refreshToken).catch(() => undefined);
  return res.json({ ok: true });
});

// PUT /api/v1/accounts/profile — edita nome
router.put("/profile", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = z.object({ fullName: z.string().min(2, "Informe seu nome") }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const account = await accounts.updateProfile(accountId, parsed.data.fullName);
    return res.json({ account });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// PUT /api/v1/accounts/whatsapp — define o WhatsApp único (contato/lembretes)
router.put("/whatsapp", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = z.object({ phone: z.string().min(8, "Informe seu WhatsApp").max(20) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const account = await accounts.updateWhatsapp(accountId, parsed.data.phone);
    return res.json({ account });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

router.get("/me", requireAuth, perUserLimiter, async (req, res) => {
  const accountId = (req as any).account.accountId;
  const account = await accounts.getAccount(accountId);
  if (!account) return res.status(404).json({ code: "NOT_FOUND", error: "Conta não encontrada." });
  return res.json({ account });
});

export default router;
