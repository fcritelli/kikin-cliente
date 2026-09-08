import { query, withTransaction } from "../../db.js";
import { config } from "../../config.js";
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
}

export interface FutureAppointment {
  id: string;
  salonId: string;
  salonName?: string;
  startAt: string;
  endAt: string;
  status: string;
  serviceName: string | null;
  staffName: string | null;
}

function newKikin(): KikinPortalClient {
  return new KikinPortalClient();
}

export async function listSalons(): Promise<SalonInfo[]> {
  const data = await newKikin().listSalons();
  const salons: any[] = Array.isArray(data?.salons) ? data.salons : [];
  return salons.map((s) => ({ id: String(s.id), name: String(s.name), slug: String(s.slug || "") }));
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
            client_name AS "clientName", phone_masked AS "phoneMask", confirmed_at AS "confirmedAt"
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
    if (existing.rows.length > 0) return existing.rows[0].id;

    const ins = await client.query<{ id: string }>(
      `INSERT INTO account_establishment_links
         (account_id, salon_id, kikin_client_id, client_name, phone_hash, phone_masked)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.accountId,
        input.salonId,
        candidate.clientId,
        candidate.name,
        phoneHash,
        candidate.phoneMask || maskPhoneBR(normalized),
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
              client_name AS "clientName", phone_masked AS "phoneMask", confirmed_at AS "confirmedAt"
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
          salonId: link.salonId,
          salonName: link.salonName,
          startAt: String(a.startAt),
          endAt: a.endAt ? String(a.endAt) : "",
          status: String(a.status || ""),
          serviceName: a.serviceName ? String(a.serviceName) : null,
          staffName: a.staffName ? String(a.staffName) : null,
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
  });
}
