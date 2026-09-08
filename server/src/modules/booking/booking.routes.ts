import { Router } from "express";
import { z } from "zod";
import { publicBookingLimiter } from "../../middleware/rate-limit.js";
import { bookingProxy, publicErrorToHttp } from "./booking.service.js";
import { listSalons } from "../links/links.service.js";

const router = Router();

function handleErr(res: any, err: any): void {
  const mapped = publicErrorToHttp(err);
  res.status(mapped.status).json(mapped.status === 500 ? { error: mapped.error } : mapped);
}

// GET /api/v1/booking/salons — catálogo de estabelecimentos p/ "Agendar novo" (área logada)
router.get("/salons", async (_req, res) => {
  try {
    const salons = await listSalons();
    return res.json({ salons });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// GET /api/v1/booking/:slug/salon — meta do estabelecimento (booking público)
router.get("/:slug/salon", async (req, res) => {
  try {
    const data = await bookingProxy.getSalon(String(req.params.slug));
    return res.json(data);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// GET /api/v1/booking/:slug/services
router.get("/:slug/services", async (req, res) => {
  try {
    const data = await bookingProxy.getServices(String(req.params.slug));
    return res.json(data);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// GET /api/v1/booking/:slug/staff?serviceIds=
router.get("/:slug/staff", async (req, res) => {
  try {
    const serviceIds = typeof req.query.serviceIds === "string"
      ? req.query.serviceIds.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const data = await bookingProxy.getStaff(String(req.params.slug), serviceIds);
    return res.json(data);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// GET /api/v1/booking/:slug/slots?date=&serviceIds=&staffId=
router.get("/:slug/slots", async (req, res) => {
  try {
    const date = String(req.query.date || "");
    const serviceIds = String(req.query.serviceIds || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!date || serviceIds.length === 0) {
      return res.status(400).json({ error: "Data e serviços são obrigatórios", code: "VALIDATION_ERROR" });
    }
    const staffId = typeof req.query.staffId === "string" && req.query.staffId ? String(req.query.staffId) : null;
    const data = await bookingProxy.getSlots(String(req.params.slug), { date, serviceIds, staffId });
    return res.json(data);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// GET /api/v1/booking/:slug/holiday?date=
router.get("/:slug/holiday", async (req, res) => {
  try {
    const date = String(req.query.date || "");
    const data = await bookingProxy.getHoliday(String(req.params.slug), date);
    return res.json(data);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// POST /api/v1/booking/:slug/book — agenda (cria/acha o client no Kikin)
const bookSchema = z
  .object({
    serviceIds: z.array(z.string().uuid()).min(1, "Escolha ao menos um serviço"),
    staffId: z.string().uuid().nullable().optional(),
    startAt: z.string().min(1, "Horário obrigatório"),
    clientName: z.string().min(2, "Informe seu nome"),
    clientPhone: z.string().min(10, "Informe seu telefone"),
    clientEmail: z.string().email().optional().nullable(),
    notes: z.string().max(500).optional(),
  })
  .passthrough();

router.post("/:slug/book", publicBookingLimiter, async (req, res) => {
  try {
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", error: parsed.error.issues[0]?.message || "Payload inválido" });
    }
    const data = await bookingProxy.book(String(req.params.slug), parsed.data);
    return res.status(201).json(data);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

export default router;
