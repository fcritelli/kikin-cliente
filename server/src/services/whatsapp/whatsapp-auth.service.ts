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

/**
 * Propósito do OTP. A tabela `client_otp_codes.purpose` já existia (texto livre, default
 * 'whatsapp_signin'); 'account_deletion' (LGPD Art. 18) usa o MESMO mecanismo/armazenamento,
 * só com escopo próprio — retrocompatível: quem não passa purpose continua no login.
 */
export type WhatsappOtpPurpose = "whatsapp_signin" | "account_deletion";

/** Recorte de banco aceito pelas funções de OTP (permite rodar dentro de uma transação). */
export interface OtpDb {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

const defaultDb: OtpDb = {
  query: (text, params) => query(text, params) as unknown as Promise<{ rows: any[]; rowCount: number | null }>,
};

const OTP_MESSAGES: Record<WhatsappOtpPurpose, (code: string) => string> = {
  whatsapp_signin: (code) => `Seu código do kikin cliente é ${code}. Ele expira em 10 minutos.`,
  account_deletion: (code) =>
    `Código para EXCLUIR sua conta do kikin cliente: ${code}. Ele expira em 10 minutos. Se não foi você, ignore esta mensagem — sua conta continua ativa.`,
};

function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function codeHashOf(code: string): string {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

async function latestOtp(phoneHash: string, purpose: WhatsappOtpPurpose = "whatsapp_signin", db: OtpDb = defaultDb) {
  const res = await db.query<{ id: string; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM client_otp_codes
     WHERE phone_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [phoneHash, purpose]
  );
  return res.rows[0] || null;
}

/**
 * Envia o código OTP por WhatsApp (10 min). Em dev (sem provedor) retorna o código.
 * `purpose` é opcional e default 'whatsapp_signin' — cadastro/login não mudam.
 */
export async function requestWhatsappOtp(input: {
  phone: string;
  purpose?: WhatsappOtpPurpose;
}): Promise<{ ok: true; masked: string; devCode?: string }> {
  const purpose: WhatsappOtpPurpose = input.purpose || "whatsapp_signin";
  const normalized = normalizePhoneBR(input.phone);
  if (!normalized) throw err(400, "INVALID_PHONE", "Informe um WhatsApp válido com DDD.");
  const phoneHash = hashPhoneBR(normalized, config.KIKIN_CLIENT_PORTAL_SECRET)!;
  const masked = maskPhoneBR(normalized)!;

  const code = generateCode();
  const codeHash = codeHashOf(code);
  // Invalida só os códigos pendentes do MESMO propósito (um código de exclusão não derruba
  // um login em andamento, e vice-versa).
  await query(`UPDATE client_otp_codes SET used_at = now() WHERE phone_hash = $1 AND purpose = $2 AND used_at IS NULL`, [
    phoneHash,
    purpose,
  ]);
  await query(
    `INSERT INTO client_otp_codes (phone_hash, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '10 minutes')`,
    [phoneHash, purpose, codeHash]
  );

  const sent = await sendWhatsApp(normalized, OTP_MESSAGES[purpose](code));
  if (!sent.ok) {
    throw err(502, "WHATSAPP_SEND_FAILED", "Não foi possível enviar o código por WhatsApp. Tente novamente em instantes.");
  }
  const dev = config.WHATSAPP_DEV_RETURN_CODE === "true";
  return { ok: true, masked, ...(dev ? { devCode: code } : {}) };
}

/**
 * Verifica um código OTP pelo HASH do telefone (sem precisar do número em claro) e NÃO o
 * consome. Em código errado incrementa `attempts` de forma PERSISTENTE (fora de qualquer
 * transação que possa sofrer rollback) — é o que impede força bruta do código de 6 dígitos.
 * Erros claros: 400 expirado / 400 incorreto / 429 tentativas demais.
 */
export async function checkWhatsappOtp(input: {
  phoneHash: string;
  code: string;
  purpose: WhatsappOtpPurpose;
  db?: OtpDb;
}): Promise<void> {
  const db = input.db || defaultDb;
  const otp = await latestOtp(input.phoneHash, input.purpose, db);
  if (!otp) throw err(400, "OTP_EXPIRED", "Código expirado. Solicite um novo código.");
  if (otp.attempts >= MAX_ATTEMPTS) throw err(429, "OTP_TOO_MANY", "Muitas tentativas. Solicite um novo código.");

  if (codeHashOf(input.code) !== otp.code_hash) {
    await db.query("UPDATE client_otp_codes SET attempts = attempts + 1 WHERE id = $1", [otp.id]);
    throw err(400, "OTP_INVALID", "Código incorreto.");
  }
}

/**
 * Marca o código como usado (uso ÚNICO). Feito DENTRO da transação do chamador: o UPDATE
 * condicional garante que o mesmo código não seja consumido duas vezes em corrida, e o
 * rollback devolve o código ao titular. Ex.: exclusão de conta (LGPD Art. 18).
 */
export async function markWhatsappOtpUsed(input: {
  phoneHash: string;
  code: string;
  purpose: WhatsappOtpPurpose;
  db: OtpDb;
}): Promise<void> {
  const res = await input.db.query(
    `UPDATE client_otp_codes SET used_at = now()
     WHERE phone_hash = $1 AND purpose = $2 AND code_hash = $3
       AND used_at IS NULL AND expires_at > now()`,
    [input.phoneHash, input.purpose, codeHashOf(input.code)]
  );
  if ((res.rowCount ?? 0) === 0) {
    throw err(400, "OTP_EXPIRED", "Código já utilizado ou expirado. Solicite um novo código.");
  }
}

/** Número da conta decifrado em memória (só para enviar mensagem). Nunca logado/exportado. */
export function decryptAccountPhone(phoneEnc: string | null | undefined): string | null {
  return decryptPhone(phoneEnc);
}

export type WhatsappVerifyOutcome =
  | { status: "LOGIN"; tokens: SessionTokens; account: PublicAccount }
  | { status: "NEED_REGISTER"; tempToken: string; masked: string };

/** Confere o código e decide: login (conta existe) ou cadastro (NEED_REGISTER). */
export async function verifyWhatsappOtp(input: { phone: string; code: string }): Promise<WhatsappVerifyOutcome> {
  const normalized = normalizePhoneBR(input.phone);
  if (!normalized) throw err(400, "INVALID_PHONE", "Informe um WhatsApp válido com DDD.");
  const phoneHash = hashPhoneBR(normalized, config.KIKIN_CLIENT_PORTAL_SECRET)!;
  const otp = await latestOtp(phoneHash, "whatsapp_signin");
  if (!otp) throw err(400, "OTP_EXPIRED", "Código expirado. Solicite um novo.");
  if (otp.attempts >= MAX_ATTEMPTS) throw err(429, "OTP_TOO_MANY", "Muitas tentativas. Solicite um novo código.");

  if (codeHashOf(input.code) !== otp.code_hash) {
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
