import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";
// VAPID configurado (valores sintéticos): endpoints ativos; validações de body acontecem
// antes de qualquer chamada de rede/banco (testes sem rede).

process.env.VAPID_PUBLIC_KEY =
  "BNc4dFkL0ZR5yK5m3pUvQwXy8zA2bCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghijklmnopqrstuvwxyz";
process.env.VAPID_PRIVATE_KEY = "p1v4t3k3y-p1v4t3k3y-p1v4t3k3y-p1v4t3k3y-p1v4t3";
process.env.VAPID_SUBJECT = "mailto:push@kikin.test";

const { createApp } = await import("../index.js");
const { isPushEnabled, getPushPublicKey } = await import("../modules/push/push.service.js");

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY as string;

function token(accountId = "11111111-1111-4111-8111-111111111111"): string {
  return jwt.sign({ sub: accountId, type: "access" }, process.env.JWT_SECRET as string, { expiresIn: "5m" });
}

describe("push Web Push com VAPID configurado (validações sem rede)", () => {
  it("serviço: isPushEnabled=true e chave pública exposta", () => {
    expect(isPushEnabled()).toBe(true);
    expect(getPushPublicKey()).toBe(PUBLIC_KEY);
  });

  it("GET /api/v1/push/public-key é pública e devolve a chave", async () => {
    const res = await request(createApp()).get("/api/v1/push/public-key");
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe(PUBLIC_KEY);
  });

  it("POST /push/subscribe com body vazio responde 400 VALIDATION_ERROR (sem tocar banco)", async () => {
    const res = await request(createApp())
      .post("/api/v1/push/subscribe")
      .set("Authorization", `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /push/subscribe com endpoint inválido responde 400", async () => {
    const res = await request(createApp())
      .post("/api/v1/push/subscribe")
      .set("Authorization", `Bearer ${token()}`)
      .send({ endpoint: "não-é-uma-url", keys: { p256dh: "aaa", auth: "bbb" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /push/subscribe sem as chaves p256dh/auth responde 400", async () => {
    const res = await request(createApp())
      .post("/api/v1/push/subscribe")
      .set("Authorization", `Bearer ${token()}`)
      .send({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("DELETE /push/subscribe sem endpoint responde 400 VALIDATION_ERROR", async () => {
    const res = await request(createApp())
      .delete("/api/v1/push/subscribe")
      .set("Authorization", `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
