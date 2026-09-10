import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { clientIp, lgpdDeleteLimiter, lgpdExportLimiter } from "../../middleware/rate-limit.js";
import * as lgpd from "./lgpd.service.js";

/**
 * Direitos do titular no portal do cliente (LGPD Art. 18) — montado em /api/v1/accounts:
 *   GET  /me/export          → JSON dos dados do portal (download com Content-Disposition)
 *   POST /me/delete/request  → qual prova de identidade a conta exige (+ envia o código OTP)
 *   POST /me/delete          → exclui SOMENTE a conta do portal (prova + "EXCLUIR")
 *
 * Escopo (decisão de produto): nada é escrito nem apagado no Kikin — o cadastro do cliente e
 * os agendamentos nos estabelecimentos permanecem exatamente como estão.
 */
const router = Router();

function accountIdOf(req: any): string {
  return req.account.accountId as string;
}

// ---------------------------------------------------------------- export (JSON)

router.get("/me/export", requireAuth, lgpdExportLimiter, async (req, res) => {
  try {
    const accountId = accountIdOf(req);
    const payload = await lgpd.buildAccountExport(accountId);
    const filename = lgpd.exportFilename();
    const body = JSON.stringify(payload, null, 2);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(body);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// ---------------------------------------------------------------- pedido de exclusão

const deleteRequestSchema = z.object({ sendCode: z.boolean().optional() }).optional();

router.post("/me/delete/request", requireAuth, lgpdDeleteLimiter, async (req, res) => {
  try {
    const parsed = deleteRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const challenge = await lgpd.describeDeletionProof(accountIdOf(req), {
      sendCode: parsed.data?.sendCode !== false,
    });
    return res.json(challenge);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

// ---------------------------------------------------------------- exclusão

// A validação fina (palavra EXCLUIR, senha, código de 6 dígitos) fica no serviço, que responde
// com os códigos de erro do contrato: 409 CONFIRM_INVALID e 400 PROOF_REQUIRED/INVALID_*.
const deleteSchema = z.object({
  confirm: z.string().max(50).optional(),
  password: z.string().max(200).optional(),
  otpCode: z.string().max(10).optional(),
});

router.post("/me/delete", requireAuth, lgpdDeleteLimiter, async (req, res) => {
  try {
    const parsed = deleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ code: "VALIDATION_ERROR", error: parsed.error.issues[0]?.message || "Payload inválido" });
    }
    const result = await lgpd.deleteAccount(
      accountIdOf(req),
      { confirm: parsed.data.confirm, password: parsed.data.password, otpCode: parsed.data.otpCode },
      { ip: clientIp(req) }
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

export default router;
