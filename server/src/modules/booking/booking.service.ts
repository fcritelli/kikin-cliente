import { config } from "../../config.js";

/**
 * Proxy para o booking PÚBLICO do Kikin (mesmos endpoints usados pelo /agendar/:slug do Kikin:
 * GET /booking/:slug/salon|services|staff|slots|holiday e POST /booking/:slug/book).
 * O Kikin continua dono da agenda/catálogo; o portal apenas reusa o contrato público.
 */

class KikinPublicError extends Error {
  constructor(message: string, public status: number, public code?: string, public payload?: any) {
    super(message);
  }
}

async function proxyJson(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<any> {
  const base = config.KIKIN_PUBLIC_URL.replace(/\/$/, "");
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new KikinPublicError(
      data?.error || data?.message || `Kikin respondeu ${res.status}`,
      res.status,
      data?.code,
      data
    );
  }
  return data;
}

export function publicErrorToHttp(err: any): { status: number; code: string; error: string; payload?: any } {
  const e = err as KikinPublicError;
  return {
    status: e?.status || 500,
    code: e?.code || (e?.status ? `KIKIN_HTTP_${e.status}` : "KIKIN_UNREACHABLE"),
    error: e?.message || "Não foi possível falar com o serviço de agendamento.",
    ...(e?.payload ? { payload: e.payload } : {}),
  };
}

export const bookingProxy = {
  getSalon: (slug: string) => proxyJson("GET", `/booking/${encodeURIComponent(slug)}/salon`),
  getServices: (slug: string) => proxyJson("GET", `/booking/${encodeURIComponent(slug)}/services`),
  getStaff: (slug: string, serviceIds?: string[]) =>
    proxyJson("GET", `/booking/${encodeURIComponent(slug)}/staff` + (serviceIds?.length ? `?serviceIds=${encodeURIComponent(serviceIds.join(","))}` : "")),
  getSlots: (slug: string, params: { date: string; serviceIds: string[]; staffId?: string | null }) => {
    const qs = new URLSearchParams({ date: params.date, serviceIds: params.serviceIds.join(",") });
    if (params.staffId) qs.set("staffId", params.staffId);
    return proxyJson("GET", `/booking/${encodeURIComponent(slug)}/slots?${qs.toString()}`);
  },
  getHoliday: (slug: string, date: string) =>
    proxyJson("GET", `/booking/${encodeURIComponent(slug)}/holiday?date=${encodeURIComponent(date)}`),
  book: (slug: string, body: any) => proxyJson("POST", `/booking/${encodeURIComponent(slug)}/book`, body),
};
