import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/kikin_cliente";
process.env.JWT_SECRET ??= "test-jwt-secret-for-kikin-cliente-32chars-min!";
process.env.KIKIN_CLIENT_PORTAL_SECRET ??= "test-portal-secret-1234567890";
process.env.WHATSAPP_DEV_RETURN_CODE = "true";

/**
 * LISTA DE SUPRESSÃO do portal (lacuna G-12): reaplicação da exclusão depois de restaurar um
 * backup do banco do portal.
 *
 * 100% mockado: NENHUM Postgres real (a `db.js` real é trocada por um stub que EXPLODE se alguém
 * tentar usá-la — garantia de que nenhum dado de teste é persistido) e nenhuma chamada de rede.
 *  - `../db.js`: stub proibido (o script recebe o banco por injeção: `db` nas opções).
 *  - banco FAKE em memória que modela `client_accounts`, `account_establishment_links`,
 *    `push_subscriptions`, `client_account_sessions`, `client_email_tokens`, `client_otp_codes`,
 *    `client_temp_signup` e `account_deletion_log`; registra toda query na ordem e simula
 *    ROLLBACK, para que "dry-run não apaga nada" e "falha não deixa supressão pela metade"
 *    sejam verificáveis de verdade.
 */

const SECRET = process.env.KIKIN_CLIENT_PORTAL_SECRET as string;

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_EMAIL = "titular.excluido@example.com";
const OTHER_ACCOUNT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THIRD_ACCOUNT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const WA_PHONE = "5511988887777";
const WA_PHONE_HASH = "a".repeat(64);
const LINK_PHONE_HASH = "b".repeat(64);
const OTHER_PHONE_HASH = "c".repeat(64);

// ---------------------------------------------------------------- fake do banco

