import crypto from "node:crypto";
import { query, withTransaction } from "../../db.js";
import { config } from "../../config.js";
import { decryptPhone, encryptPhone, sendWhatsApp } from "./whatsapp.service.js";
import { normalizePhoneBR, hashPhoneBR, maskPhoneBR } from "../../utils/phone.js";
import { issueSession, err, getAccount, type SessionTokens, type PublicAccount } from "../../modules/accounts/accounts.service.js";
import { confirmLink, searchCandidates } from "../../modules/links/links.service.js";

/**
 * Cadastro/login por WhatsApp (OTP):
 *  1. request → código de 6 dígitos (hash) enviado por WhatsApp (10 min);
 *  2. verify  → código certo: conta existe? LOGIN. Não existe? NEED_REGISTER + tempToken;
 *  3. register→ nome + termos (+ e-mail opcional) → cria a conta com o número verificado
 *     (criptografado em repouso) e VINCULA automaticamente os salões onde o número já
 *     está cadastrado (recuperação silenciosa — prova = OTP).
 */

const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

async function latestOtp(phoneHash: string) {
  const res = await query<{ id: string; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM client_otp_codes
     WHERE phone_hash = $1 AND purpose = 'whatsapp_signin' AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [phoneHash]
  );
  return res.rows[0] || null;
}

/** Envia o código OTP por WhatsApp (10 min). Em dev (sem provedor) retorna o código. */
export async function requestWhatsappOtp(input: { phone: string }): Promise<{ ok: true; masked: string; devCode?: string }> {
  const normalized = normalizePhoneBR(input.phone);
  if (!normalized) throw err(400, "INVALID_PHONE", "Informe um WhatsApp válido com DDD.");
  const phoneHash = hashPhoneBR(normalized, config.KIKIN_CLIENT_PORTAL_SECRET)!;
  const masked = maskPhoneBR(normalized)!;

  const code = generateCode();
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  await query(`UPDATE client_otp_codes SET used_at = now() WHERE phone_hash = $1 AND used_at IS NULL`, [phoneHash]);
  await query(
    `INSERT INTO client_otp_codes (phone_hash, code_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`,
    [phoneHash, codeHash]
  );

  const sent = await sendWhatsApp(normalized, `Seu código do kikin cliente é ${code}. Ele expira em 10 minutos.`);
  if (!sent.ok) {
    throw err(502, "WHATSAPP_SEND_FAILED", "Não foi possível enviar o código por WhatsApp. Tente novamente em instantes.");
  }
  const dev = config.WHATSAPP_DEV_RETURN_CODE === "true";
  return { ok: true, masked, ...(dev ? { devCode: code } : {}) };
}

export type WhatsappVerifyOutcome =
  | { status: "LOGIN"; tokens: SessionTokens; account: PublicAccount }
  | { status: "NEED_REGISTER"; tempToken: string; masked: string };

/** Confere o código e decide: login (conta existe) ou cadastro (NEED_REGISTER). */
export async function verifyWhatsappOtp(input: { phone: string; code: string }): Promise<WhatsappVerifyOutcome> {
  const normalized = normalizePhoneBR(input.phone);
  if (!normalized) throw err(400, "INVALID_PHONE", "Informe um WhatsApp válido com DDD.");
  const phoneHash = hashPhoneBR(normalized, config.KIKIN_CLIENT_PORTAL_SECRET)!;
  const otp = await latestOtp(phoneHash);
  if (!otp) throw err(400, "OTP_EXPIRED", "Código expirado. Solicite um novo.");
  if (otp.attempts >= MAX_ATTEMPTS) throw err(429, "OTP_TOO_MANY", "Muitas tentativas. Solicite um novo código.");

  const codeHash = crypto.createHash("sha256").update(String(input.code || "")).digest("hex");
  if (codeHash !== otp.code_hash) {
    await query("UPDATE client_otp_codes SET attempts = attempts + 1 WHERE id = $1", [otp.id]);
    throw err(400, "OTP_INVALID", "Código incorreto.");
  }
  await query("UPDATE client_otp_codes SET used_at = now() WHERE id = $1", [otp.id]);

  const accountRes = await query<{ id: string }>(
    `SELECT id FROM client_accounts WHERE whatsapp_phone_hash = $1`,
    [phoneHash]
  );
  const existing = accountRes.rows[0];
  if (existing) {
    await query(
      `UPDATE client_accounts SET whatsapp_phone_verified_at = coalesce(whatsapp_phone_verified_at, now()), updated_at = now() WHERE id = $1`,
      [existing.id]
    );
    const tokens = await issueSession(existing.id, { ip: null, userAgent: null });
    const account = await getAccount(existing.id);
    return { status: "LOGIN", tokens, account: account! };
  }

  const tempToken = crypto.randomBytes(24).toString("hex");
  await query(
    `INSERT INTO client_temp_signup (phone_hash, masked, phone_enc, temp_token, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '30 minutes')
     ON CONFLICT (temp_token) DO NOTHING`,
    [phoneHash, maskPhoneBR(normalized), encryptPhone(normalized), tempToken]
  );
  return { status: "NEED_REGISTER", tempToken, masked: maskPhoneBR(normalized)! };
}

