import { describe, it, expect } from "vitest";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";

const { createApp } = await import("../src/index.js");

describe("booking (proxy do booking público do Kikin)", () => {
  it("POST /booking/:slug/book sem dados válidos responde 400 VALIDATION_ERROR (sem chamar o Kikin)", async () => {
    const res = await request(createApp()).post("/api/v1/booking/qualquer-slug/book").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /booking/:slug/slots sem data/serviços responde 400 (sem chamar o Kikin)", async () => {
    const res = await request(createApp()).get("/api/v1/booking/qualquer-slug/slots").query({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /booking/:slug/book com campos inválidos não passa da validação", async () => {
    const res = await request(createApp())
      .post("/api/v1/booking/x/book")
      .send({ serviceIds: [], startAt: "x", clientName: "A", clientPhone: "1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
