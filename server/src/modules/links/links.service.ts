import { query, withTransaction } from "../../db.js";
import { config } from "../../config.js";
import { decryptPhone, sendWhatsApp } from "../../services/whatsapp/whatsapp.service.js";
import { err } from "../accounts/accounts.service.js";
import { KikinPortalClient } from "../kikin/kikin-client.js";
import { hashPhoneBR, maskPhoneBR, normalizePhoneBR } from "../../utils/phone.js";

/**
 * Vínculo conta do portal ↔ client(s) do Kikin por estabelecimento (ADR-001).
 *
 * Claim: o cliente informa o telefone; o gateway normaliza e envia só o HASH ao Kikin;
 * o Kikin devolve candidatos MASCARADOS; o cliente confirma ("sou eu") e gravamos o
 * vínculo account_establishment_links (nunca o telefone em claro — só hash + máscara).
 */

export interface SalonInfo {
  id: string;
  name: string;
  slug: string;
  phone?: string | null;
}

export interface ClientCandidate {
  clientId: string;
  salonId: string;
  salonName: string;
  name: string;
  phoneMask: string;
}

export interface EstablishmentLink {
  id: string;
  salonId: string;
  salonName?: string;
  kikinClientId: string;
  clientName: string;
  phoneMask: string;
  confirmedAt: string;
  whatsappOptInAt: string | null;
}

export interface FutureAppointment {
  id: string;
  groupId: string | null;
  salonId: string;
  salonName?: string;
  serviceId: string | null;
  staffId: string | null;
  startAt: string;
  endAt: string;
  status: string;
  serviceName: string | null;
  staffName: string | null;
  durationMin: number | null;
}

function newKikin(): KikinPortalClient {
  return new KikinPortalClient();
}

export async function listSalons(): Promise<SalonInfo[]> {
  const data = await newKikin().listSalons();
  const salons: any[] = Array.isArray(data?.salons) ? data.salons : [];
  return salons.map((s) => ({ id: String(s.id), name: String(s.name), slug: String(s.slug || ""), phone: s.phone ? String(s.phone) : null }));
}

/**
 * Busca candidatos mascarados pelo telefone em TODOS os salões que participam da área
 * do cliente (decisão de produto: todos). O telefone nunca sai do gateway — só o hash.
 */
export async function searchCandidates(input: { phone: string }): Promise<ClientCandidate[]> {
  const normalized = normalizePhoneBR(input.phone);
  if (!normalized) {
    throw err(400, "INVALID_PHONE", "Informe um telefone válido.");
  }
  const hash = hashPhoneBR(normalized, config.KIKIN_CLIENT_PORTAL_SECRET)!;
  const data = await newKikin().searchClientsByHash(hash);
  const candidates: any[] = Array.isArray(data?.candidates) ? data.candidates : [];
  return candidates.map((c) => ({
    clientId: String(c.clientId),
    salonId: String(c.salonId),
    salonName: String(c.salonName || ""),
    name: String(c.name || ""),
    phoneMask: String(c.phoneMask || maskPhoneBR(normalized) || ""),
  }));
}