/** Cria a conta do WhatsApp e vincula os cadastros existentes do número (recuperação silenciosa). */
export async function completeWhatsappSignup(input: {
  tempToken: string;
  fullName: string;
  consent: boolean;
  email?: string | null;
}): Promise<{ tokens: SessionTokens; account: PublicAccount; linked: number }> {
  const res = await query<{ phone_hash: string; masked: string; phone_enc: string }>(
    `SELECT phone_hash, masked, phone_enc FROM client_temp_signup WHERE temp_token = $1 AND used_at IS NULL AND expires_at > now() LIMIT 1`,
    [input.tempToken]
  );
  const row = res.rows[0];
  if (!row) throw err(401, "TEMP_TOKEN_EXPIRED", "Sessão temporária expirada. Solicite o código novamente.");
  if (!input.consent) throw err(400, "CONSENT_REQUIRED", "É necessário aceitar os termos/privacidade.");
  const fullName = String(input.fullName || "").trim();
  if (fullName.length < 2) throw err(400, "VALIDATION_ERROR", "Informe seu nome.");

  const email = input.email ? String(input.email).trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, "VALIDATION_ERROR", "E-mail inválido.");

  await query("UPDATE client_temp_signup SET used_at = now() WHERE temp_token = $1", [input.tempToken]);

  const accountId = await withTransaction(async (client) => {
    const dup = await client.query("SELECT id FROM client_accounts WHERE whatsapp_phone_hash = $1", [row.phone_hash]);
    if (dup.rows.length > 0) throw err(409, "WHATSAPP_ALREADY_REGISTERED", "Este número já possui conta. Faça login.");
    if (email) {
      const dupEmail = await client.query("SELECT id FROM client_accounts WHERE email_normalized = $1", [email]);
      if (dupEmail.rows.length > 0) throw err(409, "EMAIL_ALREADY_EXISTS", "Este e-mail já possui conta.");
    }
    const ins = await client.query<{ id: string }>(
      `INSERT INTO client_accounts
         (email, email_normalized, password_hash, full_name, email_verified_at, consent_terms_at,
          whatsapp_phone_hash, whatsapp_phone_masked, whatsapp_phone_enc, whatsapp_phone_verified_at,
          whatsapp_updated_at, auth_provider)
       VALUES ($1, $2, NULL, $3, CASE WHEN $1::text IS NULL THEN NULL ELSE now() END, now(),
               $4, $5, $6, now(), now(), 'whatsapp')
       RETURNING id`,
      [email, email ?? null, fullName, row.phone_hash, row.masked, row.phone_enc]
    );
    return ins.rows[0].id;
  });

  // Vínculo automático: o número (provado por OTP) é do cliente — vincula onde estiver cadastrado.
  const normalized = decryptPhone(row.phone_enc);
  let linked = 0;
  if (normalized) {
    try {
      const candidates = await searchCandidates({ phone: normalized });
      const seenSalons = new Set<string>();
      for (const c of candidates) {
        if (seenSalons.has(c.salonId)) continue;
        seenSalons.add(c.salonId);
        try {
          await confirmLink({ accountId, salonId: c.salonId, phone: normalized, kikinClientId: c.clientId, whatsappOptIn: true });
          linked += 1;
        } catch {
          /* vínculo já existe/outra conta → ignora */
        }
      }
    } catch {
      /* best-effort */
    }
  }

  const tokens = await issueSession(accountId, { ip: null, userAgent: null });
  const account = await getAccount(accountId);
  return { tokens, account: account!, linked };
}