const dbFake = vi.hoisted(() => {
  const state = {
    accounts: [] as any[],
    links: [] as any[],
    push: [] as any[],
    sessions: [] as any[],
    emailTokens: [] as any[],
    otp: [] as any[],
    tempSignup: [] as any[],
    audit: [] as any[],
    calls: [] as Array<{ text: string; params: any[] }>,
    /** Simulações de banco incompleto / defeito real (nunca ligadas por padrão). */
    fail: {
      logMissing: false,
      accountsMissing: false,
      deleteFailsFor: new Set<string>(),
    },
  };

  function reset() {
    state.accounts = [];
    state.links = [];
    state.push = [];
    state.sessions = [];
    state.emailTokens = [];
    state.otp = [];
    state.tempSignup = [];
    state.audit = [];
    state.calls = [];
    state.fail = { logMissing: false, accountsMissing: false, deleteFailsFor: new Set<string>() };
  }

  function snapshot(): string {
    return JSON.stringify({
      accounts: state.accounts,
      links: state.links,
      push: state.push,
      sessions: state.sessions,
      emailTokens: state.emailTokens,
      otp: state.otp,
      tempSignup: state.tempSignup,
      audit: state.audit,
    });
  }

  function restore(snap: string) {
    const s = JSON.parse(snap);
    state.accounts = s.accounts;
    state.links = s.links;
    state.push = s.push;
    state.sessions = s.sessions;
    state.emailTokens = s.emailTokens;
    state.otp = s.otp;
    state.tempSignup = s.tempSignup;
    state.audit = s.audit;
  }

  function callList() {
    return state.calls;
  }

  /** Nomes das tabelas em DELETE, na ORDEM em que foram executados. */
  function deleteOrder(): string[] {
    return state.calls
      .filter((c) => /^\s*DELETE FROM/i.test(c.text))
      .map((c) => /^\s*DELETE FROM\s+([a-z_]+)/i.exec(c.text)?.[1] || "?");
  }

  function relationMissing(name: string): Error {
    const e = new Error(`relation "${name}" does not exist`) as Error & { code: string };
    e.code = "42P01";
    return e;
  }

  async function runQuery(
    text: string,
    params: any[] = []
  ): Promise<{ rows: any[]; rowCount: number | null }> {
    state.calls.push({ text, params });
    const sql = text.replace(/\s+/g, " ").trim();

    // ------------------------------------------------------- account_deletion_log
    if (/SELECT DISTINCT account_ref_hash FROM account_deletion_log/i.test(sql)) {
      if (state.fail.logMissing) throw relationMissing("account_deletion_log");
      const rows = [...new Set(state.audit.map((a) => a.account_ref_hash))];
      return { rows: rows.map((account_ref_hash) => ({ account_ref_hash })), rowCount: rows.length };
    }
    if (/INSERT INTO account_deletion_log/i.test(sql)) {
      state.audit.push({ id: `audit-${state.audit.length + 1}`, account_ref_hash: params[0] });
      return { rows: [{ id: `audit-${state.audit.length}` }], rowCount: 1 };
    }

    // ------------------------------------------------------------- client_accounts
    if (/^SELECT id FROM client_accounts$/i.test(sql)) {
      if (state.fail.accountsMissing) throw relationMissing("client_accounts");
      const rows = state.accounts.map((a) => ({ id: a.id }));
      return { rows, rowCount: rows.length };
    }
    if (/SELECT whatsapp_phone_hash FROM client_accounts WHERE id = \$1/i.test(sql)) {
      const row = state.accounts.find((a) => a.id === params[0]);
      return {
        rows: row ? [{ whatsapp_phone_hash: row.whatsapp_phone_hash ?? null }] : [],
        rowCount: row ? 1 : 0,
      };
    }
    if (/DELETE FROM client_accounts WHERE id = \$1/i.test(sql)) {
      const before = state.accounts.length;
      if (state.fail.deleteFailsFor.has(params[0])) {
        // Erro no formato do Postgres: a mensagem CARREGA o id da conta — é justamente o caso
        // que o script precisa sanitizar antes de logar.
        throw new Error(
          `update or delete on table "client_accounts" violates foreign key constraint ` +
            `"outra_tabela_account_id_fkey" on table "outra_tabela": Key (id)=(${params[0]})`
        );
      }
      state.accounts = state.accounts.filter((a) => a.id !== params[0]);
      return { rows: [], rowCount: before - state.accounts.length };
    }

    // ------------------------------------------------- account_establishment_links
    if (/SELECT DISTINCT phone_hash FROM account_establishment_links WHERE account_id = \$1/i.test(sql)) {
      const rows = [...new Set(state.links.filter((l) => l.account_id === params[0]).map((l) => l.phone_hash))];
      return { rows: rows.filter(Boolean).map((phone_hash) => ({ phone_hash })), rowCount: rows.length };
    }
    if (/DELETE FROM account_establishment_links WHERE account_id = \$1/i.test(sql)) {
      const before = state.links.length;
      state.links = state.links.filter((l) => l.account_id !== params[0]);
      return { rows: [], rowCount: before - state.links.length };
    }

    // ---------------------------------------------------------- push_subscriptions
    if (/DELETE FROM push_subscriptions WHERE account_id = \$1/i.test(sql)) {
      const before = state.push.length;
      state.push = state.push.filter((p) => p.account_id !== params[0]);
      return { rows: [], rowCount: before - state.push.length };
    }

    // ------------------------------------------------------ client_email_tokens
    if (/DELETE FROM client_email_tokens WHERE account_id = \$1/i.test(sql)) {
      const before = state.emailTokens.length;
      state.emailTokens = state.emailTokens.filter((t) => t.account_id !== params[0]);
      return { rows: [], rowCount: before - state.emailTokens.length };
    }

    // --------------------------------------------------- client_account_sessions
    if (/DELETE FROM client_account_sessions WHERE account_id = \$1/i.test(sql)) {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((s) => s.account_id !== params[0]);
      return { rows: [], rowCount: before - state.sessions.length };
    }

    // ------------------------------------- client_otp_codes / client_temp_signup
    if (/DELETE FROM client_otp_codes WHERE phone_hash = ANY\(\$1::text\[\]\)/i.test(sql)) {
      const hashes: string[] = params[0] || [];
      const before = state.otp.length;
      state.otp = state.otp.filter((o) => !hashes.includes(o.phone_hash));
      return { rows: [], rowCount: before - state.otp.length };
    }
    if (/DELETE FROM client_temp_signup WHERE phone_hash = ANY\(\$1::text\[\]\)/i.test(sql)) {
      const hashes: string[] = params[0] || [];
      const before = state.tempSignup.length;
      state.tempSignup = state.tempSignup.filter((t) => !hashes.includes(t.phone_hash));
      return { rows: [], rowCount: before - state.tempSignup.length };
    }

    throw new Error(`[teste] SQL inesperado no fake do banco: ${text}`);
  }

  return { state, reset, snapshot, restore, callList, deleteOrder, runQuery };
});

