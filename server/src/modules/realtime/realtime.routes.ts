import { Router, type Request, type Response } from "express";
import { query } from "../../db.js";
import { requireAuth } from "../../middleware/auth.js";
import { subscribeRealtimeEvents } from "./realtime.service.js";

/**
 * SSE para o navegador do portal.
 *
 * GET /api/v1/realtime/events  (Bearer do cliente)
 *
 * Entrega apenas eventos dos salões aos quais a conta está vinculada
 * (account_establishment_links). A lista de salões é atualizada a cada 45s
 * enquanto a conexão estiver aberta — novo vínculo passa a valer sem reconectar.
 */
const router = Router();

const REFRESH_ALLOWED_MS = 45_000;

async function allowedSalonIds(accountId: string): Promise<Set<string>> {
  const res = await query<{ salonId: string }>(
    `SELECT salon_id AS "salonId" FROM account_establishment_links WHERE account_id = $1`,
    [accountId]
  );
  return new Set(res.rows.map((r) => r.salonId));
}

router.get("/events", requireAuth, async (req: Request, res: Response) => {
  const accountId = (req as any).account.accountId as string;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 2000\n\n");

  let allowed = new Set<string>();
  try {
    allowed = await allowedSalonIds(accountId);
  } catch (err) {
    console.error("[realtime] Falha ao carregar vínculos:", err);
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const write = (chunk: string) => {
    if (!closed) {
      try {
        res.write(chunk);
      } catch {
        cleanup();
      }
    }
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
    if (refreshTimer) clearInterval(refreshTimer);
  };

  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (allowed.has(event.salonId)) {
      write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });

  heartbeat = setInterval(() => write(": ping\n\n"), 25_000);
  refreshTimer = setInterval(async () => {
    try {
      allowed = await allowedSalonIds(accountId);
    } catch {
      // mantém a lista anterior
    }
  }, REFRESH_ALLOWED_MS);

  req.on("close", cleanup);
});

export default router;
