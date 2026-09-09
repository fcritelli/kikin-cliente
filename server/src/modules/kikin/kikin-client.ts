import crypto from "node:crypto";
import { config } from "../../config.js";

/**
 * Cliente HTTP para os endpoints INTERNOS do Kikin usados pelo portal (ADR-002).
 * Mesmo esquema seguro do kikin-admin: HMAC-SHA256 da string canônica com
 * service-id + timestamp + nonce + escopo assinado (salões) — nunca bearer simples.
 */

export interface KikinScope {
  salonIds: string[];
}

export interface KikinClientOptions {
  baseUrl?: string;
  serviceId?: string;
  secret?: string;
  traceId?: string;
}

export function canonicalString(input: {
  method: string;
  path: string;
  canonicalQuery: string;
  bodyHash: string;
  serviceId: string;
  timestamp: string;
  nonce: string;
  scopeHeader: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.canonicalQuery,
    input.bodyHash,
    input.serviceId,
    input.timestamp,
    input.nonce,
    input.scopeHeader,
  ].join(":");
}

export function signCanonical(canonical: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export function buildSignature(input: {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  scope: KikinScope;
  serviceId?: string;
  secret?: string;
  timestampMs?: number;
  nonce?: string;
}): {
  headers: Record<string, string>;
  scopeHeader: string;
} {
  const serviceId = input.serviceId || config.KIKIN_CLIENT_PORTAL_ID;
  const secret = input.secret || config.KIKIN_CLIENT_PORTAL_SECRET;
  const timestamp = String(input.timestampMs ?? Date.now());
  const nonce = input.nonce ?? crypto.randomUUID();
  const scopeHeader = JSON.stringify(input.scope);
  const canonicalQuery = input.query
    ? Object.keys(input.query).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(input.query![k])}`).join("&")
    : "";
  const bodyHash = input.body === undefined
    ? crypto.createHash("sha256").update("").digest("hex")
    : crypto.createHash("sha256").update(JSON.stringify(input.body)).digest("hex");
  const canonical = canonicalString({
    method: input.method,
    path: input.path,
    canonicalQuery,
    bodyHash,
    serviceId,
    timestamp,
    nonce,
    scopeHeader,
  });
  const signature = signCanonical(canonical, secret);
  return {
    headers: {
      "X-Service-Id": serviceId,
      "X-Service-Timestamp": timestamp,
      "X-Service-Nonce": nonce,
      "X-Service-Scope": scopeHeader,
      "X-Service-Signature": signature,
      "Content-Type": "application/json",
    },
    scopeHeader,
  };
}

export class KikinPortalClient {
  constructor(private readonly options: KikinClientOptions = {}) {}

  private baseUrl(): string {
    return (this.options.baseUrl || config.KIKIN_API_URL).replace(/\/$/, "");
  }

  private traceId(): string | undefined {
    return this.options.traceId || undefined;
  }

  async request(input: {
    method?: "GET" | "POST" | "DELETE";
    path: string;
    query?: Record<string, string>;
    body?: unknown;
    scope: KikinScope;
  }): Promise<any> {
    const { headers } = buildSignature({
      method: input.method || "GET",
      path: input.path,
      query: input.query,
      body: input.body,
      scope: input.scope,
    });
    const qs = input.query
      ? "?" + Object.keys(input.query).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(input.query![k])}`).join("&")
      : "";
    const trace = this.traceId();
    if (trace) headers["X-Trace-Id"] = trace;

    const res = await fetch(this.baseUrl() + input.path + qs, {
      method: input.method || "GET",
      headers,
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const code = data?.code || `HTTP_${res.status}`;
      const message = data?.error || data?.message || `Kikin interno respondeu ${res.status}`;
      const error = new Error(message) as Error & { status?: number; code?: string; detail?: any };
      error.status = res.status;
      error.code = code;
      if (data?.detail) error.detail = data.detail;
      throw error;
    }
    return data;
  }

  /** Candidatos de cliente por hash de telefone em TODOS os salões (claim — ADR-001). */
  searchClientsByHash(hashPhone: string) {
    return this.request({
      path: "/clients/search",
      query: { hash_phone: hashPhone },
      scope: { salonIds: [] },
    });
  }

  /** Metadados dos estabelecimentos (id/nome) — usados para exibir nomes nos vínculos. */
  listSalons() {
    return this.request({
      path: "/salons",
      scope: { salonIds: [] },
    });
  }

  listAppointments(input: { salonId: string; clientId: string; future?: boolean }) {
    return this.request({
      path: "/appointments",
      query: {
        salon_id: input.salonId,
        client_id: input.clientId,
        future: input.future === false ? "false" : "true",
      },
      scope: { salonIds: [input.salonId] },
    });
  }

  /** Agenda para o client vinculado (portal único método — sem telefone). */
  bookForClient(input: { salonId: string; clientId: string; serviceIds: string[]; staffId?: string | null; startAt: string; holdToken?: string | null }) {
    return this.request({
      method: "POST",
      path: "/book",
      body: {
        salonId: input.salonId,
        clientId: input.clientId,
        serviceIds: input.serviceIds,
        staffId: input.staffId || null,
        startAt: input.startAt,
        holdToken: input.holdToken || null,
      },
      scope: { salonIds: [input.salonId] },
    });
  }

  /** Reserva temporária (3 min) ao selecionar horário — bloqueia outros clientes/secretária. */
  createHold(input: { salonId: string; staffId: string; serviceIds: string[]; startAt: string }) {
    return this.request({
      method: "POST",
      path: "/holds",
      body: { salonId: input.salonId, staffId: input.staffId, serviceIds: input.serviceIds, startAt: input.startAt },
      scope: { salonIds: [input.salonId] },
    });
  }

  releaseHold(token: string) {
    return this.request({
      method: "DELETE",
      path: "/holds",
      body: { token },
      scope: { salonIds: [] },
    });
  }

  cancel(input: { salonId: string; appointmentId: string; clientId: string }) {
    return this.request({
      method: "POST",
      path: "/cancel",
      body: { salonId: input.salonId, appointmentId: input.appointmentId, clientId: input.clientId },
      scope: { salonIds: [input.salonId] },
    });
  }

  reschedule(input: { salonId: string; appointmentId: string; clientId: string; staffId?: string | null; startAt: string }) {
    return this.request({
      method: "POST",
      path: "/reschedule",
      body: {
        salonId: input.salonId,
        appointmentId: input.appointmentId,
        clientId: input.clientId,
        staffId: input.staffId || null,
        startAt: input.startAt,
      },
      scope: { salonIds: [input.salonId] },
    });
  }
}