// Stub PROIBIDO: se o script (ou o serviço) tocar no Postgres real, o teste falha em vez de
// gravar qualquer coisa. O script recebe o banco fake por injeção.
vi.mock("../db.js", () => ({
  query: async () => {
    throw new Error("[teste] a db.js real NÃO pode ser usada neste arquivo — use o banco fake");
  },
  withTransaction: async () => {
    throw new Error("[teste] a db.js real NÃO pode ser usada neste arquivo — use o banco fake");
  },
  pool: {},
}));

// ------------------------------------------------------------------- imports

const { accountRefHash, purgePortalAccountRows, DELETION_ORDER } = await import(
  "../modules/lgpd/lgpd.service.js"
);
const { applySuppressionList, parseArgs, isMissingSchema, safeReason } = await import(
  "../scripts/apply-suppression-list.js"
);

/** Banco fake no formato `Db` esperado pelo script (query + withTransaction com ROLLBACK). */
const fakeDb = {
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
};

/** Log em memória: nenhuma saída de teste polui o terminal e as linhas ficam auditáveis. */
function collector() {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line), text: () => lines.join("\n") };
}

const short = (hash: string) => hash.slice(0, 12);

// ------------------------------------------------------------------- cenários

/** Conta que pediu exclusão, com UMA linha em cada uma das 7 tabelas do portal. */
function seedSuppressedAccount() {
  dbFake.state.accounts.push({
    id: ACCOUNT_ID,
    email: ACCOUNT_EMAIL,
    full_name: "Titular Que Pediu Exclusão",
    whatsapp_phone_hash: WA_PHONE_HASH,
    created_at: "2026-01-01T09:00:00.000Z",
  });
  dbFake.state.links.push(
    {
      id: "link-1",
      account_id: ACCOUNT_ID,
      salon_id: "salon-1",
      phone_hash: LINK_PHONE_HASH,
      client_name: "Titular Que Pediu Exclusão",
      phone_masked: "(11) ****-2222",
    },
    { id: "link-2", account_id: ACCOUNT_ID, salon_id: "salon-2", phone_hash: LINK_PHONE_HASH },
    // vínculo de OUTRA conta com o MESMO hash: não pode ser tocado pela supressão desta conta
    { id: "link-9", account_id: OTHER_ACCOUNT_ID, salon_id: "salon-1", phone_hash: OTHER_PHONE_HASH }
  );
  dbFake.state.push.push({ id: "push-1", account_id: ACCOUNT_ID, endpoint: "https://fcm.example/x" });
  dbFake.state.sessions.push(
    { id: "ses-1", account_id: ACCOUNT_ID },
    { id: "ses-2", account_id: ACCOUNT_ID }
  );
  dbFake.state.emailTokens.push({ id: "mail-1", account_id: ACCOUNT_ID });
  dbFake.state.otp.push(
    { id: "otp-1", phone_hash: WA_PHONE_HASH, purpose: "login" },
    { id: "otp-2", phone_hash: LINK_PHONE_HASH, purpose: "account_deletion" }
  );
  dbFake.state.tempSignup.push({ id: "tmp-1", phone_hash: LINK_PHONE_HASH });
}

/** Conta que NUNCA pediu exclusão (não pode ser tocada) + o registro de auditoria do titular. */
function seedOtherAccountAndAudit(refHash = accountRefHash(ACCOUNT_ID)) {
  dbFake.state.accounts.push(
    { id: OTHER_ACCOUNT_ID, email: "outra.pessoa@example.com", whatsapp_phone_hash: OTHER_PHONE_HASH },
    { id: THIRD_ACCOUNT_ID, email: "terceira.pessoa@example.com", whatsapp_phone_hash: null }
  );
  dbFake.state.push.push({ id: "push-9", account_id: OTHER_ACCOUNT_ID, endpoint: "https://fcm.example/y" });
  // auditoria da exclusão original (Art. 37): sobreviveu à exclusão, sem FK
  dbFake.state.audit.push({
    id: "audit-1",
    account_ref_hash: refHash,
    email_hash: "e".repeat(64),
    proof_method: "password",
    removed_counts: { client_accounts: 1 },
  });
}

