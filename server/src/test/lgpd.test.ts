import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { hashPhoneBR } from "../utils/phone.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";
process.env.WHATSAPP_DEV_RETURN_CODE = "true";

/**
 * LGPD Art. 18 no portal do cliente — export e exclusão da conta.
 *
 * 100% mockado: NENHUM Postgres real e NENHUMA chamada ao Kikin (nem leitura, nem escrita).
 *  - `../db.js`: fake em memória que modela as tabelas do portal (client_accounts,
 *    client_account_sessions, client_email_tokens, account_establishment_links,
 *    push_subscriptions, client_otp_codes, client_temp_signup, account_deletion_log),
 *    registra TODA query na ordem e simula ROLLBACK.
 *  - `../modules/kikin/kikin-client.js`: fake que CONTA chamadas (nenhuma pode acontecer na exclusão).
 *  - `../services/whatsapp/whatsapp.service.js`: só `sendWhatsApp` é falso (nada sai de verdade);
 *    a cifra do telefone continua a real.
 *  - `fetch` global: espionado — a exclusão não pode falar com o Kikin de forma alguma.
 */

const SECRET = process.env.KIKIN_CLIENT_PORTAL_SECRET as string;

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMAIL = "titular.teste@example.com";
const OTHER_ACCOUNT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_EMAIL = "outra.pessoa@example.com";
const PASSWORD = "senha-muito-segura-123";

const WA_ACCOUNT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WA_PHONE = "(11) 98888-7777";
const WA_PHONE_NORMALIZED = "5511988887777";
const WA_PHONE_HASH = hashPhoneBR(WA_PHONE_NORMALIZED, SECRET) as string;
const WA_OTP_CODE = "135790";

const LINK_PHONE_NORMALIZED = "5511911112222";
const LINK_PHONE_HASH = hashPhoneBR(LINK_PHONE_NORMALIZED, SECRET) as string;
const OTHER_PHONE_HASH = hashPhoneBR("5511933334444", SECRET) as string;

const PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/TOKEN-SUPER-SECRETO-NAO-PODE-VAZAR";

const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 4);

// ---------------------------------------------------------------- fake do banco

