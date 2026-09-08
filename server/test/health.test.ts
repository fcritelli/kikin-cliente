import { describe, it, expect } from "vitest";
import request from "supertest";
import crypto from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";

const { buildSignature, canonicalString, signCanonical } = await import(
  "../src/modules/kikin/kikin-client.js"
);
const { createApp } = await import("../src/index.js");

describe("health", () => {
  it("GET /health responde ok", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ service: "kikin-cliente-server", status: "ok" });
  });

  it("rota desconhecida retorna 404 JSON", async () => {
    const res = await request(createApp()).get("/nao-existe");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

describe("Kikin HMAC (ADR-002)", () => {
  const secret = "segredo-teste-32-caracteres!";

  it("gera headers canônicos e assinatura estável (mesmo nonce/timestamp)", () => {
    const opts = {
      method: "GET" as const,
      path: "/clients",
      query: { salon_id: "s1", hash_phone: "abc" },
      scope: { salonIds: ["s1"] },
      serviceId: "client-portal",
      secret,
      timestampMs: 1700000000000,
      nonce: "nonce-fixo-1",
    };
    const a = buildSignature(opts);
    const b = buildSignature(opts);
    expect(a.headers["X-Service-Signature"]).toBe(b.headers["X-Service-Signature"]);
    expect(a.headers["X-Service-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(a.headers["X-Service-Scope"]).toBe(JSON.stringify({ salonIds: ["s1"] }));
  });

  it("canonicalString/assinatura são determinísticas", () => {
    const canonical = canonicalString({
      method: "POST",
      path: "/book",
      canonicalQuery: "",
      bodyHash: crypto.createHash("sha256").update(JSON.stringify({ a: 1 })).digest("hex"),
      serviceId: "client-portal",
      timestamp: "1700000000000",
      nonce: "n1",
      scopeHeader: JSON.stringify({ salonIds: ["s1"] }),
    });
    const sig = signCanonical(canonical, secret);
    expect(sig).toBe(signCanonical(canonical, secret));
    expect(sig.length).toBe(64);
  });
});