beforeEach(() => {
  dbFake.reset();
  delete process.env.SUPPRESSION_APPLY;
});

// ============================================================================
// (a) HMAC que BATE ⇒ purga as 7 tabelas com as contagens corretas
// ============================================================================

describe("lista de supressão — conta suprimida que voltou com o backup", () => {
  it("HMAC do id bate com a auditoria ⇒ purga as 7 tabelas na ordem FK-segura e devolve as contagens", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();
    const { lines, log } = collector();

    const report = await applySuppressionList({ apply: true, db: fakeDb, log });

    expect(report.mode).toBe("apply");
    expect(report.suppressions).toBe(1); // 1 pedido de exclusão registrado
    expect(report.accountsScanned).toBe(3); // 3 contas existentes no banco restaurado
    expect(report.matched).toEqual([short(accountRefHash(ACCOUNT_ID))]);
    expect(report.failures).toEqual([]);
    expect(report.skipped).toBeNull();

    // contagens por tabela — exatamente as 7 chaves de PORTAL_ACCOUNT_TABLES
    expect(report.purged).toHaveLength(1);
    expect(report.purged[0].removed).toEqual({
      push_subscriptions: 1,
      client_email_tokens: 1,
      client_account_sessions: 2,
      account_establishment_links: 2,
      client_otp_codes: 2,
      client_temp_signup: 1,
      client_accounts: 1,
    });
    expect(report.purged[0].total).toBe(10);
    expect(Object.keys(report.purged[0].removed).sort()).toEqual([...DELETION_ORDER].sort());

    // ordem FK-segura e NENHUM outro DELETE no banco
    expect(dbFake.deleteOrder()).toEqual([...DELETION_ORDER]);

    // a conta não existe mais em nenhuma tabela do portal
    expect(dbFake.state.accounts.find((a) => a.id === ACCOUNT_ID)).toBeUndefined();
    expect(dbFake.state.links.filter((l) => l.account_id === ACCOUNT_ID)).toHaveLength(0);
    expect(dbFake.state.push.filter((p) => p.account_id === ACCOUNT_ID)).toHaveLength(0);
    expect(dbFake.state.sessions.filter((s) => s.account_id === ACCOUNT_ID)).toHaveLength(0);
    expect(dbFake.state.emailTokens.filter((t) => t.account_id === ACCOUNT_ID)).toHaveLength(0);
    expect(dbFake.state.otp.filter((o) => o.phone_hash === WA_PHONE_HASH)).toHaveLength(0);
    expect(dbFake.state.tempSignup.filter((t) => t.phone_hash === LINK_PHONE_HASH)).toHaveLength(0);

    // nada de terceiros foi tocado; a auditoria original permanece (não é reescrita nem duplicada)
    expect(dbFake.state.accounts.find((a) => a.id === OTHER_ACCOUNT_ID)).toBeTruthy();
    expect(dbFake.state.accounts.find((a) => a.id === THIRD_ACCOUNT_ID)).toBeTruthy();
    expect(dbFake.state.push.filter((p) => p.account_id === OTHER_ACCOUNT_ID)).toHaveLength(1);
    expect(dbFake.state.audit).toHaveLength(1);

    // o modo ativo é dito explicitamente no log
    expect(lines[0]).toContain("APPLY");
    expect(lines.join("\n")).toContain("conta suprimida apagada");
  });

  it("usa a MESMA função de remoção da exclusão: `purgePortalAccountRows` é o único caminho", async () => {
    // Chamada direta da função extraída (contrato reutilizável): 7 chaves, nunca ausentes.
    seedSuppressedAccount();
    const removed = await fakeDb.withTransaction((tx: any) => purgePortalAccountRows(tx, ACCOUNT_ID));
    expect(Object.keys(removed).sort()).toEqual([...DELETION_ORDER].sort());
    expect(removed.client_accounts).toBe(1);
    expect(dbFake.deleteOrder()).toEqual([...DELETION_ORDER]);
  });
});

