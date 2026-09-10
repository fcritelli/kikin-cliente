import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import { hashPhoneBR } from "../utils/phone.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";

/**
 * Vínculo COMPLETO já no cadastro pelo link do estabelecimento (`linkInvitedSalon` e
 * `POST /api/v1/links/invite`).
 *
 * 100% mockado — nem Postgres nem a API interna do Kikin são tocados:
 *  - `../db.js`: fake em memória que reconhece os SQL de `account_establishment_links`
 *    (dedupe por phone_hash, dedupe por conta+salão, INSERT ... RETURNING id, UPDATE de
 *    opt-in e o SELECT de leitura) e registra TODA query executada — é assim que dá para
 *    garantir que não houve segundo INSERT.
 *  - `../modules/kikin/kikin-client.js`: `KikinPortalClient` falso (listSalons/ensureClient),
 *    preservando os exports reais do módulo (buildSignature etc.).
 */

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const SALON_ID = "33333333-3333-4333-8333-333333333333";
const SALON_SLUG = "studio-bela";
const KIKIN_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const PHONE_INPUT = "(11) 98888-7777";
const PHONE_NORMALIZED = "5511988887777";
const SECRET = process.env.KIKIN_CLIENT_PORTAL_SECRET as string;

// ---------------------------------------------------------------- fake do banco

const dbFake = vi.hoisted(() => {
  interface FakeLinkRow {
    id: string;
    account_id: string;
    salon_id: string;
    kikin_client_id: string;
    client_name: string;
    phone_hash: string;
    phone_masked: string;
    whatsapp_optin_at: string | null;
  }

  const state = {
    rows: [] as FakeLinkRow[],
    calls: [] as Array<{ text: string; params: any[] }>,
  };

  function reset(): void {
    state.rows = [];
    state.calls = [];
  }

  function sqlMatching(re: RegExp): Array<{ text: string; params: any[] }> {
    return state.calls.filter((c) => re.test(c.text));
  }

  function inserts() {
    return sqlMatching(/INSERT INTO account_establishment_links/i);
  }

  async function runQuery(text: string, params: any[] = []): Promise<{ rows: any[] }> {
    state.calls.push({ text, params });

    // confirmLink/linkByKnownClient: dedupe do telefone entre CONTAS
    if (/SELECT account_id FROM account_establishment_links/i.test(text)) {
      const [phoneHash] = params;
      const found = state.rows.find((r) => r.phone_hash === phoneHash);
      return { rows: found ? [{ account_id: found.account_id }] : [] };
    }
    // confirmLink/linkByKnownClient: idempotência por (conta, salão)
    if (/SELECT id FROM account_establishment_links/i.test(text)) {
      const [accountId, salonId] = params;
      const found = state.rows.find((r) => r.account_id === accountId && r.salon_id === salonId);
      return { rows: found ? [{ id: found.id }] : [] };
    }
    // gravação do vínculo
    if (/INSERT INTO account_establishment_links/i.test(text)) {
      const [accountId, salonId, kikinClientId, clientName, phoneHash, phoneMask, optinAt] = params;
      const row: FakeLinkRow = {
        id: `link-${state.rows.length + 1}`,
        account_id: accountId,
        salon_id: salonId,
        kikin_client_id: kikinClientId,
        client_name: clientName,
        phone_hash: phoneHash,
        phone_masked: phoneMask,
        whatsapp_optin_at: optinAt || null,
      };
      state.rows.push(row);
      return { rows: [{ id: row.id }] };
    }
    // refresh de opt-in no vínculo já existente
    if (/UPDATE account_establishment_links SET whatsapp_optin_at = coalesce/i.test(text)) {
      const [id] = params;
      const row = state.rows.find((r) => r.id === id);
      if (row && !row.whatsapp_optin_at) row.whatsapp_optin_at = "2025-01-02T00:00:00.000Z";
      return { rows: [] };
    }
    // getLinkRow (leitura por id)
    if (/SELECT id, salon_id AS "salonId"/i.test(text) && /WHERE id = \$1/i.test(text)) {
      const [id] = params;
      const row = state.rows.find((r) => r.id === id);
      return {
        rows: row
          ? [{
              id: row.id,
              salonId: row.salon_id,
              kikinClientId: row.kikin_client_id,
              clientName: row.client_name,
              phoneMask: row.phone_masked,
              confirmedAt: "2025-01-01T00:00:00.000Z",
              whatsappOptInAt: row.whatsapp_optin_at,
            }]
          : [],
      };
    }
    // listLinks (leitura por conta)
    if (/SELECT id, salon_id AS "salonId"/i.test(text) && /WHERE account_id = \$1/i.test(text)) {
      const [accountId] = params;
      return {
        rows: state.rows
          .filter((r) => r.account_id === accountId)
          .map((r) => ({
            id: r.id,
            salonId: r.salon_id,
            kikinClientId: r.kikin_client_id,
            clientName: r.client_name,
            phoneMask: r.phone_masked,
            confirmedAt: "2025-01-01T00:00:00.000Z",
            whatsappOptInAt: r.whatsapp_optin_at,
          })),
      };
    }

    throw new Error(`[teste] SQL inesperado no fake do db: ${text}`);
  }

  return { state, reset, sqlMatching, inserts, runQuery };
});

