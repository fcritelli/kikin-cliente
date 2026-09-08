import { describe, it, expect } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";
process.env.WHATSAPP_PROVIDER = "log";

const { encryptPhone, decryptPhone, providerName } = await import("../src/services/whatsapp/whatsapp.service.js");

describe("whatsapp.service (estrutura plugável; LGPD)", () => {
  it("cifra/decripta o número em repouso (nunca texto plano no banco)", () => {
    const enc = encryptPhone("(11) 98765-4321");
    expect(enc).not.toContain("987654321");
    expect(enc.split(".")).toHaveLength(3);
    expect(decryptPhone(enc)).toBe("5511987654321");
  });

  it("decript de payload inválido retorna null (sem crash)", () => {
    expect(decryptPhone("x.y.z")).toBeNull();
    expect(decryptPhone(null)).toBeNull();
  });

  it("provedor default em dev é 'log'", () => {
    expect(providerName()).toBe("log");
  });
});