// ============================================================================
// (b) HMAC que NÃO bate ⇒ nada é apagado
// ============================================================================

describe("lista de supressão — conta que não corresponde a nenhum pedido", () => {
  it("hash registrado com outro segredo ⇒ nenhuma conta é apagada", async () => {
    seedSuppressedAccount();
    // Pedido de exclusão registrado com OUTRO segredo (ex.: segredo rotacionado/banco de outro
    // ambiente): o HMAC não bate e a supressão não pode adivinhar quem apagar.
    const outroSegredo = crypto
      .createHmac("sha256", "outro-segredo-do-portal")
      .update(ACCOUNT_ID)
      .digest("hex");
    seedOtherAccountAndAudit(outroSegredo);
    const { log } = collector();

    const report = await applySuppressionList({ apply: true, db: fakeDb, log });

    expect(report.matched).toEqual([]);
    expect(report.purged).toEqual([]);
    expect(report.failures).toEqual([]);
    expect(dbFake.deleteOrder()).toEqual([]);
    expect(dbFake.state.accounts).toHaveLength(3);
    expect(dbFake.state.links.filter((l) => l.account_id === ACCOUNT_ID)).toHaveLength(2);
    expect(dbFake.state.push).toHaveLength(2);
    expect(dbFake.state.audit).toHaveLength(1);
  });

  it("sem nenhum pedido de exclusão registrado ⇒ nada é varrido e nada é apagado", async () => {
    seedSuppressedAccount(); // conta existe, mas NÃO há auditoria de exclusão
    const { lines, log } = collector();

    const report = await applySuppressionList({ apply: true, db: fakeDb, log });

    expect(report.suppressions).toBe(0);
    expect(report.accountsScanned).toBe(0); // nem chega a varrer client_accounts
    expect(dbFake.deleteOrder()).toEqual([]);
    expect(dbFake.state.accounts).toHaveLength(1);
    expect(lines.join("\n")).toContain("nenhum pedido de exclusão registrado");
  });
});

// ============================================================================
// (c) DRY-RUN (padrão) não executa nenhum DELETE
// ============================================================================

describe("lista de supressão — modo dry-run (padrão)", () => {
  it("relata o que faria, sem executar UM ÚNICO DELETE e sem escrever nada", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();
    const before = dbFake.snapshot();
    const { lines, log } = collector();

    const report = await applySuppressionList({ db: fakeDb, log }); // sem `apply`

    expect(report.mode).toBe("dry-run");
    expect(report.matched).toEqual([short(accountRefHash(ACCOUNT_ID))]);
    expect(report.purged).toEqual([]);
    expect(report.failures).toEqual([]);

    // nenhum DELETE, nenhum INSERT, nada mudou no "banco"
    expect(dbFake.deleteOrder()).toEqual([]);
    expect(dbFake.callList().every((c) => !/DELETE|INSERT|UPDATE/i.test(c.text))).toBe(true);
    expect(dbFake.snapshot()).toBe(before);

    expect(lines[0]).toContain("DRY-RUN");
    expect(lines.join("\n")).toContain("NADA será apagado");
    expect(lines.join("\n")).toContain("seria apagada agora");
  });

  it("a varredura lê SOMENTE o id das contas (minimização: nada de e-mail/telefone/nome)", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();
    const { log } = collector();

    await applySuppressionList({ db: fakeDb, log });

    const selects = dbFake.callList().filter((c) => /^\s*SELECT/i.test(c.text));
    expect(selects.map((c) => c.text.replace(/\s+/g, " ").trim())).toEqual([
      "SELECT DISTINCT account_ref_hash FROM account_deletion_log",
      "SELECT id FROM client_accounts",
    ]);
  });
});

// ============================================================================
// (d) Idempotência
// ============================================================================

