import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query, withTransaction } from "../../db.js";
import { config } from "../../config.js";

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // segundos do access token
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function signAccessToken(accountId: string): string {
  return jwt.sign({ sub: accountId, type: "access" }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as any, // '2h'|'15m'… (StringValue do jsonwebtoken)
  });
}

function accessExpiresSeconds(): number {
  // converte '2h'/'15m' simples para segundos (default 2h)
  const m = /^(\d+)([smhd])$/.exec(config.JWT_EXPIRES_IN);
  if (!m) return 2 * 3600;
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
  return Number(m[1]) * mult;
}

export async function issueSession(
  accountId: string,
  ctx: { ip?: string | null; userAgent?: string | null }
): Promise<SessionTokens> {
  const accessToken = signAccessToken(accountId);
  const refreshToken = generateToken();
  const refreshHash = sha256(refreshToken);
  const expiresInSec = 30 * 24 * 3600;
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);
  await query(
    `INSERT INTO client_account_sessions (account_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [accountId, refreshHash, ctx.userAgent || null, ctx.ip || null, expiresAt]
  );
  return { accessToken, refreshToken, expiresIn: accessExpiresSeconds() };
}

export async function rotateSession(
  oldRefreshToken: string,
  ctx: { ip?: string | null; userAgent?: string | null }
): Promise<SessionTokens | null> {
  const hash = sha256(oldRefreshToken);
  const res = await query<{
    id: string;
    account_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, account_id, expires_at, revoked_at FROM client_account_sessions
     WHERE refresh_token_hash = $1`,
    [hash]
  );
  const session = res.rows[0];
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    return null;
  }
  const accountRes = await query<{ is_active: boolean }>(
    "SELECT is_active FROM client_accounts WHERE id = $1",
    [session.account_id]
  );
  if (!accountRes.rows[0]?.is_active) return null;
  await query("UPDATE client_account_sessions SET revoked_at = now() WHERE id = $1", [session.id]);
  return issueSession(session.account_id, ctx);
}

export async function revokeSession(refreshToken: string): Promise<void> {
  await query("UPDATE client_account_sessions SET revoked_at = now() WHERE refresh_token_hash = $1", [
    sha256(refreshToken),
  ]);
}

export interface SignupResult {
  accountId: string;
  email: string;
  verificationToken?: string;
  requiresVerification: boolean;
}

