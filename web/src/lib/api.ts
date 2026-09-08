/**
 * Cliente HTTP do portal do cliente (kikin-cliente web).
 * Fala com o gateway em /api/v1/accounts/*. Tokens de sessão no localStorage.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PublicAccount {
  id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  authProvider: string; // 'local' | 'google' | 'microsoft'
}

export type SocialProvider = "google" | "microsoft";

export type SocialOutcome =
  | { status: "SUCCESS"; tokens: Tokens; accountId: string; account: PublicAccount }
  | {
      status: "NEED_SETUP";
      tempToken: string;
      socialUser: { email: string; fullName: string; avatarUrl: string | null };
    };

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:3100/api/v1";

export const OAUTH_REDIRECT_PATH = "/auth"; // deve bater com OAUTH_REDIRECT_URI do gateway
export const oauthRedirectUri = () => `${window.location.origin}${OAUTH_REDIRECT_PATH}`;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- sessão

const ACCESS_KEY = "kc_access_token";
const REFRESH_KEY = "kc_refresh_token";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function storeTokens(tokens: Tokens): void {
  localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ---------------------------------------------------------------- request

async function request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Não foi possível falar com o servidor. Verifique sua conexão.", 0, "NETWORK_ERROR");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (data as any)?.code || "ERROR";
    const error = (data as any)?.error || "Ocorreu um erro inesperado.";
    throw new ApiError(error, res.status, code);
  }
  return data as T;
}

// ---------------------------------------------------------------- api

export const api = {
  signup: (body: { email: string; password: string; fullName: string; consent: boolean }) =>
    request<{ accountId: string; email: string; requiresVerification: boolean; verificationToken?: string }>(
      "/accounts/signup",
      { method: "POST", body }
    ),

  verifyEmail: (token: string) => request<{ ok: true }>("/accounts/verify-email", { method: "POST", body: { token } }),

  resendVerification: (email: string) =>
    request<{ ok: true; verificationToken?: string }>("/accounts/resend-verification", { method: "POST", body: { email } }),

  login: (body: { email: string; password: string }) =>
    request<{ tokens: Tokens; accountId: string; emailVerified: boolean }>("/accounts/login", { method: "POST", body }),

  refresh: (refreshToken: string) =>
    request<{ tokens: Tokens }>("/accounts/refresh", { method: "POST", body: { refreshToken }, auth: false }),

  logout: (refreshToken: string) => request<{ ok: true }>("/accounts/logout", { method: "POST", body: { refreshToken }, auth: false }),

  me: () => request<{ account: PublicAccount }>("/accounts/me"),

  social: (provider: SocialProvider, body: { code: string; redirectUri?: string }) =>
    request<SocialOutcome>(`/accounts/${provider}`, { method: "POST", body, auth: false }),

  completeSocial: (body: { tempToken: string; fullName: string; consent: boolean }) =>
    request<{ tokens: Tokens; accountId: string; account: PublicAccount }>("/accounts/social/complete", {
      method: "POST",
      body,
      auth: false,
    }),

  forgotPassword: (email: string) =>
    request<{ ok: true; resetToken?: string }>("/accounts/forgot-password", { method: "POST", body: { email } }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/accounts/reset-password", { method: "POST", body: { token, password } }),
};

// ---------------------------------------------------------------- oauth urls (espelha o Kikin)

export const VITE_GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "";
export const VITE_MICROSOFT_CLIENT_ID = (import.meta.env.VITE_MICROSOFT_CLIENT_ID as string | undefined) || "";

export function googleAuthorizeUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

const OAUTH_STATE_KEY = "kc_oauth_state";

export function microsoftAuthorizeUrl(clientId: string): string {
  const nonce = crypto.randomUUID();
  const state = `microsoft:${nonce}`;
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: oauthRedirectUri(),
    response_mode: "query",
    scope: "openid profile email User.Read",
    prompt: "select_account",
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

export function resolveOAuthCallbackProvider(returnedState: string | null): SocialProvider | "invalid" {
  if (!returnedState || !returnedState.startsWith("microsoft:")) return "google"; // Google não envia state
  const expected = sessionStorage.getItem(OAUTH_STATE_KEY);
  return expected && returnedState === expected ? "microsoft" : "invalid";
}