describe("lista de supressão — idempotência", () => {
  it("a segunda execução não encontra mais a conta e não apaga nem duplica auditoria", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();

    const primeira = await applySuppressionList({ apply: true, db: fakeDb, log: () => undefined });
    expect(primeira.purged).toHaveLength(1);
    const deletesDepoisDaPrimeira = dbFake.deleteOrder().length;
    expect(deletesDepoisDaPrimeira).toBe(DELETION_ORDER.length);

    const segunda = await applySuppressionList({ apply: true, db: fakeDb, log: () => undefined });

    expect(segunda.matched).toEqual([]);
    expect(segunda.purged).toEqual([]);
    expect(segunda.accountsScanned).toBe(2); // só as contas que nunca pediram exclusão
    expect(segunda.suppressions).toBe(1); // o registro do Art. 37 continua lá, intacto
    // nenhum DELETE novo e nenhuma linha de auditoria acrescentada
    expect(dbFake.deleteOrder().length).toBe(deletesDepoisDaPrimeira);
    expect(dbFake.state.audit).toHaveLength(1);

    // rodar uma terceira vez é igualmente inofensivo
    const terceira = await applySuppressionList({ db: fakeDb, log: () => undefined });
    expect(terceira.matched).toEqual([]);
    expect(dbFake.state.audit).toHaveLength(1);
  });
});

// ============================================================================
// (e) Nenhum log contém dado em claro (e nem o relatório/JSON)
// ============================================================================

describe("lista de supressão — nenhum dado pessoal na saída (LGPD, minimização)", () => {
  const PROIBIDOS = [
    ACCOUNT_ID,
    OTHER_ACCOUNT_ID,
    THIRD_ACCOUNT_ID,
    ACCOUNT_EMAIL,
    "outra.pessoa@example.com",
    WA_PHONE,
    "Titular Que Pediu Exclusão",
    WA_PHONE_HASH,
    LINK_PHONE_HASH,
    OTHER_PHONE_HASH,
  ];

  function expectSemPII(texto: string) {
    for (const proibido of PROIBIDOS) expect(texto).not.toContain(proibido);
    // nem qualquer hash COMPLETO (64 hex): o log traz só o pseudônimo curto
    expect(texto).not.toMatch(/[0-9a-f]{64}/);
  }

  it("no modo apply: log e relatório só trazem hash CURTO + contagens", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();
    const { log, text } = collector();

    const report = await applySuppressionList({ apply: true, db: fakeDb, log });

    expectSemPII(text());
    expectSemPII(JSON.stringify(report));
    // o pseudônimo CURTO está presente (é o que permite correlacionar com a auditoria)
    const refCurto = short(accountRefHash(ACCOUNT_ID));
    expect(text()).toContain(refCurto);
    expect(report.matched).toContain(refCurto);
    expect(text()).toContain("push_subscriptions=1");
  });

  it("no dry-run: idem (a conta suprimida aparece apenas como hash curto)", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();
    const { log, text } = collector();

    const report = await applySuppressionList({ db: fakeDb, log });

    expectSemPII(text());
    expectSemPII(JSON.stringify(report));
    expect(text()).toContain(short(accountRefHash(ACCOUNT_ID)));
  });

  it("quando a supressão FALHA, o motivo também não vaza o id da conta", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();
    // Erro no formato do Postgres, com o id dentro da mensagem (Key (id)=(uuid)).
    dbFake.state.fail.deleteFailsFor.add(ACCOUNT_ID);
    const { log, text } = collector();

    const report = await applySuppressionList({ apply: true, db: fakeDb, log });

    expect(report.purged).toEqual([]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].ref).toBe(short(accountRefHash(ACCOUNT_ID)));
    expect(report.failures[0].reason).toContain("[id]");
    expectSemPII(text());
    expectSemPII(JSON.stringify(report));
  });
});

// ============================================================================
// Robustez: banco antigo (schema incompleto), falha parcial e CLI
// ============================================================================