export async function signup(input: {
  email: string;
  password: string;
  fullName: string;
  consent: boolean;
}): Promise<SignupResult> {
  if (!input.consent) throw err(400, "CONSENT_REQUIRED", "É necessário aceitar os termos/privacidade.");
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");
  if (password.length < 8) throw err(400, "WEAK_PASSWORD", "A senha deve ter no mínimo 8 caracteres.");
  const passwordHash = await bcrypt.hash(password, 12);

  const accountId = await withTransaction(async (client) => {
    const existing = await client.query(
      "SELECT id FROM client_accounts WHERE email_normalized = $1",
      [email]
    );
    if (existing.rows.length > 0) throw err(409, "EMAIL_ALREADY_EXISTS", "Este e-mail já possui conta.");
    const ins = await client.query<{ id: string }>(
      `INSERT INTO client_accounts (email, email_normalized, password_hash, full_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, email, passwordHash, String(input.fullName || "").trim()]
    );
    return ins.rows[0].id;
  });

  const verificationToken = generateToken();
  await query(
    `INSERT INTO client_email_tokens (account_id, purpose, token_hash, expires_at)
     VALUES ($1, 'verify_email', $2, now() + interval '24 hours')`,
    [accountId, sha256(verificationToken)]
  );

  return {
    accountId,
    email,
    requiresVerification: true,
    ...(config.EMAIL_VERIFY_RETURN_TOKEN === "true"
      ? { verificationToken }
      : { verificationToken: undefined }),
  };
}

export async function verifyEmail(token: string): Promise<string> {
  const hash = sha256(token);
  const res = await query<{ account_id: string }>(
    `SELECT account_id FROM client_email_tokens
     WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL
       AND expires_at > now()`,
    [hash]
  );
  if (res.rows.length === 0) throw err(400, "INVALID_TOKEN", "Token inválido ou expirado.");
  await query(
    `UPDATE client_email_tokens SET used_at = now()
     WHERE token_hash = $1`,
    [hash]
  );
  await query("UPDATE client_accounts SET email_verified_at = now() WHERE id = $1", [
    res.rows[0].account_id,
  ]);
  return res.rows[0].account_id;
}

export async function resendVerification(email: string): Promise<string | null> {
  const normalized = normalizeEmail(email);
  const res = await query<{ id: string; email_verified_at: Date | null }>(
    "SELECT id, email_verified_at FROM client_accounts WHERE email_normalized = $1",
    [normalized]
  );
  const account = res.rows[0];
  if (!account || account.email_verified_at) return null;
  const verificationToken = generateToken();
  await query(
    `INSERT INTO client_email_tokens (account_id, purpose, token_hash, expires_at)
     VALUES ($1, 'verify_email', $2, now() + interval '24 hours')`,
    [account.id, sha256(verificationToken)]
  );
  return config.EMAIL_VERIFY_RETURN_TOKEN === "true" ? verificationToken : null;
}

export async function login(input: {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ tokens: SessionTokens; accountId: string; emailVerified: boolean }> {
  const email = normalizeEmail(input.email);
  const res = await query<{
    id: string;
    password_hash: string;
    email_verified_at: Date | null;
    is_active: boolean;
  }>("SELECT id, password_hash, email_verified_at, is_active FROM client_accounts WHERE email_normalized = $1", [email]);
  const account = res.rows[0];
  // Contas 100% sociais não possuem password_hash: senha local nunca confere.
  const ok = account && account.is_active && account.password_hash && (await bcrypt.compare(input.password, account.password_hash));
  if (!ok || !account) throw err(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");
  if (!account.email_verified_at) throw err(403, "EMAIL_NOT_VERIFIED", "Verifique seu e-mail antes de entrar.");
  const tokens = await issueSession(account.id, { ip: input.ip, userAgent: input.userAgent });
  return { tokens, accountId: account.id, emailVerified: true };
}

export async function requestPasswordReset(email: string): Promise<string | null> {
  const normalized = normalizeEmail(email);
  const res = await query<{ id: string }>("SELECT id FROM client_accounts WHERE email_normalized = $1", [normalized]);
  if (res.rows.length === 0) return null;
  const token = generateToken();
  await query(
    `INSERT INTO client_email_tokens (account_id, purpose, token_hash, expires_at)
     VALUES ($1, 'reset_password', $2, now() + interval '1 hour')`,
    [res.rows[0].id, sha256(token)]
  );
  return config.EMAIL_VERIFY_RETURN_TOKEN === "true" ? token : null;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (String(newPassword || "").length < 8) throw err(400, "WEAK_PASSWORD", "A senha deve ter no mínimo 8 caracteres.");
  const hash = sha256(token);
  const res = await query<{ account_id: string }>(
    `SELECT account_id FROM client_email_tokens
     WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now()`,
    [hash]
  );
  if (res.rows.length === 0) throw err(400, "INVALID_TOKEN", "Token inválido ou expirado.");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await query(
    `UPDATE client_email_tokens SET used_at = now() WHERE token_hash = $1`,
    [hash]
  );
  await query("UPDATE client_accounts SET password_hash = $2 WHERE id = $1", [res.rows[0].account_id, passwordHash]);
  await query("UPDATE client_account_sessions SET revoked_at = now() WHERE account_id = $1", [res.rows[0].account_id]);
}

export interface PublicAccount {
  id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  authProvider: string;
}

export async function getAccount(accountId: string): Promise<PublicAccount | null> {
  const res = await query<{
    id: string;
    email: string;
    full_name: string;
    email_verified_at: Date | null;
    avatar_url: string | null;
    auth_provider: string;
  }>(
    `SELECT id, email, full_name, email_verified_at, avatar_url, auth_provider
     FROM client_accounts WHERE id = $1`,
    [accountId]
  );
  const a = res.rows[0];
  if (!a) return null;
  return {
    id: a.id,
    email: a.email,
    fullName: a.full_name,
    emailVerified: Boolean(a.email_verified_at),
    avatarUrl: a.avatar_url,
    authProvider: a.auth_provider,
  };
}

export function err(status: number, code: string, message: string): Error & { status: number; code: string } {
  const e = new Error(message) as Error & { status: number; code: string };
  e.status = status;
  e.code = code;
  return e;
}