async function getLinkRow(id: string) {
  const res = await query<EstablishmentLink>(
    `SELECT id, salon_id AS "salonId", kikin_client_id AS "kikinClientId",
            client_name AS "clientName", phone_masked AS "phoneMask", confirmed_at AS "confirmedAt",
            whatsapp_optin_at AS "whatsappOptInAt"
     FROM account_establishment_links WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

/** Confirmação do candidato: revalida pelo hash no Kikin e grava o vínculo. */
export async function confirmLink(input: {
  accountId: string;
  salonId: string;
  phone: string;
  kikinClientId: string;
  whatsappOptIn?: boolean;
}): Promise<EstablishmentLink> {
  const normalized = normalizePhoneBR(input.phone);
  if (!normalized) throw err(400, "INVALID_PHONE", "Informe um telefone válido.");
  const phoneHash = hashPhoneBR(normalized, config.KIKIN_CLIENT_PORTAL_SECRET)!;

  // 1. Revalida no Kikin que esse client (naquele salão) casa com o telefone informado
  const candidates = await searchCandidates({ phone: normalized });
  const candidate = candidates.find(
    (c) => c.clientId === input.kikinClientId && c.salonId === input.salonId
  );
  if (!candidate) {
    throw err(404, "CANDIDATE_NOT_FOUND", "Não encontramos este cadastro. Confira o telefone.");
  }

  // 2. Deduplicação (ADR-001): o mesmo telefone não pode estar vinculado a duas contas
  const id = await withTransaction(async (client) => {
    const dupAccount = await client.query(
      `SELECT account_id FROM account_establishment_links WHERE phone_hash = $1 LIMIT 1`,
      [phoneHash]
    );
    if (dupAccount.rows.length > 0 && dupAccount.rows[0].account_id !== input.accountId) {
      throw err(409, "PHONE_LINKED_TO_ANOTHER_ACCOUNT", "Este telefone já está vinculado a outra conta no portal.");
    }
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM account_establishment_links
       WHERE account_id = $1 AND salon_id = $2 AND kikin_client_id = $3`,
      [input.accountId, input.salonId, input.kikinClientId]
    );
    if (existing.rows.length > 0) {
      // vínculo já existe: registra o opt-in se o cliente confirmou agora
      if (input.whatsappOptIn) {
        await client.query(
          `UPDATE account_establishment_links SET whatsapp_optin_at = coalesce(whatsapp_optin_at, now()), updated_at = now()
           WHERE id = $1`,
          [existing.rows[0].id]
        );
      }
      return existing.rows[0].id;
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO account_establishment_links
         (account_id, salon_id, kikin_client_id, client_name, phone_hash, phone_masked, whatsapp_optin_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.accountId,
        input.salonId,
        candidate.clientId,
        candidate.name,
        phoneHash,
        candidate.phoneMask || maskPhoneBR(normalized),
        input.whatsappOptIn ? new Date().toISOString() : null,
      ]
    );
    return ins.rows[0].id;
  });

  const row = await getLinkRow(id);
  return row!;
}

/** Vínculos do cliente com nomes de estabelecimento (do /salons do Kikin). */
export async function listLinks(accountId: string): Promise<EstablishmentLink[]> {
  const [rows, salons] = await Promise.all([
    query<EstablishmentLink>(
      `SELECT id, salon_id AS "salonId", kikin_client_id AS "kikinClientId",
              client_name AS "clientName", phone_masked AS "phoneMask", confirmed_at AS "confirmedAt",
              whatsapp_optin_at AS "whatsappOptInAt"
       FROM account_establishment_links WHERE account_id = $1 ORDER BY confirmed_at`,
      [accountId]
    ),
    listSalons().catch(() => [] as SalonInfo[]),
  ]);
  const nameBySalon = new Map(salons.map((s) => [s.id, s.name]));
  return rows.rows.map((r) => ({ ...r, salonName: nameBySalon.get(r.salonId) }));
}

/** Próximos agendamentos do cliente em todos os vínculos (via endpoints internos do Kikin). */
export async function listFutureAppointments(accountId: string): Promise<FutureAppointment[]> {
  const links = await listLinks(accountId);
  const kikin = newKikin();
  const all: FutureAppointment[] = [];
  for (const link of links) {
    try {
      const data = await kikin.listAppointments({
        salonId: link.salonId,
        clientId: link.kikinClientId,
        future: true,
      });
      const items: any[] = Array.isArray(data?.appointments) ? data.appointments : [];
      for (const a of items) {
        all.push({
          id: String(a.id),
          groupId: a.groupId ? String(a.groupId) : null,
          salonId: link.salonId,
          serviceId: a.serviceId ? String(a.serviceId) : null,
          staffId: a.staffId ? String(a.staffId) : null,
          salonName: link.salonName,
          startAt: String(a.startAt),
          endAt: a.endAt ? String(a.endAt) : "",
          status: String(a.status || ""),
          serviceName: a.serviceName ? String(a.serviceName) : null,
          staffName: a.staffName ? String(a.staffName) : null,
          durationMin: a.durationMin != null ? Number(a.durationMin) : null,
        });
      }
    } catch (e: any) {
      // Vínculo cujo salão ficou indisponível não derruba a listagem inteira
      console.error(`[links] falha ao listar agendamentos do vínculo ${link.id}:`, e?.message || e);
    }
  }
  all.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
  return all;
}