vi.mock("../db.js", () => ({
  query: (text: string, params?: any[]) => dbFake.runQuery(text, params),
  withTransaction: (fn: any) => fn({ query: (text: string, params?: any[]) => dbFake.runQuery(text, params) }),
  pool: {},
}));

// -------------------------------------------------------- fake do cliente Kikin

const kikinFake = vi.hoisted(() => {
  const state = {
    salons: [] as any[],
    ensureCalls: [] as any[],
    ensureImpl: async (_input: any): Promise<any> => ({
      success: true,
      action: "ensure",
      clientId: "44444444-4444-4444-8444-444444444444",
      created: true,
    }),
  };

  class KikinPortalClient {
    async listSalons() {
      return { salons: state.salons };
    }
    async ensureClient(input: any) {
      state.ensureCalls.push(input);
      return state.ensureImpl(input);
    }
    async searchClientsByHash() {
      return { candidates: [] };
    }
  }

  return { state, KikinPortalClient };
});

vi.mock("../modules/kikin/kikin-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modules/kikin/kikin-client.js")>();
  return { ...actual, KikinPortalClient: kikinFake.KikinPortalClient };
});

// ------------------------------------------------------------------- imports

const { linkInvitedSalon } = await import("../modules/links/links.service.js");
const { createApp } = await import("../index.js");

function token(accountId = ACCOUNT_ID): string {
  return jwt.sign({ sub: accountId, type: "access" }, process.env.JWT_SECRET as string, { expiresIn: "5m" });
}

function seedLink(overrides: Partial<{ id: string; account_id: string; phone_hash: string }> = {}) {
  const row = {
    id: overrides.id || "link-existente",
    account_id: overrides.account_id || ACCOUNT_ID,
    salon_id: SALON_ID,
    kikin_client_id: "kikin-client-antigo",
    client_name: "Maria Souza",
    phone_hash: overrides.phone_hash || hashPhoneBR(PHONE_NORMALIZED, SECRET)!,
    phone_masked: "(11) ****-7777",
    whatsapp_optin_at: null,
  };
  dbFake.state.rows.push(row);
  return row;
}

beforeEach(() => {
  dbFake.reset();
  kikinFake.state.ensureCalls = [];
  kikinFake.state.salons = [{ id: SALON_ID, name: "Studio Bela", slug: SALON_SLUG, phone: null }];
  kikinFake.state.ensureImpl = async () => ({
    success: true,
    action: "ensure",
    clientId: KIKIN_CLIENT_ID,
    created: true,
  });
});

// -------------------------------------------------------------------- testes

