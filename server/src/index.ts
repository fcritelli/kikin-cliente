import express from "express";
import { config } from "./config.js";
import { globalApiLimiter } from "./middleware/rate-limit.js";
import accountsRoutes from "./modules/accounts/accounts.routes.js";

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
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_req, res) => {
    res.json({ service: "kikin-cliente-server", status: "ok", time: new Date().toISOString() });
  });
  app.use("/api/v1", globalApiLimiter);
  app.use("/api/v1/accounts", accountsRoutes);
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
