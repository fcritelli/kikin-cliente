import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { clientIp, lgpdDeleteLimiter, lgpdExportLimiter, lgpdWhatsappConfirmLimiter } from "../../middleware/rate-limit.js";
import * as lgpd from "./lgpd.service.js";
import * as whatsappAuth from "../../services/whatsapp/whatsapp-auth.service.js";

/**
 * Direitos do titular no portal do cliente (LGPD Art. 18) — montado em /api/v1/accounts:
 *   GET  /me/export                  → JSON dos dados do portal (download com Content-Disposition)
 *   POST /me/delete/request          → qual prova de identidade a conta exige (+ envia o código OTP)
 *   POST /me/delete                  → exclui SOMENTE a conta do portal (prova + "EXCLUIR")
 *   POST /me/whatsapp/confirm/request → envia o código para CONFIRMAR um WhatsApp (conta logada)
 *   POST /me/whatsapp/confirm         → confere o código e grava o número na conta (verificado)
 *
 * Escopo (decisão de produto): nada é escrito nem apagado no Kikin — o cadastro do cliente e
 * os agendamentos nos estabelecimentos permanecem exatamente como estão.
 */
const router = Router();

function accountIdOf(req: any): string {
  return req.account.accountId as string;
}

/**
 * Campos ADICIONAIS do contrato de erro que a UI precisa (nunca status/stack/mensagem interna).
 * Hoje: `reason`/`needsWhatsapp`/`confirmWord` do 409 PROOF_UNAVAILABLE — é o que faz a UI
 * oferecer "confirmar o WhatsApp agora" em vez de mandar o titular ao suporte.
 */
function extras(err: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err?.reason) out.reason = err.reason;
  if (err?.needsWhatsapp) out.needsWhatsapp = true;
  if (err?.confirmWord) out.confirmWord = err.confirmWord;
  return out;
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

// ------------------------------------------ confirmar o WhatsApp da conta logada (prova)

/**
 * Passo 1 — envia o código para o número informado. Só serve para a conta AUTENTICADA: o
 * número vira `whatsapp_phone_*` da conta no passo 2, depois de o código ser conferido.
 * É o caminho de prova de identidade da conta Google/Microsoft (sem senha e sem WhatsApp) —
 * sem ele, o titular não consegue exercer o Art. 18, IV/VI sozinho.
 */
const whatsappConfirmRequestSchema = z.object({ phone: z.string().min(8, "Informe seu WhatsApp com DDD").max(20) });

router.post("/me/whatsapp/confirm/request", requireAuth, lgpdWhatsappConfirmLimiter, async (req, res) => {
  try {
    const parsed = whatsappConfirmRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    }
    const result = await whatsappAuth.requestWhatsappConfirmation({
      accountId: accountIdOf(req),
      phone: parsed.data.phone,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: err.message });
  }
});

/**
 * Passo 2 — confere o código e grava hash + máscara + valor cifrado do número na conta
 * (`whatsapp_phone_verified_at`). Depois disso o OTP de exclusão (purpose 'account_deletion')
 * vai para esse número.
 */
const whatsappConfirmSchema = z.object({
  phone: z.string().min(8, "Informe seu WhatsApp com DDD").max(20),
  code: z.string().min(6, "Informe o código de 6 dígitos").max(6),
});

router.post("/me/whatsapp/confirm", requireAuth, lgpdWhatsappConfirmLimiter, async (req, res) => {
  try {
    const parsed = whatsappConfirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", error: parsed.error.issues[0]?.message || "Payload inválido" });
    }
    const result = await whatsappAuth.confirmWhatsappForAccount({
      accountId: accountIdOf(req),
      phone: parsed.data.phone,
      code: parsed.data.code,
    });
    return res.json(result);
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
    return res
      .status(err.status || 500)
      .json({ code: err.code || "INTERNAL", error: err.message, ...extras(err) });
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
    return res
      .status(err.status || 500)
      .json({ code: err.code || "INTERNAL", error: err.message, ...extras(err) });
  }
});

export default router;