describe("linkInvitedSalon (resolução do salão e gravação do vínculo)", () => {
  it("resolve o salão pelo SLUG, normaliza o telefone e grava o vínculo com o clientId devolvido", async () => {
    const link = await linkInvitedSalon({
      accountId: ACCOUNT_ID,
      salonRef: SALON_SLUG,
      phone: PHONE_INPUT,
      name: "Maria Souza",
      whatsappOptIn: true,
    });

    expect(kikinFake.state.ensureCalls).toEqual([
      { salonId: SALON_ID, phone: PHONE_NORMALIZED, name: "Maria Souza" },
    ]);
    expect(link.kikinClientId).toBe(KIKIN_CLIENT_ID);
    expect(link.salonId).toBe(SALON_ID);
    expect(link.phoneMask).toBe("(11) ****-7777");
    expect(link.whatsappOptInAt).not.toBeNull();

    const stored = dbFake.inserts();
    expect(stored).toHaveLength(1);
    expect(stored[0].params[0]).toBe(ACCOUNT_ID);
    expect(stored[0].params[1]).toBe(SALON_ID);
    expect(stored[0].params[2]).toBe(KIKIN_CLIENT_ID);
    expect(stored[0].params[4]).toBe(hashPhoneBR(PHONE_NORMALIZED, SECRET));
  });

  it("resolve o salão pelo ID (mesmo comportamento do slug)", async () => {
    const link = await linkInvitedSalon({
      accountId: ACCOUNT_ID,
      salonRef: SALON_ID,
      phone: PHONE_INPUT,
    });

    expect(kikinFake.state.ensureCalls).toEqual([
      { salonId: SALON_ID, phone: PHONE_NORMALIZED, name: null },
    ]);
    expect(link.kikinClientId).toBe(KIKIN_CLIENT_ID);
    expect(dbFake.inserts()).toHaveLength(1);
    expect(dbFake.inserts()[0].params[2]).toBe(KIKIN_CLIENT_ID);
  });
});

describe("linkInvitedSalon (erros de entrada e do Kikin)", () => {
  it("slug inexistente responde 404 SALON_NOT_FOUND (sem chamar ensureClient)", async () => {
    await expect(
      linkInvitedSalon({ accountId: ACCOUNT_ID, salonRef: "salao-que-nao-existe", phone: PHONE_INPUT })
    ).rejects.toMatchObject({ status: 404, code: "SALON_NOT_FOUND" });
    expect(kikinFake.state.ensureCalls).toHaveLength(0);
    expect(dbFake.state.calls).toHaveLength(0);
  });

  it("salonRef vazio responde 400 SALON_REF_REQUIRED", async () => {
    await expect(
      linkInvitedSalon({ accountId: ACCOUNT_ID, salonRef: "   ", phone: PHONE_INPUT })
    ).rejects.toMatchObject({ status: 400, code: "SALON_REF_REQUIRED" });
    expect(kikinFake.state.ensureCalls).toHaveLength(0);
  });

  it("telefone inválido responde 400 INVALID_PHONE (antes de tocar Kikin/banco)", async () => {
    await expect(
      linkInvitedSalon({ accountId: ACCOUNT_ID, salonRef: SALON_SLUG, phone: "sem-numero" })
    ).rejects.toMatchObject({ status: 400, code: "INVALID_PHONE" });
    expect(kikinFake.state.ensureCalls).toHaveLength(0);
    expect(dbFake.state.calls).toHaveLength(0);
  });

  it("ensureClient sem clientId na resposta responde 502 KIKIN_NO_CLIENT (sem gravar vínculo)", async () => {
    kikinFake.state.ensureImpl = async () => ({ success: true, action: "ensure", created: false });

    await expect(
      linkInvitedSalon({ accountId: ACCOUNT_ID, salonRef: SALON_SLUG, phone: PHONE_INPUT })
    ).rejects.toMatchObject({ status: 502, code: "KIKIN_NO_CLIENT" });
    expect(dbFake.inserts()).toHaveLength(0);
    expect(dbFake.state.rows).toHaveLength(0);
  });
});