describe("lista de supressão — tolerância e CLI", () => {
  it("banco antigo sem a tabela de auditoria ⇒ não explode: informa o motivo e não apaga nada", async () => {
    seedSuppressedAccount();
    dbFake.state.fail.logMissing = true;
    const { lines, log } = collector();

    const report = await applySuppressionList({ apply: true, db: fakeDb, log });

    expect(report.skipped).toContain("account_deletion_log");
    expect(report.purged).toEqual([]);
    expect(report.failures).toEqual([]);
    expect(dbFake.deleteOrder()).toEqual([]);
    expect(dbFake.state.accounts).toHaveLength(1);
    expect(lines.join("\n")).toContain("schema antigo");
  });

  it("banco antigo sem client_accounts ⇒ não explode e informa o motivo", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();
    dbFake.state.fail.accountsMissing = true;
    const { log } = collector();

    const report = await applySuppressionList({ apply: true, db: fakeDb, log });

    expect(report.skipped).toContain("client_accounts");
    expect(report.matched).toEqual([]);
    expect(dbFake.deleteOrder()).toEqual([]);
  });

  it("falha em UMA conta não impede o relatório das outras e faz ROLLBACK daquela conta", async () => {
    seedSuppressedAccount();
    seedOtherAccountAndAudit();
    // a SEGUNDA conta suprimida (a terceira do banco) falha ao ser apagada
    dbFake.state.accounts.find((a) => a.id === THIRD_ACCOUNT_ID).whatsapp_phone_hash = null;
    dbFake.state.audit.push({
      id: "audit-2",
      account_ref_hash: accountRefHash(THIRD_ACCOUNT_ID),
      proof_method: "password",
      removed_counts: {},
    });
    dbFake.state.fail.deleteFailsFor.add(THIRD_ACCOUNT_ID);
    const { log } = collector();

    const report = await applySuppressionList({ apply: true, db: fakeDb, log });

    expect(report.matched).toHaveLength(2);
    expect(report.purged.map((p) => p.ref)).toEqual([short(accountRefHash(ACCOUNT_ID))]);
    expect(report.failures.map((f) => f.ref)).toEqual([short(accountRefHash(THIRD_ACCOUNT_ID))]);
    // rollback da conta que falhou: ela continua lá (supressão pela metade não é aceita)
    expect(dbFake.state.accounts.find((a) => a.id === THIRD_ACCOUNT_ID)).toBeTruthy();
    expect(dbFake.state.accounts.find((a) => a.id === ACCOUNT_ID)).toBeUndefined();
  });

  it("reconhece os erros de schema ausente do Postgres (e não erros reais)", () => {
    expect(isMissingSchema(Object.assign(new Error("x"), { code: "42P01" }))).toBe(true);
    expect(isMissingSchema(Object.assign(new Error("x"), { code: "42703" }))).toBe(true);
    expect(isMissingSchema(new Error('relation "client_accounts" does not exist'))).toBe(true);
    expect(isMissingSchema(new Error("connection terminated unexpectedly"))).toBe(false);
    expect(isMissingSchema(new Error('duplicate key value violates unique constraint'))).toBe(false);
  });

  it("safeReason troca o id por [id] e encurta a mensagem", () => {
    const reason = safeReason(new Error(`Key (id)=(${ACCOUNT_ID}) já existe`), ACCOUNT_ID);
    expect(reason).toContain("[id]");
    expect(reason).not.toContain(ACCOUNT_ID);
    expect(safeReason(new Error("x".repeat(500)), ACCOUNT_ID).length).toBeLessThanOrEqual(300);
  });

  it("CLI: padrão é DRY-RUN; --apply aplica; --dry-run tem precedência; SUPPRESSION_APPLY=true aplica", () => {
    expect(parseArgs([], {})).toEqual({ apply: false, json: false });
    expect(parseArgs(["--apply"], {})).toEqual({ apply: true, json: false });
    expect(parseArgs(["--apply", "--json"], {})).toEqual({ apply: true, json: true });
    expect(parseArgs(["--apply", "--dry-run"], {})).toEqual({ apply: false, json: false });
    expect(parseArgs([], { SUPPRESSION_APPLY: "true" })).toEqual({ apply: true, json: false });
    expect(parseArgs([], { SUPPRESSION_APPLY: "TRUE" })).toEqual({ apply: true, json: false });
    expect(parseArgs([], { SUPPRESSION_APPLY: "0" })).toEqual({ apply: false, json: false });
    expect(parseArgs(["--json"], { SUPPRESSION_APPLY: "não" })).toEqual({ apply: false, json: true });
  });
});
