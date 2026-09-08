import { describe, it, expect } from "vitest";
import { normalizePhoneBR, hashPhoneBR, maskPhoneBR } from "../src/utils/phone.js";

const SALT = "dev-secret-client-portal";

// Vetor compartilhado com kikin server/src/utils/phone.ts — qualquer mudança de
// normalização/hash precisa atualizar os DOIS lados (senão o claim nunca casa).
const VECTOR_PHONE = "(11) 98765-4321";
const VECTOR_NORMALIZED = "5511987654321";
const VECTOR_HASH = "de1cccf9498daea17ffc1b4e65c12b27b67f66a90b3361d7285f8b8849f55a16";

describe("phone util (ADR-001, espelho do Kikin)", () => {
  it("normaliza telefone BR com DDD implícito", () => {
    expect(normalizePhoneBR(VECTOR_PHONE)).toBe(VECTOR_NORMALIZED);
    expect(normalizePhoneBR("+55 (11) 98765-4321")).toBe(VECTOR_NORMALIZED);
    expect(normalizePhoneBR("11987654321")).toBe(VECTOR_NORMALIZED);
    expect(normalizePhoneBR("(11) 8765-4321")).toBe("551187654321");
    expect(normalizePhoneBR("abc")).toBe("");
  });

  it("hash é determinístico e bate com o vetor compartilhado do Kikin", () => {
    expect(hashPhoneBR(VECTOR_PHONE, SALT)).toBe(VECTOR_HASH);
    expect(hashPhoneBR("+5511987654321", SALT)).toBe(VECTOR_HASH);
    expect(hashPhoneBR("", SALT)).toBeNull();
  });

  it("mascara sem expor o número completo", () => {
    expect(maskPhoneBR(VECTOR_PHONE)).toBe("(11) ****-4321");
    expect(maskPhoneBR("abc")).toBeNull();
  });
});
