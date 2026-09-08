import jwt from "jsonwebtoken";
import { query, withTransaction } from "../../db.js";
import { config, OAUTH_REDIRECT_URI } from "../../config.js";
import {
  issueSession,
  normalizeEmail,
  err,
  getAccount,
  type SessionTokens,
  type PublicAccount,
} from "./accounts.service.js";

/**
 * Login/cadastro social (Google/Microsoft) no portal do cliente.
 * Padrão espelhado do Kikin (ADR de auth): o web redireciona para o provedor com
 * response_type=code; aqui trocamos o código server-side, validamos a identidade
 * (e-mail verificado pelo provedor) e vinculamos/criamos a conta em client_accounts.
 *
 * LGPD: guardamos apenas o `sub` do provedor como vínculo — o e-mail já é dado
 * funcional do portal; nenhum dado extra do provedor é persistido em claro.
 */

export type SocialProvider = "google" | "microsoft";

export interface SocialProfile {
  providerId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

function assertProviderConfigured(provider: SocialProvider): void {
  const missing =
    provider === "google"
      ? !config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET
      : !config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET;
  if (missing) {
    throw err(503, "OAUTH_NOT_CONFIGURED", `Login com ${provider === "google" ? "Google" : "Microsoft"} não configurado no servidor.`);
  }
}

/** Valida que a URI de retorno usada no authorize é exatamente a registrada. */
function resolveRedirectUri(redirectUri?: string): string {
  const value = (redirectUri || OAUTH_REDIRECT_URI).trim();
  if (value !== OAUTH_REDIRECT_URI) {
    throw err(400, "INVALID_REDIRECT", "URL de retorno não autorizada para o portal.");
  }
  return value;
}

interface GoogleTokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

/** Valida um id_token do Google via tokeninfo (mesmo método do Kikin). */
async function verifyGoogleIdToken(idToken: string): Promise<SocialProfile> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) {
    throw err(401, "INVALID_OAUTH_TOKEN", "Token do Google inválido ou expirado.");
  }
  const info = (await res.json()) as GoogleTokenInfo;
  if (config.GOOGLE_CLIENT_ID && info.aud !== config.GOOGLE_CLIENT_ID) {
    throw err(401, "INVALID_OAUTH_TOKEN", "Token emitido para um cliente Google não autorizado.");
  }
  const emailVerified = info.email_verified === true || info.email_verified === "true";
  if (!info.sub || !info.email || !emailVerified) {
    throw err(401, "INVALID_OAUTH_TOKEN", "O e-mail da sua conta Google não está verificado.");
  }
  const email = normalizeEmail(info.email);
  return {
    providerId: String(info.sub),
    email,
    fullName: String(info.name || email.split("@")[0]).trim() || email.split("@")[0],
    avatarUrl: typeof info.picture === "string" && info.picture ? info.picture : null,
  };
}

/** Troca o código OAuth do Google por um id_token e valida. */
async function verifyGoogleCode(code: string, redirectUri: string): Promise<SocialProfile> {
  assertProviderConfigured("google");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID!,
      client_secret: config.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenData: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.id_token) {
    throw err(401, "INVALID_OAUTH_CODE", tokenData.error_description || "Falha ao validar o código com o Google.");
  }
  return verifyGoogleIdToken(String(tokenData.id_token));
}

interface MicrosoftUserInfo {
  sub?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
}

/** Troca o código OAuth da Microsoft e consulta o userinfo (mesmo método do Kikin). */
async function verifyMicrosoftCode(code: string, redirectUri: string): Promise<SocialProfile> {
  assertProviderConfigured("microsoft");
  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.MICROSOFT_CLIENT_ID!,
      client_secret: config.MICROSOFT_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: "openid profile email User.Read",
    }),
  });
  const tokenData: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw err(401, "INVALID_OAUTH_CODE", tokenData.error_description || "Falha ao validar o código com a Microsoft.");
  }
  const userInfoRes = await fetch("https://graph.microsoft.com/oidc/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userInfo: MicrosoftUserInfo = await userInfoRes.json().catch(() => ({}));
  if (!userInfoRes.ok || !userInfo.sub) {
    throw err(401, "INVALID_OAUTH_TOKEN", "Não foi possível validar a identidade Microsoft.");
  }
  const rawEmail = userInfo.email || userInfo.preferred_username || "";
  if (!rawEmail) {
    throw err(401, "INVALID_OAUTH_TOKEN", "A conta Microsoft não forneceu um e-mail válido.");
  }
  const email = normalizeEmail(rawEmail);
  return {
    providerId: String(userInfo.sub),
    email,
    fullName: String(userInfo.name || email.split("@")[0]).trim() || email.split("@")[0],
    avatarUrl: null,
  };
}

/** Ponto de entrada do OAuth: valida código/credential e retorna o profile do provedor. */
export async function verifyProvider(
  provider: SocialProvider,
  input: { code?: string; credential?: string; redirectUri?: string }
): Promise<SocialProfile> {
  const redirectUri = resolveRedirectUri(input.redirectUri);
  if (provider === "google") {
    if (input.credential) return verifyGoogleIdToken(input.credential);
    if (!input.code) throw err(400, "VALIDATION_ERROR", "Código OAuth obrigatório.");
    return verifyGoogleCode(input.code, redirectUri);
  }
  if (!input.code) throw err(400, "VALIDATION_ERROR", "Código OAuth obrigatório.");
  return verifyMicrosoftCode(input.code, redirectUri);
}

