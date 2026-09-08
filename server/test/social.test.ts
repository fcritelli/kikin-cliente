import { describe, it, expect } from "vitest";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";
// Sem GOOGLE/MICROSOFT_CLIENT_ID/…: o fluxo social deve falhar com 503 OAUTH_NOT_CONFIGURED
// antes de qualquer chamada de rede ou banco.

const { createApp } = await import("../src/index.js");

describe("auth social (sem credenciais OAuth configuradas)", () => {
  it("POST /accounts/google sem client ID configurado responde 503 OAUTH_NOT_CONFIGURED", async () => {
    const res = await request(createApp())
      .post("/api/v1/accounts/google")
      .send({ code: "codigo-qualquer" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("OAUTH_NOT_CONFIGURED");
  });

  it("POST /accounts/microsoft sem client ID configurado responde 503 OAUTH_NOT_CONFIGURED", async () => {
    const res = await request(createApp())
      .post("/api/v1/accounts/microsoft")
      .send({ code: "codigo-qualquer", redirectUri: "http://localhost:5174/auth" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("OAUTH_NOT_CONFIGURED");
  });

  it("POST /accounts/google sem código responde 400 VALIDATION_ERROR", async () => {
    const res = await request(createApp()).post("/api/v1/accounts/google").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /accounts/social/complete com tempToken inválido responde 401 TEMP_TOKEN_EXPIRED", async () => {
    const res = await request(createApp())
      .post("/api/v1/accounts/social/complete")
      .send({ tempToken: "token-invalido-1234567890", fullName: "Fulano", consent: true });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TEMP_TOKEN_EXPIRED");
  });

  it("POST /accounts/social/complete sem consentimento responde 400 (validação do schema)", async () => {
    const res = await request(createApp())
      .post("/api/v1/accounts/social/complete")
      .send({ tempToken: "x".repeat(20), fullName: "Fulano", consent: false });
    expect(res.status).toBe(400);
  });
});