/**
 * Auto-vínculo pós-booking (vínculo é consequência do agendamento):
 * o booking público do Kikin acabou de criar/achar um `client` para (salão, telefone).
 * Buscamos os candidatos por hash e vinculamos o client DESTE salão — silencioso
 * (nada de "sou eu?"), pois o booking recém-feito é a prova. Idempotente.
 *
 * Retorna null quando ainda não há client com esse telefone no salão (ex.: agendamento
 * em processamento) — nesse caso o portal mantém o wizard de claim como fallback.
 */
export async function autoLinkFromBooking(input: {
  accountId: string;
  salonId: string;
  phone: string;
  whatsappOptIn?: boolean;
}): Promise<EstablishmentLink | null> {
  const candidates = await searchCandidates({ phone: input.phone });
  const candidate = candidates.find((c) => c.salonId === input.salonId);
  if (!candidate) return null;
  // confirmLink revalida + dedupe entre contas (409 se o telefone for de outra conta)
  return confirmLink({
    accountId: input.accountId,
    salonId: input.salonId,
    phone: input.phone,
    kikinClientId: candidate.clientId,
    whatsappOptIn: input.whatsappOptIn,
  });
}

/** Vínculo ativo da conta no salão (garante que a ação é de um client vinculado). */
async function requireLink(accountId: string, salonId: string): Promise<EstablishmentLink> {
  const links = await listLinks(accountId);
  const link = links.find((l) => l.salonId === salonId);
  if (!link) throw err(403, "SALON_NOT_LINKED", "Você não tem vínculo com este estabelecimento.");
  return link;
}

/** Cancela o GRUPO do agendamento no Kikin (janela + limite validadas lá). */
export async function cancelAppointment(input: {
  accountId: string;
  salonId: string;
  appointmentId: string;
}): Promise<any> {
  const link = await requireLink(input.accountId, input.salonId);
  const result = await newKikin().cancel({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    clientId: link.kikinClientId,
  });
  void notifyChanges({ accountId: input.accountId, link, kind: "canceled" });
  return result;
}

/** Remarca: troca atômica no Kikin (novo grupo criado → grupo antigo cancelado). */
export async function rescheduleAppointment(input: {
  accountId: string;
  salonId: string;
  appointmentId: string;
  staffId?: string | null;
  startAt: string;
}): Promise<any> {
  const link = await requireLink(input.accountId, input.salonId);
  const result = await newKikin().reschedule({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    clientId: link.kikinClientId,
    staffId: input.staffId || null,
    startAt: input.startAt,
  });
  void notifyChanges({ accountId: input.accountId, link, kind: "rescheduled", when: fmtWhenBr(input.startAt) });
  return result;
}

/** Agenda direto para o client vinculado (sem redigitar telefone). */
export async function bookForLinkedClient(input: {
  accountId: string;
  salonId: string;
  serviceIds: string[];
  staffId?: string | null;
  startAt: string;
  whatsappOptIn?: boolean;
}): Promise<any> {
  const link = await requireLink(input.accountId, input.salonId);
  if (input.whatsappOptIn) {
    await query(
      `UPDATE account_establishment_links SET whatsapp_optin_at = coalesce(whatsapp_optin_at, now()), updated_at = now()
       WHERE id = $1`,
      [link.id]
    );
  }
  const result = await newKikin().bookForClient({
    salonId: input.salonId,
    clientId: link.kikinClientId,
    serviceIds: input.serviceIds,
    staffId: input.staffId || null,
    startAt: input.startAt,
  });
  void notifyChanges({ accountId: input.accountId, link, kind: "booked", when: fmtWhenBr(input.startAt) });
  return result;
}