const dbFake = vi.hoisted(() => {
  const state = {
    accounts: [] as any[],
    sessions: [] as any[],
    emailTokens: [] as any[],
    links: [] as any[],
    push: [] as any[],
    otp: [] as any[],
    tempSignup: [] as any[],
    audit: [] as any[],
    calls: [] as Array<{ text: string; params: any[] }>,
  };

  function snapshot() {
    return JSON.stringify({
      accounts: state.accounts,
      sessions: state.sessions,
      emailTokens: state.emailTokens,
      links: state.links,
      push: state.push,
      otp: state.otp,
      tempSignup: state.tempSignup,
      audit: state.audit,
    });
  }
  function restore(snap: string) {
    const s = JSON.parse(snap);
    state.accounts = s.accounts;
    state.sessions = s.sessions;
    state.emailTokens = s.emailTokens;
    state.links = s.links;
    state.push = s.push;
    state.otp = s.otp;
    state.tempSignup = s.tempSignup;
    state.audit = s.audit;
  }

  function reset() {
    state.accounts = [];
    state.sessions = [];
    state.emailTokens = [];
    state.links = [];
    state.push = [];
    state.otp = [];
    state.tempSignup = [];
    state.audit = [];
    state.calls = [];
  }

  function callList() {
    return state.calls;
  }

  function sqlMatching(re: RegExp) {
    return state.calls.filter((c) => re.test(c.text));
  }

  /** Nomes das tabelas em DELETE, na ORDEM em que foram executados. */
  function deleteOrder(): string[] {
    return state.calls
      .filter((c) => /^\s*DELETE FROM/i.test(c.text))
      .map((c) => (/^\s*DELETE FROM\s+([a-z_]+)/i.exec(c.text)?.[1] || "?"));
  }

  function now(): number {
    return Date.now();
  }

  async function runQuery(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number | null }> {
    state.calls.push({ text, params });
    // Casa os padrões com o SQL "achatado" (uma linha): os statements do serviço são
    // multilinha e a formatação não deve interferir no reconhecimento.
    const sql = text.replace(/\s+/g, " ");

    // ---------------------------------------------------------- client_accounts
    // conta para EXPORT (colunas de exibição)
    if (/FROM client_accounts WHERE id = \$1/i.test(sql) && /consent_terms_at/i.test(sql)) {
      const row = state.accounts.find((a) => a.id === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    // conta para EXCLUSÃO (credenciais/prova)
    if (/FROM client_accounts WHERE id = \$1/i.test(sql) && /password_hash/i.test(sql)) {
      const row = state.accounts.find((a) => a.id === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    // ------------------------------------------------- client_account_sessions
    if (/count\(\*\)::text AS total FROM client_account_sessions/i.test(sql)) {
      const total = state.sessions.filter(
        (s) => s.account_id === params[0] && !s.revoked_at && new Date(s.expires_at).getTime() > now()
      ).length;
      return { rows: [{ total: String(total) }], rowCount: 1 };
    }
    if (/DELETE FROM client_account_sessions/i.test(sql)) {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((s) => s.account_id !== params[0]);
      return { rows: [], rowCount: before - state.sessions.length };
    }

    // ---------------------------------------------------- client_email_tokens
    if (/count\(\*\)::text AS total FROM client_email_tokens/i.test(sql)) {
      const total = state.emailTokens.filter(
        (t) => t.account_id === params[0] && !t.used_at && new Date(t.expires_at).getTime() > now()
      ).length;
      return { rows: [{ total: String(total) }], rowCount: 1 };
    }
    if (/DELETE FROM client_email_tokens/i.test(sql)) {
      const before = state.emailTokens.length;
      state.emailTokens = state.emailTokens.filter((t) => t.account_id !== params[0]);
      return { rows: [], rowCount: before - state.emailTokens.length };
    }

    // ---------------------------------------------- account_establishment_links
    if (/SELECT DISTINCT phone_hash FROM account_establishment_links/i.test(sql)) {
      const rows = [...new Set(state.links.filter((l) => l.account_id === params[0]).map((l) => l.phone_hash))];
      return { rows: rows.map((phone_hash) => ({ phone_hash })), rowCount: rows.length };
    }
    if (/SELECT id, salon_id AS "salonId"/i.test(sql) && /WHERE account_id = \$1/i.test(sql)) {
      const rows = state.links
        .filter((l) => l.account_id === params[0])
        .map((l) => ({
          id: l.id,
          salonId: l.salon_id,
          kikinClientId: l.kikin_client_id,
          clientName: l.client_name,
          phoneMask: l.phone_masked,
          confirmedAt: l.confirmed_at,
          whatsappOptInAt: l.whatsapp_optin_at,
        }));
      return { rows, rowCount: rows.length };
    }
    if (/DELETE FROM account_establishment_links/i.test(sql)) {
      const before = state.links.length;
      state.links = state.links.filter((l) => l.account_id !== params[0]);
      return { rows: [], rowCount: before - state.links.length };
    }

    // ------------------------------------------------------- push_subscriptions
    if (/SELECT endpoint, created_at FROM push_subscriptions/i.test(sql)) {
      const rows = state.push.filter((p) => p.account_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (/DELETE FROM push_subscriptions/i.test(sql)) {
      const before = state.push.length;
      state.push = state.push.filter((p) => p.account_id !== params[0]);
      return { rows: [], rowCount: before - state.push.length };
    }

    // ---------------------------------------------------------- client_otp_codes
    if (/SELECT id, code_hash, attempts FROM client_otp_codes/i.test(sql)) {
      const [phoneHash, purpose] = params;
      const found = state.otp
        .filter(
          (o) =>
            o.phone_hash === phoneHash &&
            o.purpose === purpose &&
            !o.used_at &&
            new Date(o.expires_at).getTime() > now()
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return { rows: found.slice(0, 1).map((o) => ({ id: o.id, code_hash: o.code_hash, attempts: o.attempts })), rowCount: found.length };
    }
    if (/INSERT INTO client_otp_codes/i.test(sql)) {
      const [phone_hash, purpose, code_hash] = params;
      state.otp.push({
        id: `otp-${state.otp.length + 1}`,
        phone_hash,
        purpose,
        code_hash,
        attempts: 0,
        used_at: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(now() + 10 * 60 * 1000).toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE client_otp_codes SET used_at = now\(\) WHERE phone_hash = \$1 AND purpose = \$2/i.test(sql)) {
      const [phoneHash, purpose] = params;
      let n = 0;
      for (const o of state.otp) {
        if (o.phone_hash === phoneHash && o.purpose === purpose && !o.used_at) {
          o.used_at = new Date().toISOString();
          n += 1;
        }
      }
      return { rows: [], rowCount: n };
    }
    if (/UPDATE client_otp_codes SET attempts = attempts \+ 1/i.test(sql)) {
      const found = state.otp.find((o) => o.id === params[0]);
      if (found) found.attempts += 1;
      return { rows: [], rowCount: found ? 1 : 0 };
    }
    if (/UPDATE client_otp_codes SET used_at = now\(\) WHERE id = \$1/i.test(sql)) {
      const found = state.otp.find((o) => o.id === params[0]);
      if (found) found.used_at = new Date().toISOString();
      return { rows: [], rowCount: found ? 1 : 0 };
    }
    if (/DELETE FROM client_otp_codes/i.test(sql)) {
      const hashes: string[] = params[0] || [];
      const before = state.otp.length;
      state.otp = state.otp.filter((o) => !hashes.includes(o.phone_hash));
      return { rows: [], rowCount: before - state.otp.length };
    }

    // --------------------------------------------------------- client_temp_signup
    if (/DELETE FROM client_temp_signup/i.test(sql)) {
      const hashes: string[] = params[0] || [];
      const before = state.tempSignup.length;
      state.tempSignup = state.tempSignup.filter((t) => !hashes.includes(t.phone_hash));
      return { rows: [], rowCount: before - state.tempSignup.length };
    }

    // ---------------------------------------------------------- client_accounts (delete)
    if (/DELETE FROM client_accounts/i.test(sql)) {
      const before = state.accounts.length;
      state.accounts = state.accounts.filter((a) => a.id !== params[0]);
      return { rows: [], rowCount: before - state.accounts.length };
    }

    // ------------------------------------------------------- account_deletion_log
    if (/INSERT INTO account_deletion_log/i.test(sql)) {
      const [account_ref_hash, email_hash, auth_provider, proof_method, removed_counts, ip_hash, deleted_at] = params;
      const row = {
        id: `audit-${state.audit.length + 1}`,
        account_ref_hash,
        email_hash,
        auth_provider,
        proof_method,
        removed_counts: JSON.parse(removed_counts),
        ip_hash,
        deleted_at,
      };
      state.audit.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }

    throw new Error(`[teste] SQL inesperado no fake do db: ${text}`);
  }

  return { state, reset, callList, sqlMatching, deleteOrder, runQuery, snapshot, restore };
});

vi.mock("../db.js", () => ({
  query: (text: string, params?: any[]) => dbFake.runQuery(text, params),
  withTransaction: async (fn: any) => {
    const snap = dbFake.snapshot();
    try {
      return await fn({ query: (text: string, params?: any[]) => dbFake.runQuery(text, params) });
    } catch (err) {
      dbFake.restore(snap); // ROLLBACK
      throw err;
    }
  },
  pool: {},
}));

// -------------------------------------------------------- fake do cliente Kikin

const kikinFake = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ method: string; input: any }>,
    salons: [] as any[],
    appointments: [] as any[],
  };

  class KikinPortalClient {
    async listSalons() {
      state.calls.push({ method: "listSalons", input: null });
      return { salons: state.salons };
    }
    async listAppointments(input: any) {
      state.calls.push({ method: "listAppointments", input });
      return { appointments: state.appointments.filter((a: any) => a.salonId === input.salonId) };
    }
    async ensureClient(input: any) {
      state.calls.push({ method: "ensureClient", input });
      throw new Error("Kikin não pode ser escrito pela exclusão de conta.");
    }
    async searchClientsByHash(input: any) {
      state.calls.push({ method: "searchClientsByHash", input });
      throw new Error("Kikin não pode ser consultado pela exclusão de conta.");
    }
    async bookForClient(input: any) {
      state.calls.push({ method: "bookForClient", input });
      throw new Error("Kikin não pode ser escrito pela exclusão de conta.");
    }
    async bookByPhone(input: any) {
      state.calls.push({ method: "bookByPhone", input });
      throw new Error("Kikin não pode ser escrito pela exclusão de conta.");
    }
    async cancel(input: any) {
      state.calls.push({ method: "cancel", input });
      throw new Error("Kikin não pode ser escrito pela exclusão de conta.");
    }
    async reschedule(input: any) {
      state.calls.push({ method: "reschedule", input });
      throw new Error("Kikin não pode ser escrito pela exclusão de conta.");
    }
  }

  return { state, KikinPortalClient };
});

vi.mock("../modules/kikin/kikin-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modules/kikin/kikin-client.js")>();
  return { ...actual, KikinPortalClient: kikinFake.KikinPortalClient };
});

// -------------------------------------------------------- fake do envio WhatsApp

const whatsappFake = vi.hoisted(() => {
  const state = { sends: [] as Array<{ to: string; message: string }> };
  return { state };
});

vi.mock("../services/whatsapp/whatsapp.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/whatsapp/whatsapp.service.js")>();
  return {
    ...actual,
    sendWhatsApp: async (to: string, message: string) => {
      whatsappFake.state.sends.push({ to, message });
      return { ok: true, transport: "log" as const, to };
    },
  };
});

// ------------------------------------------------------------------- imports

const { encryptPhone } = await import("../services/whatsapp/whatsapp.service.js");
const { DELETION_ORDER, PORTAL_ACCOUNT_TABLES, CONFIRM_WORD } = await import("../modules/lgpd/lgpd.service.js");
const { createApp } = await import("../index.js");

function token(accountId = ACCOUNT_ID): string {
  return jwt.sign({ sub: accountId, type: "access" }, process.env.JWT_SECRET as string, { expiresIn: "5m" });
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// ------------------------------------------------------------------- cenários

function seedPasswordAccount() {
  dbFake.state.accounts.push({
    id: ACCOUNT_ID,
    email: EMAIL,
    email_normalized: EMAIL,
    full_name: "Titular de Teste",
    password_hash: PASSWORD_HASH,
    email_verified_at: "2026-01-02T10:00:00.000Z",
    avatar_url: null,
    auth_provider: "local",
    whatsapp_phone_hash: WA_PHONE_HASH,
    whatsapp_phone_masked: "(11) ****-7777",
    whatsapp_phone_enc: encryptPhone(WA_PHONE_NORMALIZED),
    consent_terms_at: "2026-01-01T09:00:00.000Z",
    created_at: "2026-01-01T09:00:00.000Z",
    updated_at: "2026-01-05T09:00:00.000Z",
  });

  dbFake.state.links.push(
    {
      id: "link-1",
      account_id: ACCOUNT_ID,
      salon_id: "salon-1",
      kikin_client_id: "kikin-client-1",
      client_name: "Titular de Teste",
      phone_hash: LINK_PHONE_HASH,
      phone_masked: "(11) ****-2222",
      confirmed_at: "2026-01-03T12:00:00.000Z",
      whatsapp_optin_at: "2026-01-03T12:05:00.000Z",
    },
    {
      id: "link-2",
      account_id: ACCOUNT_ID,
      salon_id: "salon-2",
      kikin_client_id: "kikin-client-2",
      client_name: "Titular de Teste",
      phone_hash: LINK_PHONE_HASH,
      phone_masked: "(11) ****-2222",
      confirmed_at: "2026-01-04T12:00:00.000Z",
      whatsapp_optin_at: null,
    },
    // vínculo de OUTRA conta: não pode ser tocado
    {
      id: "link-outra",
      account_id: OTHER_ACCOUNT_ID,
      salon_id: "salon-1",
      kikin_client_id: "kikin-client-outro",
      client_name: "Outra Pessoa",
      phone_hash: OTHER_PHONE_HASH,
      phone_masked: "(11) ****-3333",
      confirmed_at: "2026-01-03T12:00:00.000Z",
      whatsapp_optin_at: null,
    }
  );

  dbFake.state.sessions.push(
    { id: "s1", account_id: ACCOUNT_ID, revoked_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    { id: "s2", account_id: ACCOUNT_ID, revoked_at: null, expires_at: new Date(Date.now() + 7200_000).toISOString() },
    { id: "s3", account_id: ACCOUNT_ID, revoked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString() },
    { id: "s-outra", account_id: OTHER_ACCOUNT_ID, revoked_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() }
  );

  dbFake.state.emailTokens.push(
    { id: "t1", account_id: ACCOUNT_ID, used_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    { id: "t-outra", account_id: OTHER_ACCOUNT_ID, used_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() }
  );

  dbFake.state.push.push(
    { account_id: ACCOUNT_ID, endpoint: PUSH_ENDPOINT, created_at: "2026-01-06T08:00:00.000Z" },
    { account_id: OTHER_ACCOUNT_ID, endpoint: "https://outro.exemplo/fcm/token", created_at: "2026-01-06T08:00:00.000Z" }
  );

  dbFake.state.otp.push(
    // do telefone da conta (purpose signin)
    otpRow("otp-conta", WA_PHONE_HASH, "whatsapp_signin"),
    // do telefone que só existe no vínculo (purpose exclusão)
    otpRow("otp-vinculo", LINK_PHONE_HASH, "account_deletion"),
    // de OUTRA pessoa: não pode ser apagado
    otpRow("otp-outra", OTHER_PHONE_HASH, "whatsapp_signin")
  );

  dbFake.state.tempSignup.push(
    { id: "ts1", phone_hash: LINK_PHONE_HASH, temp_token: "tok-1", used_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    { id: "ts-outra", phone_hash: OTHER_PHONE_HASH, temp_token: "tok-2", used_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() }
  );

  // outra conta "viva" para provar que a exclusão não vaza para terceiros
  dbFake.state.accounts.push({
    id: OTHER_ACCOUNT_ID,
    email: OTHER_EMAIL,
    email_normalized: OTHER_EMAIL,
    full_name: "Outra Pessoa",
    password_hash: PASSWORD_HASH,
    email_verified_at: null,
    avatar_url: null,
    auth_provider: "local",
    whatsapp_phone_hash: null,
    whatsapp_phone_masked: null,
    whatsapp_phone_enc: null,
    consent_terms_at: "2026-01-01T09:00:00.000Z",
    created_at: "2026-01-01T09:00:00.000Z",
    updated_at: "2026-01-05T09:00:00.000Z",
  });
}

function otpRow(id: string, phoneHash: string, purpose: string, overrides: Record<string, any> = {}) {
  return {
    id,
    phone_hash: phoneHash,
    purpose,
    code_hash: sha256(WA_OTP_CODE),
    attempts: 0,
    used_at: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function seedWhatsappAccount(overrides: Record<string, any> = {}) {
  dbFake.state.accounts.push({
    id: WA_ACCOUNT_ID,
    email: null,
    email_normalized: null,
    full_name: "Cliente WhatsApp",
    password_hash: null,
    email_verified_at: null,
    avatar_url: null,
    auth_provider: "whatsapp",
    whatsapp_phone_hash: WA_PHONE_HASH,
    whatsapp_phone_masked: "(11) ****-7777",
    whatsapp_phone_enc: encryptPhone(WA_PHONE_NORMALIZED),
    consent_terms_at: "2026-02-01T09:00:00.000Z",
    created_at: "2026-02-01T09:00:00.000Z",
    updated_at: "2026-02-01T09:00:00.000Z",
    ...overrides,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: any;

beforeEach(() => {
  dbFake.reset();
  kikinFake.state.calls = [];
  kikinFake.state.salons = [{ id: "salon-1", name: "Studio Teste", slug: "studio-teste", phone: null }];
  kikinFake.state.appointments = [
    {
      id: "appt-1",
      groupId: "group-1",
      salonId: "salon-1",
      serviceId: "svc-1",
      staffId: "staff-1",
      startAt: "2026-03-01T13:00:00.000Z",
      endAt: "2026-03-01T13:45:00.000Z",
      status: "confirmado",
      serviceName: "Corte",
      staffName: "Bia",
      durationMin: 45,
    },
  ];
  whatsappFake.state.sends = [];
  // A exclusão NÃO pode falar com o Kikin por HTTP.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("fetch não pode ser chamado pela exclusão de conta (Kikin intacto).");
  });
});

// ============================================================================
// GET /api/v1/accounts/me/export
// ============================================================================

describe("LGPD — exportar meus dados", () => {
  it("exige autenticação (401 sem token)", async () => {
    seedPasswordAccount();
    const res = await request(createApp()).get("/api/v1/accounts/me/export");
    expect(res.status).toBe(401);
    expect(dbFake.callList()).toHaveLength(0);
  });

  it("devolve JSON anexado, com todas as seções do contrato", async () => {
    seedPasswordAccount();
    const res = await request(createApp())
      .get("/api/v1/accounts/me/export")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="meus-dados-kikin-\d{4}-\d{2}-\d{2}\.json"$/);

    const body = JSON.parse(res.text);
    expect(body.formatVersion).toBe(1);
    expect(typeof body.generatedAt).toBe("string");

    // conta
    expect(body.conta).toMatchObject({
      id: ACCOUNT_ID,
      nome: "Titular de Teste",
      email: EMAIL,
      provedorDeLogin: "local",
      whatsappMascarado: "(11) ****-7777",
      criadaEm: "2026-01-01T09:00:00.000Z",
    });

    // vínculos (só os DESTA conta, com nome do estabelecimento e telefone mascarado)
    expect(body.vinculos).toHaveLength(2);
    expect(body.vinculos[0]).toMatchObject({
      estabelecimentoId: "salon-1",
      estabelecimentoNome: "Studio Teste",
      telefoneMascarado: "(11) ****-2222",
    });

    // agendamentos (futuros + histórico, lidos do Kikin em modo LEITURA)
    expect(body.agendamentos.futuros).toHaveLength(1);
    expect(body.agendamentos.futuros[0]).toMatchObject({ servico: "Corte", profissional: "Bia", situacao: "confirmado" });
    expect(Array.isArray(body.agendamentos.historico)).toBe(true);

    // consentimentos/aceites
    expect(body.consentimentos[0]).toMatchObject({
      tipo: "termos_e_politica_de_privacidade",
      registradoEm: "2026-01-01T09:00:00.000Z",
    });
    expect(body.consentimentos.some((c: any) => c.tipo === "whatsapp_por_estabelecimento")).toBe(true);

    // push: só o host, nunca o endpoint (que carrega token do navegador)
    expect(body.push.dispositivos).toEqual([{ host: "fcm.googleapis.com", criadoEm: "2026-01-06T08:00:00.000Z" }]);

    // segurança e aviso de escopo
    expect(body.seguranca.sessoesAtivas).toBe(2);
    expect(body.seguranca.tokensDeEmailPendentes).toBe(1);
    expect(body.aviso).toMatch(/NÃO os remove/i);
    expect(body.aviso).toMatch(/estabelecimento/i);
  });

  it("NUNCA vaza segredo: senha, hashes de token, telefone cru ou endpoint de push", async () => {
    seedPasswordAccount();
    const res = await request(createApp())
      .get("/api/v1/accounts/me/export")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    const raw = res.text;
    for (const forbidden of [
      "password_hash",
      PASSWORD_HASH,
      PASSWORD,
      "refresh_token_hash",
      "token_hash",
      "code_hash",
      "whatsapp_phone_enc",
      "whatsapp_phone_hash",
      WA_PHONE_HASH,
      LINK_PHONE_HASH,
      WA_PHONE_NORMALIZED,
      LINK_PHONE_NORMALIZED,
      PUSH_ENDPOINT,
      "TOKEN-SUPER-SECRETO-NAO-PODE-VAZAR",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    // o mascarado continua presente (é o dado útil ao titular)
    expect(raw).toContain("(11) ****-7777");
    expect(raw).toContain("fcm.googleapis.com");
    // nenhuma linha de outra conta entrou no arquivo
    expect(raw).not.toContain(OTHER_EMAIL);
    expect(raw).not.toContain("Outra Pessoa");
  });

  it("lista as tabelas do portal que guardam dados da conta (enumeração explícita)", () => {
    expect([...PORTAL_ACCOUNT_TABLES].sort()).toEqual(
      [
        "account_establishment_links",
        "client_account_sessions",
        "client_accounts",
        "client_email_tokens",
        "client_otp_codes",
        "client_temp_signup",
        "push_subscriptions",
      ]
    );
    expect([...DELETION_ORDER].at(-1)).toBe("client_accounts");
  });
});

// ============================================================================
// POST /api/v1/accounts/me/delete/request
// ============================================================================

describe("LGPD — pedido de exclusão (qual prova a conta exige)", () => {
  it("conta com senha local ⇒ prova 'password' e NENHUMA mensagem enviada", async () => {
    seedPasswordAccount();
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete/request")
      .set("Authorization", `Bearer ${token()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ method: "password", confirmWord: CONFIRM_WORD });
    expect(whatsappFake.state.sends).toHaveLength(0);
    expect(dbFake.sqlMatching(/INSERT INTO client_otp_codes/i)).toHaveLength(0);
  });

  it("conta WhatsApp ⇒ prova 'whatsapp_otp', dispara o código no MESMO fluxo de OTP (purpose account_deletion)", async () => {
    seedWhatsappAccount();
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete/request")
      .set("Authorization", `Bearer ${token(WA_ACCOUNT_ID)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.method).toBe("whatsapp_otp");
    expect(res.body.codeSent).toBe(true);
    expect(res.body.whatsappMask).toBe("(11) ****-7777");
    expect(res.body.devCode).toMatch(/^\d{6}$/);
    expect(res.body.confirmWord).toBe("EXCLUIR");

    // reutilizou o fluxo existente: gravou em client_otp_codes com o propósito próprio
    const inserts = dbFake.sqlMatching(/INSERT INTO client_otp_codes/i);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[0]).toBe(WA_PHONE_HASH);
    expect(inserts[0].params[1]).toBe("account_deletion");
    expect(inserts[0].params[2]).toBe(sha256(res.body.devCode));
    // o código vai por WhatsApp uma única vez, para o número da conta
    expect(whatsappFake.state.sends).toHaveLength(1);
    expect(whatsappFake.state.sends[0].message).toContain(res.body.devCode);
    expect(whatsappFake.state.sends[0].message).toMatch(/EXCLUIR/);
  });

  it("sendCode:false informa o método SEM enviar mensagem (UI só envia no botão)", async () => {
    seedWhatsappAccount();
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete/request")
      .set("Authorization", `Bearer ${token(WA_ACCOUNT_ID)}`)
      .send({ sendCode: false });

    expect(res.status).toBe(200);
    expect(res.body.method).toBe("whatsapp_otp");
    expect(res.body.codeSent).toBeUndefined();
    expect(whatsappFake.state.sends).toHaveLength(0);
  });

  it("conta sem senha e sem WhatsApp ⇒ 409 PROOF_UNAVAILABLE (não inventa prova)", async () => {
    dbFake.state.accounts.push({
      id: ACCOUNT_ID,
      email: EMAIL,
      email_normalized: EMAIL,
      full_name: "Só Google",
      password_hash: null,
      auth_provider: "google",
      whatsapp_phone_hash: null,
      whatsapp_phone_enc: null,
      whatsapp_phone_masked: null,
      consent_terms_at: null,
      created_at: "2026-01-01T09:00:00.000Z",
      updated_at: "2026-01-01T09:00:00.000Z",
    });
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete/request")
      .set("Authorization", `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROOF_UNAVAILABLE");
    expect(whatsappFake.state.sends).toHaveLength(0);
  });

  it("sem token ⇒ 401", async () => {
    const res = await request(createApp()).post("/api/v1/accounts/me/delete/request").send({});
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// POST /api/v1/accounts/me/delete
// ============================================================================

describe("LGPD — excluir minha conta (prova + EXCLUIR)", () => {
  it("exige a palavra EXCLUIR: 409 CONFIRM_INVALID e NADA é apagado", async () => {
    seedPasswordAccount();
    const app = createApp();
    for (const confirm of ["", "APAGAR", "excluir tudo"]) {
      const res = await request(app)
        .post("/api/v1/accounts/me/delete")
        .set("Authorization", `Bearer ${token()}`)
        .send({ confirm, password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFIRM_INVALID");
    }
    expect(dbFake.deleteOrder()).toEqual([]);
    expect(dbFake.state.accounts).toHaveLength(2);
    expect(dbFake.state.audit).toHaveLength(0);
  });

  it("prova ausente ⇒ 400 PROOF_REQUIRED; senha errada ⇒ 400 INVALID_PASSWORD (nada apagado)", async () => {
    seedPasswordAccount();
    const app = createApp();

    const semProva = await request(app)
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token()}`)
      .send({ confirm: "EXCLUIR" });
    expect(semProva.status).toBe(400);
    expect(semProva.body.code).toBe("PROOF_REQUIRED");

    const senhaErrada = await request(app)
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token()}`)
      .send({ confirm: "EXCLUIR", password: "senha-errada-000" });
    expect(senhaErrada.status).toBe(400);
    expect(senhaErrada.body.code).toBe("INVALID_PASSWORD");

    expect(dbFake.deleteOrder()).toEqual([]);
    expect(dbFake.state.audit).toHaveLength(0);
  });

  it("caminho feliz: apaga TODAS as linhas do portal da conta, na ordem FK-segura, e registra a auditoria", async () => {
    seedPasswordAccount();
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token()}`)
      .send({ confirm: "excluir", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.proofMethod).toBe("password");
    expect(res.body.removed).toEqual({
      push_subscriptions: 1,
      client_email_tokens: 1,
      client_account_sessions: 3,
      account_establishment_links: 2,
      client_otp_codes: 2,
      client_temp_signup: 1,
      client_accounts: 1,
    });

    // ordem FK-segura (filhas antes da conta)
    expect(dbFake.deleteOrder()).toEqual([...DELETION_ORDER]);

    // sobrou ZERO linha da conta em cada tabela do portal
    expect(dbFake.state.accounts.find((a) => a.id === ACCOUNT_ID)).toBeUndefined();
    expect(dbFake.state.sessions.filter((s) => s.account_id === ACCOUNT_ID)).toHaveLength(0);
    expect(dbFake.state.emailTokens.filter((t) => t.account_id === ACCOUNT_ID)).toHaveLength(0);
    expect(dbFake.state.links.filter((l) => l.account_id === ACCOUNT_ID)).toHaveLength(0);
    expect(dbFake.state.push.filter((p) => p.account_id === ACCOUNT_ID)).toHaveLength(0);
    expect(dbFake.state.otp.filter((o) => o.phone_hash === WA_PHONE_HASH || o.phone_hash === LINK_PHONE_HASH)).toHaveLength(0);
    expect(dbFake.state.tempSignup.filter((t) => t.phone_hash === LINK_PHONE_HASH)).toHaveLength(0);

    // e NADA de terceiros foi tocado
    expect(dbFake.state.accounts.find((a) => a.id === OTHER_ACCOUNT_ID)).toBeTruthy();
    expect(dbFake.state.links.filter((l) => l.account_id === OTHER_ACCOUNT_ID)).toHaveLength(1);
    expect(dbFake.state.sessions.filter((s) => s.account_id === OTHER_ACCOUNT_ID)).toHaveLength(1);
    expect(dbFake.state.otp.filter((o) => o.phone_hash === OTHER_PHONE_HASH)).toHaveLength(1);

    // auditoria Art. 37: sem PII em claro
    expect(dbFake.state.audit).toHaveLength(1);
    const audit = dbFake.state.audit[0];
    expect(audit.proof_method).toBe("password");
    expect(audit.auth_provider).toBe("local");
    expect(audit.removed_counts.client_accounts).toBe(1);
    expect(audit.account_ref_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(audit)).not.toContain(EMAIL);
    expect(JSON.stringify(audit)).not.toContain(ACCOUNT_ID);
    expect(JSON.stringify(audit)).not.toContain("127.0.0.1");
    expect(dbFake.deleteOrder().at(-1)).toBe("client_accounts");
  });

  it("NÃO chama e NÃO escreve no Kikin (nenhuma chamada de cliente, nenhum fetch)", async () => {
    seedPasswordAccount();
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token()}`)
      .send({ confirm: "EXCLUIR", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(kikinFake.state.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // nenhuma query tocou qualquer tabela do Kikin (nada de SQL cross-database)
    for (const call of dbFake.callList()) {
      expect(call.text).not.toMatch(/\b(appointments|clients|salons|staff|services)\b/i);
    }
  });

  it("OTP incorreto ⇒ 400 OTP_INVALID (conta permanece e tentativa é contada)", async () => {
    seedWhatsappAccount();
    dbFake.state.otp.push(otpRow("otp-del", WA_PHONE_HASH, "account_deletion"));
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token(WA_ACCOUNT_ID)}`)
      .send({ confirm: "EXCLUIR", otpCode: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OTP_INVALID");
    expect(dbFake.state.accounts.find((a) => a.id === WA_ACCOUNT_ID)).toBeTruthy();
    expect(dbFake.state.otp[0].attempts).toBe(1);
    expect(dbFake.state.audit).toHaveLength(0);
  });

  it("OTP expirado ⇒ 400 OTP_EXPIRED", async () => {
    seedWhatsappAccount();
    dbFake.state.otp.push(
      otpRow("otp-velho", WA_PHONE_HASH, "account_deletion", { expires_at: new Date(Date.now() - 1000).toISOString() })
    );
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token(WA_ACCOUNT_ID)}`)
      .send({ confirm: "EXCLUIR", otpCode: WA_OTP_CODE });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OTP_EXPIRED");
    expect(dbFake.state.accounts.find((a) => a.id === WA_ACCOUNT_ID)).toBeTruthy();
    expect(dbFake.state.audit).toHaveLength(0);
  });

  it("OTP de OUTRO propósito (login) não serve para excluir", async () => {
    seedWhatsappAccount();
    dbFake.state.otp.push(otpRow("otp-login", WA_PHONE_HASH, "whatsapp_signin"));
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token(WA_ACCOUNT_ID)}`)
      .send({ confirm: "EXCLUIR", otpCode: WA_OTP_CODE });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OTP_EXPIRED");
    expect(dbFake.state.accounts.find((a) => a.id === WA_ACCOUNT_ID)).toBeTruthy();
  });

  it("muitas tentativas ⇒ 429 OTP_TOO_MANY", async () => {
    seedWhatsappAccount();
    dbFake.state.otp.push(otpRow("otp-del", WA_PHONE_HASH, "account_deletion", { attempts: 5 }));
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token(WA_ACCOUNT_ID)}`)
      .send({ confirm: "EXCLUIR", otpCode: WA_OTP_CODE });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("OTP_TOO_MANY");
  });

  it("fluxo completo por WhatsApp: pede o código, usa o código e apaga a conta (auditoria whatsapp_otp)", async () => {
    seedWhatsappAccount();
    dbFake.state.push.push({ account_id: WA_ACCOUNT_ID, endpoint: PUSH_ENDPOINT, created_at: "2026-02-01T10:00:00.000Z" });
    const app = createApp();

    const pedido = await request(app)
      .post("/api/v1/accounts/me/delete/request")
      .set("Authorization", `Bearer ${token(WA_ACCOUNT_ID)}`)
      .send({});
    expect(pedido.status).toBe(200);
    const code = pedido.body.devCode as string;

    const res = await request(app)
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token(WA_ACCOUNT_ID)}`)
      .send({ confirm: "EXCLUIR", otpCode: code });

    expect(res.status).toBe(200);
    expect(res.body.proofMethod).toBe("whatsapp_otp");
    expect(res.body.removed.client_accounts).toBe(1);
    expect(res.body.removed.client_otp_codes).toBe(1);
    expect(res.body.removed.push_subscriptions).toBe(1);
    expect(dbFake.state.accounts.find((a) => a.id === WA_ACCOUNT_ID)).toBeUndefined();
    // o código foi consumido (used_at) ou apagado junto com a conta — nunca reaproveitável
    expect(dbFake.state.otp.filter((o) => o.phone_hash === WA_PHONE_HASH && !o.used_at)).toHaveLength(0);
    expect(dbFake.state.audit[0].proof_method).toBe("whatsapp_otp");
    expect(kikinFake.state.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falha no meio da transação ⇒ ROLLBACK: conta, linhas e auditoria intactas", async () => {
    seedPasswordAccount();
    // estoura ao tentar apagar a conta (simula indisponibilidade do banco no fim da transação)
    const boom = () => {
      throw new Error("falha simulada");
    };
    const original = dbFake.runQuery;
    const spy = vi
      .spyOn(dbFake, "runQuery")
      .mockImplementation(async (text: string, params: any[] = []) => {
        if (/DELETE FROM client_accounts/i.test(text)) boom();
        return original(text, params);
      });

    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete")
      .set("Authorization", `Bearer ${token()}`)
      .send({ confirm: "EXCLUIR", password: PASSWORD });

    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(dbFake.state.accounts.find((a) => a.id === ACCOUNT_ID)).toBeTruthy();
    expect(dbFake.state.links.filter((l) => l.account_id === ACCOUNT_ID)).toHaveLength(2);
    expect(dbFake.state.audit).toHaveLength(0);
  });

  it("sem token ⇒ 401 e nada é apagado", async () => {
    seedPasswordAccount();
    const res = await request(createApp())
      .post("/api/v1/accounts/me/delete")
      .send({ confirm: "EXCLUIR", password: PASSWORD });
    expect(res.status).toBe(401);
    expect(dbFake.deleteOrder()).toEqual([]);
  });
});