describe("linkInvitedSalon (idempotência e dedupe de telefone)", () => {
  it("conta já vinculada a este salão não duplica: devolve o vínculo existente e NÃO faz segundo INSERT", async () => {
    const existing = seedLink();

    const link = await linkInvitedSalon({
      accountId: ACCOUNT_ID,
      salonRef: SALON_SLUG,
      phone: PHONE_INPUT,
      name: "Maria Souza",
    });

    expect(link.id).toBe(existing.id);
    expect(link.kikinClientId).toBe("kikin-client-antigo");
    expect(dbFake.inserts()).toHaveLength(0);
    expect(dbFake.state.rows).toHaveLength(1);
  });

  it("vínculo existente + whatsappOptIn atualiza o opt-in em vez de reinserir", async () => {
    const existing = seedLink();

    const link = await linkInvitedSalon({
      accountId: ACCOUNT_ID,
      salonRef: SALON_SLUG,
      phone: PHONE_INPUT,
      whatsappOptIn: true,
    });

    expect(link.id).toBe(existing.id);
    expect(dbFake.inserts()).toHaveLength(0);
    expect(dbFake.sqlMatching(/UPDATE account_establishment_links SET whatsapp_optin_at = coalesce/i)).toHaveLength(1);
    expect(link.whatsappOptInAt).not.toBeNull();
  });

  it("mesmo telefone em OUTRA conta responde 409 PHONE_LINKED_TO_ANOTHER_ACCOUNT (sem INSERT)", async () => {
    seedLink({ id: "link-de-outra-conta", account_id: OTHER_ACCOUNT_ID });

    await expect(
      linkInvitedSalon({ accountId: ACCOUNT_ID, salonRef: SALON_SLUG, phone: PHONE_INPUT })
    ).rejects.toMatchObject({ status: 409, code: "PHONE_LINKED_TO_ANOTHER_ACCOUNT" });
    expect(dbFake.inserts()).toHaveLength(0);
    expect(dbFake.state.rows).toHaveLength(1);
  });
});

describe("POST /api/v1/links/invite", () => {
  it("sem token responde 401 UNAUTHORIZED", async () => {
    const res = await request(createApp())
      .post("/api/v1/links/invite")
      .send({ salonRef: SALON_SLUG, phone: PHONE_INPUT });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
    expect(dbFake.state.calls).toHaveLength(0);
  });

  it("payload inválido responde 400 VALIDATION_ERROR (sem tocar Kikin/banco)", async () => {
    const app = createApp();
    for (const body of [{}, { salonRef: SALON_SLUG }, { salonRef: SALON_SLUG, phone: "123" }]) {
      const res = await request(app)
        .post("/api/v1/links/invite")
        .set("Authorization", `Bearer ${token()}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
    expect(kikinFake.state.ensureCalls).toHaveLength(0);
    expect(dbFake.state.calls).toHaveLength(0);
  });

  it("caminho feliz responde 201 {success:true, linked:true, link}", async () => {
    const res = await request(createApp())
      .post("/api/v1/links/invite")
      .set("Authorization", `Bearer ${token()}`)
      .send({ salonRef: SALON_SLUG, phone: PHONE_INPUT, name: "Maria Souza", whatsappOptIn: true });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.linked).toBe(true);
    expect(res.body.link).toMatchObject({
      salonId: SALON_ID,
      kikinClientId: KIKIN_CLIENT_ID,
      clientName: "Maria Souza",
      phoneMask: "(11) ****-7777",
    });
    expect(kikinFake.state.ensureCalls).toEqual([
      { salonId: SALON_ID, phone: PHONE_NORMALIZED, name: "Maria Souza" },
    ]);
    expect(dbFake.inserts()).toHaveLength(1);
  });

  it("salão inexistente responde 404 SALON_NOT_FOUND (erro do serviço propagado pela rota)", async () => {
    const res = await request(createApp())
      .post("/api/v1/links/invite")
      .set("Authorization", `Bearer ${token()}`)
      .send({ salonRef: "salao-inexistente", phone: PHONE_INPUT });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SALON_NOT_FOUND");
  });
});
