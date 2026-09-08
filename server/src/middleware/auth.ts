import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AccountPrincipal {
  accountId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ code: "UNAUTHORIZED", error: "Token de autenticação ausente." });
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as { sub?: string; type?: string };
    if (payload.type !== "access" || !payload.sub) {
      throw new Error("invalid token type");
    }
    (req as any).account = { accountId: payload.sub } satisfies AccountPrincipal;
    next();
  } catch {
    res.status(401).json({ code: "UNAUTHORIZED", error: "Sessão inválida ou expirada." });
  }
}
