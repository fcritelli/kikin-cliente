import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { perUserLimiter } from "../../middleware/rate-limit.js";
import * as push from "./push.service.js";

/**
 * Web Push do portal — /api/v1/push.
 *
 * Recurso opcional (VAPID): sem as variáveis no ambiente, tudo responde
 * 503 PUSH_NOT_CONFIGURED e o front não oferece o botão.
 */

const router = Router();

const NOT_CONFIGURED = { code: "PUSH_NOT_CONFIGURED", error: "Notificações push não estão habilitadas neste servidor." };

function pushDisabled(res: any) {
  return res.status(503).json(NOT_CONFIGURED);
}

const subscriptionSchema = z.object({
  endpoint: z.string().url("Endpoint inválido").min(10),
  keys: z.object({
    p256dh: z.string().min(1, "Chave p256dh obrigatória"),
    auth: z.string().min(1, "Chave auth obrigatória"),
  }),
  userAgent: z.string().max(500).optional().nullable(),
});

// GET /api/v1/push/public-key — pública: chave pública VAPID p/ o navegador assinar.
router.get("/public-key", (_req, res) => {
  const key = push.getPushPublicKey();
  if (!key) return pushDisabled(res);
  return res.json({ publicKey: key });
});

// POST /api/v1/push/subscribe — autenticada: grava/atualiza a inscrição da conta (upsert).
router.post("/subscribe", requireAuth, perUserLimiter, async (req, res) => {
  try {
    if (!push.isPushEnabled()) return pushDisabled(res);
    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    await push.saveSubscription({
      accountId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: parsed.data.userAgent ?? req.headers["user-agent"] ?? null,
    });
    return res.status(201).json({ ok: true });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// DELETE /api/v1/push/subscribe — autenticada: remove a inscrição por endpoint. Idempotente.
router.delete("/subscribe", requireAuth, perUserLimiter, async (req, res) => {
  try {
    if (!push.isPushEnabled()) return pushDisabled(res);
    const parsed = z.object({ endpoint: z.string().url("Endpoint inválido").min(10) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    await push.removeSubscription({ accountId, endpoint: parsed.data.endpoint });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

export default router;
