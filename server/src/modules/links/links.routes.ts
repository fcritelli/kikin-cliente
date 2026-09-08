import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { perUserLimiter } from "../../middleware/rate-limit.js";
import * as links from "./links.service.js";

const router = Router();

const claimSchema = z.object({
  phone: z.string().min(8, "Informe seu telefone").max(20),
});

const confirmSchema = z.object({
  salonId: z.string().uuid("Estabelecimento inválido"),
  phone: z.string().min(8, "Informe seu telefone").max(20),
  clientId: z.string().uuid("Cliente inválido"),
});

const autoLinkSchema = z.object({
  salonId: z.string().uuid("Estabelecimento inválido"),
  phone: z.string().min(8, "Informe seu telefone").max(20),
});

// GET /api/v1/links/me — vínculos da conta
router.get("/me", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const accountId = (req as any).account.accountId;
    const myLinks = await links.listLinks(accountId);
    return res.json({ links: myLinks });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// POST /api/v1/links/claim — busca candidatos mascarados pelo telefone em todos os salões
router.post("/claim", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const candidates = await links.searchCandidates(parsed.data);
    return res.json({ candidates });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// POST /api/v1/links/confirm — confirma "sou eu" e grava o vínculo
router.post("/confirm", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const link = await links.confirmLink({
      accountId,
      salonId: parsed.data.salonId,
      phone: parsed.data.phone,
      kikinClientId: parsed.data.clientId,
    });
    return res.status(201).json({ link });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// POST /api/v1/links/auto — vínculo silencioso pós-booking (mesmo salão do agendamento)
router.post("/auto", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = autoLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const link = await links.autoLinkFromBooking({ accountId, ...parsed.data });
    return res.json({ link });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// GET /api/v1/links/me/appointments — próximos agendamentos em todos os vínculos
router.get("/me/appointments", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const accountId = (req as any).account.accountId;
    const appointments = await links.listFutureAppointments(accountId);
    return res.json({ appointments });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

export default router;