export type SocialLoginOutcome =
  | { status: "SUCCESS"; tokens: SessionTokens; accountId: string; account: PublicAccount }
  | { status: "NEED_SETUP"; tempToken: string; socialUser: { email: string; fullName: string; avatarUrl: string | null } };

/**
 * Login social: se já existe conta ativa pelo provider_id OU pelo e-mail, vincula o
 * provedor (quando for o 1º acesso social) e entra (SUCCESS). Se não existe conta,
 * devolve NEED_SETUP com tempToken (15min) para a etapa pós-OAuth (nome + termos).
 */
export async function socialLoginOrSetup(
  provider: SocialProvider,
  profile: SocialProfile,
  ctx: { ip?: string | null; userAgent?: string | null }
): Promise<SocialLoginOutcome> {
  const idColumn = provider === "google" ? "google_id" : "microsoft_id";
  const existing = await query<{ id: string; is_active: boolean }>(
    `SELECT id, is_active FROM client_accounts
     WHERE ${idColumn} = $1 OR email_normalized = $2
     LIMIT 1`,
    [profile.providerId, profile.email]
  );
  const account = existing.rows[0];

  if (account && account.is_active) {
    if (profile.avatarUrl) {
      await query(
        `UPDATE client_accounts SET
           ${idColumn} = COALESCE(${idColumn}, $1),
           avatar_url = COALESCE(avatar_url, $3),
           auth_provider = CASE WHEN auth_provider = 'local' THEN $2 ELSE auth_provider END,
           email_verified_at = COALESCE(email_verified_at, now()),
           updated_at = now()
         WHERE id = $4`,
        [profile.providerId, provider, profile.avatarUrl, account.id]
      );
    } else {
      await query(
        `UPDATE client_accounts SET
           ${idColumn} = COALESCE(${idColumn}, $1),
           auth_provider = CASE WHEN auth_provider = 'local' THEN $2 ELSE auth_provider END,
           email_verified_at = COALESCE(email_verified_at, now()),
           updated_at = now()
         WHERE id = $3`,
        [profile.providerId, provider, account.id]
      );
    }
    const tokens = await issueSession(account.id, ctx);
    const publicAccount = await getAccount(account.id);
    return { status: "SUCCESS", tokens, accountId: account.id, account: publicAccount! };
  }

  // Conta inexistente (ou desativada): mini passo pós-OAuth (nome + aceite de termos).
  const tempToken = jwt.sign(
    {
      action: "client_social_signup_pending",
      provider,
      providerId: profile.providerId,
      email: profile.email,
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl,
    },
    config.JWT_SECRET,
    { expiresIn: "15m" }
  );

  return {
    status: "NEED_SETUP",
    tempToken,
    socialUser: { email: profile.email, fullName: profile.fullName, avatarUrl: profile.avatarUrl },
  };
}

/** Etapa pós-OAuth: cria a conta do cliente com dados validados pelo provedor. */
export async function completeSocialSignup(input: {
  tempToken: string;
  fullName: string;
  consent: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ tokens: SessionTokens; accountId: string; account: PublicAccount }> {
  let decoded: any;
  try {
    decoded = jwt.verify(input.tempToken, config.JWT_SECRET);
  } catch {
    throw err(401, "TEMP_TOKEN_EXPIRED", "Sessão temporária expirada. Faça o login com o provedor novamente.");
  }
  if (
    decoded.action !== "client_social_signup_pending" ||
    !decoded.providerId ||
    !decoded.email ||
    (decoded.provider !== "google" && decoded.provider !== "microsoft")
  ) {
    throw err(400, "INVALID_TOKEN", "Token de cadastro temporário inválido.");
  }
  if (input.consent !== true) {
    throw err(400, "CONSENT_REQUIRED", "É necessário aceitar os termos/privacidade.");
  }
  const email = normalizeEmail(String(decoded.email));
  const fullName = String(input.fullName || "").trim();
  if (fullName.length < 2) throw err(400, "VALIDATION_ERROR", "Informe seu nome.");
  const provider = decoded.provider as SocialProvider;
  const idColumn = provider === "google" ? "google_id" : "microsoft_id";

  const accountId = await withTransaction(async (client) => {
    const dup = await client.query("SELECT id FROM client_accounts WHERE email_normalized = $1", [email]);
    if (dup.rows.length > 0) {
      throw err(409, "EMAIL_ALREADY_EXISTS", "Este e-mail já possui conta. Entre com e-mail e senha.");
    }
    const ins = await client.query<{ id: string }>(
      `INSERT INTO client_accounts
         (email, email_normalized, password_hash, full_name, email_verified_at,
          consent_terms_at, ${idColumn}, avatar_url, auth_provider)
       VALUES ($1, $2, NULL, $3, now(), now(), $4, $5, $6)
       RETURNING id`,
      [email, email, fullName, decoded.providerId, decoded.avatarUrl || null, provider]
    );
    return ins.rows[0].id;
  });

  const tokens = await issueSession(accountId, { ip: input.ip, userAgent: input.userAgent });
  const account = await getAccount(accountId);
  return { tokens, accountId, account: account! };
}
