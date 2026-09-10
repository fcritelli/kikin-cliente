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
  whatsappOptIn: z.boolean().optional(),
});

const autoLinkSchema = z.object({
  salonId: z.string().uuid("Estabelecimento inválido"),
  phone: z.string().min(8, "Informe seu telefone").max(20),
  whatsappOptIn: z.boolean().optional(),
});

// Convite do estabelecimento (link `/e/<slug>` ou `/cadastro?ref=<slug>`): aceita slug ou id.
const inviteSchema = z.object({
  salonRef: z.string().min(1, "Link do estabelecimento inválido").max(200),
  phone: z.string().min(8, "Informe seu WhatsApp com DDD").max(20),
  name: z.string().min(2, "Informe seu nome").max(120).optional(),
  whatsappOptIn: z.boolean().optional(),
});

const cancelSchema = z.object({
  salonId: z.string().uuid("Estabelecimento inválido"),
  appointmentId: z.string().uuid("Agendamento inválido"),
});

const rescheduleSchema = z.object({
  salonId: z.string().uuid("Estabelecimento inválido"),
  appointmentId: z.string().uuid("Agendamento inválido"),
  staffId: z.string().uuid().nullable().optional(),
  startAt: z.string().min(1, "Horário obrigatório"),
});

const bookSchema = z.object({
  salonId: z.string().uuid("Estabelecimento inválido"),
  serviceIds: z.array(z.string().uuid("Serviço inválido")).min(1, "Escolha ao menos um serviço"),
  staffId: z.string().uuid().nullable().optional(),
  startAt: z.string().min(1, "Horário obrigatório"),
  whatsappOptIn: z.boolean().optional(),
});

const bookNewSchema = z.object({
  salonId: z.string().uuid("Estabelecimento inválido"),
  serviceIds: z.array(z.string().uuid("Serviço inválido")).min(1, "Escolha ao menos um serviço"),
  staffId: z.string().uuid().nullable().optional(),
  startAt: z.string().min(1, "Horário obrigatório"),
  name: z.string().min(2, "Informe seu nome").optional(),
  phone: z.string().min(10, "Informe seu WhatsApp com DDD").max(20),
  whatsappOptIn: z.boolean().optional(),
  holdToken: z.string().nullable().optional(),
});

// POST /api/v1/links/book — agenda no client vinculado (sem telefone; vínculo é a identidade)
router.post("/book", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const result = await links.bookForLinkedClient({ accountId, ...parsed.data });
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// POST /api/v1/links/book-new — agenda em estabelecimento ainda NÃO vinculado
// (link do salão). O vínculo nasce do próprio agendamento: o Kikin acha/cria o
// client pelo WhatsApp informado e a conta passa a ver o salão no painel na hora.
router.post("/book-new", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = bookNewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const { result, link, clientId, linkedNow } = await links.bookNewSalonAndLink({ accountId, ...parsed.data });
    return res.status(201).json({
      success: true,
      linked: !!link,
      linkedNow,
      clientId,
      salonId: parsed.data.salonId,
      ...result,
    });
  } catch (err: any) {
    return res.status(err.status || 500).json({
      code: err.code || "INTERNAL",
      error: err.message,
      ...(err.detail ? { detail: err.detail } : {}),
    });
  }
});

// POST /api/v1/links/me/appointments/cancel — cancela o grupo (política no Kikin)
router.post("/me/appointments/cancel", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const result = await links.cancelAppointment({ accountId, ...parsed.data });
    return res.json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({
      code: err.code || "INTERNAL",
      error: err.message,
      ...(err.detail ? { detail: err.detail } : {}),
    });
  }
});

// POST /api/v1/links/me/appointments/reschedule — troca atômica no Kikin
router.post("/me/appointments/reschedule", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const result = await links.rescheduleAppointment({ accountId, ...parsed.data });
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({
      code: err.code || "INTERNAL",
      error: err.message,
      ...(err.detail ? { detail: err.detail } : {}),
    });
  }
});

// POST /api/v1/links/invite — vínculo pelo link do estabelecimento (cadastro/login)
// O cliente informa o WhatsApp: o Kikin acha-ou-cria o client do salão e a conta já
// sai com o estabelecimento no painel, SEM depender de um agendamento.
router.post("/invite", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const link = await links.linkInvitedSalon({ accountId, ...parsed.data });
    return res.status(201).json({ success: true, linked: true, link });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
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
    const accountId = (req as any).account.accountId;
    const candidates = await links.searchCandidatesForAccount({ phone: parsed.data.phone, accountId });
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

const holdCreateSchema = z.object({
  salonId: z.string().uuid(),
  staffId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).min(1),
  startAt: z.string().min(1),
});

// POST /api/v1/links/hold — reserva 3min ao selecionar o horário
router.post("/hold", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = holdCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    const result = await links.createBookingHold(parsed.data);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// DELETE /api/v1/links/hold — libera (abandonou/fechou)
router.delete("/hold", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const token = String((req.body as any)?.token || "");
    if (!token) return res.status(400).json({ code: "VALIDATION_ERROR", error: "token obrigatório" });
    await links.releaseBookingHold(token);
    return res.json({ ok: true });
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

// PUT /api/v1/links/whatsapp-optin — consentimento de WhatsApp por vínculo
router.put("/whatsapp-optin", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const parsed = z.object({ salonId: z.string().uuid(), optin: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const accountId = (req as any).account.accountId;
    const link = await links.setWhatsappOptin({ accountId, salonId: parsed.data.salonId, optin: parsed.data.optin });
    return res.json({ link });
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// GET /api/v1/links/me/appointments/history — histórico (inclui canceladas/faltas)
router.get("/me/appointments/history", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const accountId = (req as any).account.accountId;
    const appointments = await links.listAppointmentsHistory(accountId);
    return res.json({ appointments });
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
