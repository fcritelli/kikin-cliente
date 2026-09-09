import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";
// Sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT: o Web Push deve ficar DESABILITADO —
// endpoints respondem 503 PUSH_NOT_CONFIGURED e enviar é no-op seguro (sem rede/banco).

const { createApp } = await import("../index.js");
const { isPushEnabled, getPushPublicKey, pushToAccount } = await import("../modules/push/push.service.js");

function token(accountId = "11111111-1111-4111-8111-111111111111"): string {
  return jwt.sign({ sub: accountId, type: "access" }, process.env.JWT_SECRET as string, { expiresIn: "5m" });
}

describe("push Web Push sem VAPID configurado (recurso desabilitado)", () => {
  it("serviço: isPushEnabled=false e sem chave pública", () => {
    expect(isPushEnabled()).toBe(false);
    expect(getPushPublicKey()).toBeNull();
  });

  it("envio é no-op seguro: pushToAccount resolve 0 sem tocar rede/banco", async () => {
    const sent = await pushToAccount("11111111-1111-4111-8111-111111111111", {
      title: "Horário confirmado",
      body: "teste",
      url: "/conta",
    });
    expect(sent).toBe(0);
  });

  it("GET /api/v1/push/public-key (pública) responde 503 PUSH_NOT_CONFIGURED", async () => {
    const res = await request(createApp()).get("/api/v1/push/public-key");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("PUSH_NOT_CONFIGURED");
  });

  it("POST /push/subscribe sem token responde 401 (requireAuth antes de tudo)", async () => {
    const res = await request(createApp()).post("/api/v1/push/subscribe").send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("POST /push/subscribe autenticado responde 503 (recurso desabilitado; não toca banco)", async () => {
    const res = await request(createApp())
      .post("/api/v1/push/subscribe")
      .set("Authorization", `Bearer ${token()}`)
      .send({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x", auth: "y" } });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("PUSH_NOT_CONFIGURED");
  });

  it("DELETE /push/subscribe sem token responde 401; autenticado responde 503", async () => {
    const anon = await request(createApp()).delete("/api/v1/push/subscribe").send({ endpoint: "https://x" });
    expect(anon.status).toBe(401);
    const auth = await request(createApp())
      .delete("/api/v1/push/subscribe")
      .set("Authorization", `Bearer ${token()}`)
      .send({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" });
    expect(auth.status).toBe(503);
    expect(auth.body.code).toBe("PUSH_NOT_CONFIGURED");
  });

  it("token inválido responde 401 UNAUTHORIZED", async () => {
    const res = await request(createApp())
      .post("/api/v1/push/subscribe")
      .set("Authorization", "Bearer token-invalido")
      .send({});
    expect(res.status).toBe(401);
  });
});
