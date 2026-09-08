import crypto from "node:crypto";

/**
 * Normalização + hash LGPD de telefone para o vínculo (ADR-001).
 *
 * REGRA DE OURO: espelho do kikin server/src/utils/phone.ts. Alterações precisam
 * ser replicadas nos dois lados, senão o claim nunca casa.
 * hash = HMAC-SHA256(salt, telefone_normalizado); salt = KIKIN_CLIENT_PORTAL_SECRET
 * (compartilhado entre gateway e Kikin — mesmo valor usado na assinatura HMAC ADR-002).
 */
export function normalizePhoneBR(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) {
    if (digits.length === 12 || digits.length === 13) return digits;
    return digits.slice(2);
  }
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function hashPhoneBR(raw: string | null | undefined, salt?: string): string | null {
  const normalized = normalizePhoneBR(raw);
  if (!normalized) return null;
  if (salt) {
    return crypto.createHmac("sha256", salt).update(normalized).digest("hex");
  }
  return crypto.createHash("sha256").update(`kikin:${normalized}`).digest("hex");
}

export function maskPhoneBR(raw: string | null | undefined): string | null {
  const normalized = normalizePhoneBR(raw);
  if (!normalized) return null;
  const local = normalized.startsWith("55") ? normalized.slice(2) : normalized;
  if (local.length >= 10) return `(${local.slice(0, 2)}) ****-${local.slice(-4)}`;
  return `****-${local.slice(-4)}`;
}
