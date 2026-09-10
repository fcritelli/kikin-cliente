import express from "express";
import { config, CORS_ORIGINS } from "./config.js";
import { globalApiLimiter } from "./middleware/rate-limit.js";
import accountsRoutes from "./modules/accounts/accounts.routes.js";
import linksRoutes from "./modules/links/links.routes.js";
import bookingRoutes from "./modules/booking/booking.routes.js";
import realtimeRoutes from "./modules/realtime/realtime.routes.js";
import pushRoutes from "./modules/push/push.routes.js";
import lgpdRoutes from "./modules/lgpd/lgpd.routes.js";

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  // CORS restrito ao(s) origem(ns) do portal (CLIENT_APP_URL / CORS_ORIGINS)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      // Sem expor este header o navegador não lê o nome do arquivo no download do
      // export LGPD (Content-Disposition) quando o portal está em outra origem.
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_req, res) => {
    res.json({ service: "kikin-cliente-server", status: "ok", time: new Date().toISOString() });
  });
  app.use("/api/v1", globalApiLimiter);
  app.use("/api/v1/accounts", accountsRoutes);
  // LGPD Art. 18 do titular: export e exclusão da conta do portal (/accounts/me/export|delete).
  app.use("/api/v1/accounts", lgpdRoutes);
  app.use("/api/v1/links", linksRoutes);
  app.use("/api/v1/booking", bookingRoutes);
  app.use("/api/v1/realtime", realtimeRoutes);
  app.use("/api/v1/push", pushRoutes);
  app.use((_req, res) => {
    res.status(404).json({ error: `Rota não encontrada: ${_req.method} ${_req.originalUrl}` });
  });
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[kikin-cliente] Erro:", err);
    res.status(err.status || 500).json({ code: err.code || "INTERNAL", error: "Erro interno" });
  });
  return app;
}

export const app = createApp();
export { config };