/** Histórico de consultas (inclui canceladas/faltas) do cliente nos vínculos. */
export async function listAppointmentsHistory(accountId: string): Promise<FutureAppointment[]> {
  const links = await listLinks(accountId);
  const kikin = newKikin();
  const all: FutureAppointment[] = [];
  for (const link of links) {
    try {
      const data = await kikin.listAppointments({ salonId: link.salonId, clientId: link.kikinClientId, future: false });
      const items: any[] = Array.isArray(data?.appointments) ? data.appointments : [];
      for (const a of items) {
        all.push({
          id: String(a.id),
          groupId: a.groupId ? String(a.groupId) : null,
          salonId: link.salonId,
          salonName: link.salonName,
          serviceId: a.serviceId ? String(a.serviceId) : null,
          staffId: a.staffId ? String(a.staffId) : null,
          startAt: String(a.startAt),
          endAt: a.endAt ? String(a.endAt) : "",
          status: String(a.status || ""),
          serviceName: a.serviceName ? String(a.serviceName) : null,
          staffName: a.staffName ? String(a.staffName) : null,
          durationMin: a.durationMin != null ? Number(a.durationMin) : null,
        });
      }
    } catch (e: any) {
      console.error(`[links] falha ao listar histórico do vínculo ${link.id}:`, e?.message || e);
    }
  }
  all.sort((a, b) => (a.startAt < b.startAt ? 1 : -1));
  return all;
}

/** Liga/desliga o consentimento de WhatsApp do vínculo (notificações). */
export async function setWhatsappOptin(input: { accountId: string; salonId: string; optin: boolean }): Promise<EstablishmentLink> {
  const links = await listLinks(input.accountId);
  const link = links.find((l) => l.salonId === input.salonId);
  if (!link) throw err(403, "SALON_NOT_LINKED", "Você não tem vínculo com este estabelecimento.");
  await query(
    `UPDATE account_establishment_links SET whatsapp_optin_at = $1, updated_at = now() WHERE id = $2`,
    [input.optin ? new Date().toISOString() : null, link.id]
  );
  const row = await getLinkRow(link.id);
  return row!;
}

/** Número de WhatsApp da conta (decriptado em memória p/ envio). */
async function decryptedAccountPhone(accountId: string): Promise<string | null> {
  const res = await query<{ whatsapp_phone_enc: string | null }>(
    "SELECT whatsapp_phone_enc FROM client_accounts WHERE id = $1",
    [accountId]
  );
  return decryptPhone(res.rows[0]?.whatsapp_phone_enc);
}

function fmtWhenBr(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  } catch {
    return iso;
  }
}

/** Avisos por WhatsApp (cliente quando opt-in; salão nos eventos que exigem ação). */
async function notifyChanges(input: {
  accountId: string;
  link: EstablishmentLink;
  kind: "booked" | "canceled" | "rescheduled";
  when?: string;
}) {
  const clientPhone = await decryptedAccountPhone(input.accountId).catch(() => null);
  if (clientPhone && input.link.whatsappOptInAt) {
    const map: Record<string, string> = {
      booked: `Seu horário em ${input.link.salonName || "estabelecimento"} foi confirmado${input.when ? ` para ${input.when}` : ""}.`,
      canceled: `Seu horário em ${input.link.salonName || "estabelecimento"} foi cancelado.`,
      rescheduled: `Seu horário foi remarcado${input.when ? ` para ${input.when}` : ""} no ${input.link.salonName || "estabelecimento"}.`,
    };
    await sendWhatsApp(clientPhone, map[input.kind]);
  }
  try {
    const salons = await listSalons();
    const meta = salons.find((x) => x.id === input.link.salonId);
    if (meta?.phone) {
      const map: Record<string, string> = {
        canceled: `⚠️ ${input.link.clientName} cancelou um horário pelo portal (kikin cliente).`,
        rescheduled: `↔️ ${input.link.clientName} remarcou um horário pelo portal${input.when ? ` para ${input.when}` : ""}.`,
        booked: `✔️ Novo agendamento de ${input.link.clientName} pelo portal${input.when ? ` para ${input.when}` : ""}.`,
      };
      await sendWhatsApp(meta.phone, map[input.kind]);
    }
  } catch {
    /* best-effort */
  }
}
