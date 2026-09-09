import webpush from "web-push";
import { query } from "../../db.js";
import { config } from "../../config.js";

/**
 * Notificações por Web Push (VAPID) — avisos no celular/desktop do cliente mesmo com a
 * aba do portal fechada.
 *
 * Recurso opcional: sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT no ambiente ele
 * fica DESABILITADO — isPushEnabled() é false, getPushPublicKey() é null, os endpoints
 * respondem 503 PUSH_NOT_CONFIGURED e pushToAccount() é um no-op seguro.
 *
 * Envio SEMPRE fail-soft: nunca derruba o fluxo de negócio. Quando o provedor de push
 * responde 404/410/403 (endpoint expirado/revogado/desautorizado) a inscrição é removida
 * automaticamente do banco.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Rota relativa do portal aberta no clique (ex.: "/conta"). */
  url?: string;
}

export interface StoredPushSubscription {
  id: string;
  accountId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
}

/** Recurso habilitado? Exige as três variáveis VAPID. */
export function isPushEnabled(): boolean {
  return Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT);
}

/** Chave pública VAPID (base64url) para o navegador assinar; null quando desabilitado. */
export function getPushPublicKey(): string | null {
  if (!isPushEnabled()) return null;
  return config.VAPID_PUBLIC_KEY as string;
}

let vapidConfigured = false;
function configureVapid(): void {
  if (vapidConfigured || !isPushEnabled()) return;
  webpush.setVapidDetails(
    config.VAPID_SUBJECT as string,
    config.VAPID_PUBLIC_KEY as string,
    config.VAPID_PRIVATE_KEY as string
  );
  vapidConfigured = true;
}

export interface SaveSubscriptionInput {
  accountId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/** Upsert por endpoint (unique): mesma inscrição do navegador nunca duplica. */
export async function saveSubscription(
  input: SaveSubscriptionInput
): Promise<StoredPushSubscription> {
  const res = await query<StoredPushSubscription>(
    `INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET account_id = EXCLUDED.account_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent
     RETURNING id, account_id AS "accountId", endpoint, p256dh, auth, user_agent AS "userAgent",
               created_at AS "createdAt"`,
    [input.accountId, input.endpoint, input.p256dh, input.auth, input.userAgent || null]
  );
  return res.rows[0];
}

/** Remove a inscrição (ex.: ação do usuário ou endpoint expirado). Idempotente. */
export async function removeSubscription(input: {
  accountId: string;
  endpoint: string;
}): Promise<boolean> {
  const res = await query(
    `DELETE FROM push_subscriptions WHERE endpoint = $1 AND account_id = $2`,
    [input.endpoint, input.accountId]
  );
  return (res.rowCount ?? 0) > 0;
}

async function removeByEndpoint(endpoint: string): Promise<void> {
  try {
    await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  } catch (err) {
    console.error("[push] falha ao remover inscrição inválida:", (err as Error)?.message || err);
  }
}

/**
 * Envia uma notificação para todas as inscrições da conta. SEMPRE fail-soft:
 *  - recurso desabilitado ⇒ no-op (0);
 *  - erro de banco/provedor ⇒ loga e segue;
 *  - 404/410/403 ⇒ remove a inscrição local (o navegador já a revogou/expirou).
 * Retorna quantas inscrições receberam a notificação com sucesso.
 */
export async function pushToAccount(
  accountId: string,
  message: PushMessage
): Promise<number> {
  if (!isPushEnabled()) return 0;
  let sent = 0;
  try {
    configureVapid();
    const res = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = $1`,
      [accountId]
    );
    for (const sub of res.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(message),
          { TTL: 60 * 60 * 24 } // 24h de vida útil (cliente pode estar offline)
        );
        sent += 1;
      } catch (err: any) {
        const status = Number(err?.statusCode || 0);
        if (status === 404 || status === 410 || status === 403) {
          // Endpoint não existe mais no provedor (expirou/revogado/desautorizado).
          await removeByEndpoint(sub.endpoint);
        } else {
          console.error(`[push] falha no envio (HTTP ${status || "n/a"}):`, err?.message || err);
        }
      }
    }
    return sent;
  } catch (err: any) {
    // Banco indisponível etc. nunca derruba o fluxo de negócio.
    console.error("[push] pushToAccount falhou (fail-soft):", err?.message || err);
    return 0;
  }
}
