import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query, withTransaction } from "../../db.js";
import { config } from "../../config.js";
import { err, normalizeEmail } from "../accounts/accounts.service.js";
import * as links from "../links/links.service.js";
import * as whatsappAuth from "../../services/whatsapp/whatsapp-auth.service.js";

/**
 * Direitos do titular no PORTAL DO CLIENTE (LGPD Art. 18): exportação (portabilidade/
 * acesso) e exclusão da conta.
 *
 * DECISÕES DE PRODUTO (obrigatórias — ver /tmp/lgpd-portal.md):
 *  1. EXCLUSÃO = apagar SOMENTE a conta da área do cliente (este portal/gateway).
 *     NADA é anonimizado nem apagado no Kikin: o cadastro do cliente e os agendamentos
 *     nos estabelecimentos permanecem intactos (são dados do ESTABELECIMENTO, que é o
 *     controlador daquela relação). O export e a UI dizem isso com todas as letras.
 *  2. EXPORT = JSON estruturado, baixado como arquivo (Content-Disposition).
 *  3. Prova de identidade na exclusão = senha (conta com senha local) OU código OTP do
 *     WhatsApp no número cadastrado (conta sem senha), sempre + digitar "EXCLUIR".
 *  4. Auditoria (Art. 37) em `account_deletion_log`, sem PII em claro (hashes/contagens).
 */

// --------------------------------------------------------------------- db injetável

export type Row = Record<string, any>;

export interface DbClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface Db extends DbClient {
  withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
}

const realDb: Db = {
  query: (text, params) => query(text, params) as unknown as Promise<{ rows: any[]; rowCount: number | null }>,
  withTransaction: (fn) => withTransaction((client) => fn(client as unknown as DbClient)),
};

// ------------------------------------------------- tabelas do portal com dados da conta

/**
 * TODAS as tabelas do banco do PORTAL (kikin_cliente) que guardam dados da conta/identidade.
 * Enumeração feita no schema real (information_schema) — nenhuma é presumida:
 *
 *  1. client_accounts             — a conta em si: e-mail, nome, hash de senha, ids sociais,
 *                                   hash/máscara/valor cifrado do WhatsApp, aceite dos termos.
 *  2. client_account_sessions     — sessões/tokens de refresh (hash do token) + IP/user-agent.
 *  3. client_email_tokens         — tokens de verificação de e-mail e reset de senha (hash).
 *  4. account_establishment_links — vínculos com estabelecimentos: nome do cliente no salão,
 *                                   hash + máscara do telefone, consentimento de WhatsApp.
 *  5. push_subscriptions          — inscrições de Web Push (endpoint + chaves do navegador).
 *  6. client_otp_codes            — códigos OTP por hash de telefone (login e exclusão);
 *                                   não tem account_id: casa pelo hash do telefone da conta.
 *  7. client_temp_signup          — rascunho pós-OTP (hash/máscara/valor cifrado do telefone).
 *
 * `client_schema_migrations` NÃO entra: guarda só o nome/instante das migrações aplicadas
 * (dado operacional do schema, sem qualquer dado pessoal).
 */
export const PORTAL_ACCOUNT_TABLES = [
  "client_accounts",
  "client_account_sessions",
  "client_email_tokens",
  "account_establishment_links",
  "push_subscriptions",
  "client_otp_codes",
  "client_temp_signup",
] as const;

export type PortalAccountTable = (typeof PORTAL_ACCOUNT_TABLES)[number];

/**
 * Ordem FK-segura de remoção: todas as tabelas filhas (ON DELETE CASCADE de
 * client_accounts) e as tabelas casadas por hash de telefone saem ANTES da conta.
 */
export const DELETION_ORDER: readonly PortalAccountTable[] = [
  "push_subscriptions",
  "client_email_tokens",
  "client_account_sessions",
  "account_establishment_links",
  "client_otp_codes",
  "client_temp_signup",
  "client_accounts",
];

export const CONFIRM_WORD = "EXCLUIR";

const AVISO_ESCOPO =
  "Este arquivo contém SOMENTE os dados que o portal kikin cliente (área do cliente) guarda " +
  "sobre você: sua conta, seus vínculos com estabelecimentos e os agendamentos que o portal " +
  "consegue ler no kikin. O cadastro e os agendamentos que você tem em cada salão/barbearia/" +
  "clínica são dados do próprio ESTABELECIMENTO e não pertencem a este portal: excluir sua " +
  "conta aqui NÃO os remove. Para exportar ou remover esses dados no salão, fale diretamente " +
  "com o estabelecimento.";

// ------------------------------------------------------------------------- utilidades

/** HMAC-SHA256 com o segredo do portal: pseudônimo estável e não reversível para auditoria. */
function hmac(value: string | null | undefined): string | null {
  if (!value) return null;
  return crypto.createHmac("sha256", config.KIKIN_CLIENT_PORTAL_SECRET).update(value).digest("hex");
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Host do endpoint de push — nunca o endpoint inteiro (ele carrega um token do navegador). */
function endpointHost(endpoint: string | null | undefined): string {
  if (!endpoint) return "desconhecido";
  try {
    return new URL(endpoint).host || "desconhecido";
  } catch {
    return "desconhecido";
  }
}

function dateStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// =============================================================================
// 1. EXPORTAÇÃO (GET /api/v1/accounts/me/export)
// =============================================================================

export interface AccountExport {
  formatVersion: number;
  generatedAt: string;
  conta: Row;
  vinculos: Row[];
  agendamentos: { futuros: Row[]; historico: Row[] };
  consentimentos: Row[];
  push: { dispositivos: Row[] };
  seguranca: Row;
  aviso: string;
}

interface AccountRow {
  id: string;
  email: string | null;
  full_name: string;
  email_verified_at: Date | null;
  avatar_url: string | null;
  auth_provider: string;
  whatsapp_phone_masked: string | null;
  consent_terms_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Monta o JSON de exportação. NUNCA inclui hash de senha, token, telefone cru ou endereço de push. */
export async function buildAccountExport(accountId: string, db: Db = realDb): Promise<AccountExport> {
  const accRes = await db.query<AccountRow>(
    `SELECT id, email, full_name, email_verified_at, avatar_url, auth_provider,
            whatsapp_phone_masked, consent_terms_at, created_at, updated_at
     FROM client_accounts WHERE id = $1`,
    [accountId]
  );
  const acc = accRes.rows[0];
  if (!acc) throw err(404, "NOT_FOUND", "Conta não encontrada.");

  const [linkList, futuros, historico, pushRes, sessRes, mailRes] = await Promise.all([
    links.listLinks(accountId).catch(() => [] as links.EstablishmentLink[]),
    links.listFutureAppointments(accountId).catch(() => [] as links.FutureAppointment[]),
    links.listAppointmentsHistory(accountId).catch(() => [] as links.FutureAppointment[]),
    db.query<{ endpoint: string; created_at: Date }>(
      `SELECT endpoint, created_at FROM push_subscriptions WHERE account_id = $1 ORDER BY created_at`,
      [accountId]
    ),
    db.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM client_account_sessions
       WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [accountId]
    ),
    db.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM client_email_tokens
       WHERE account_id = $1 AND used_at IS NULL AND expires_at > now()`,
      [accountId]
    ),
  ]);

  const vinculos = linkList.map((l) => ({
    id: l.id,
    estabelecimentoId: l.salonId,
    estabelecimentoNome: l.salonName || null,
    nomeNoEstabelecimento: l.clientName,
    telefoneMascarado: l.phoneMask,
    vinculadoEm: iso(l.confirmedAt),
    whatsappOptInEm: iso(l.whatsappOptInAt),
  }));

  const mapAppointments = (list: links.FutureAppointment[]) =>
    list.map((a) => ({
      id: a.id,
      grupoId: a.groupId,
      estabelecimentoId: a.salonId,
      estabelecimentoNome: a.salonName || null,
      servico: a.serviceName,
      profissional: a.staffName,
      inicio: iso(a.startAt),
      fim: a.endAt ? iso(a.endAt) : null,
      duracaoMin: a.durationMin,
      situacao: a.status,
    }));

  const dispositivos = pushRes.rows.map((p) => ({
    host: endpointHost(p.endpoint),
    criadoEm: iso(p.created_at),
  }));

  const consentimentos: Row[] = [
    {
      tipo: "termos_e_politica_de_privacidade",
      origem: "cadastro_no_portal",
      registradoEm: iso(acc.consent_terms_at),
      revogadoEm: null,
    },
    ...vinculos
      .filter((v) => v.whatsappOptInEm)
      .map((v) => ({
        tipo: "whatsapp_por_estabelecimento",
        estabelecimentoId: v.estabelecimentoId,
        registradoEm: v.whatsappOptInEm,
        revogadoEm: null,
      })),
    ...dispositivos.map((d) => ({
      tipo: "notificacoes_push",
      host: d.host,
      registradoEm: d.criadoEm,
      revogadoEm: null,
    })),
  ];

  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    conta: {
      id: acc.id,
      nome: acc.full_name,
      email: acc.email,
      emailVerificadoEm: iso(acc.email_verified_at),
      provedorDeLogin: acc.auth_provider,
      whatsappMascarado: acc.whatsapp_phone_masked || null,
      avatarUrl: acc.avatar_url || null,
      criadaEm: iso(acc.created_at),
      atualizadaEm: iso(acc.updated_at),
    },
    vinculos,
    agendamentos: { futuros: mapAppointments(futuros), historico: mapAppointments(historico) },
    consentimentos,
    push: { dispositivos },
    seguranca: {
      sessoesAtivas: Number(sessRes.rows[0]?.total || 0),
      tokensDeEmailPendentes: Number(mailRes.rows[0]?.total || 0),
    },
    aviso: AVISO_ESCOPO,
  };
}

/** Nome do arquivo de exportação: meus-dados-kikin-AAAA-MM-DD.json */
export function exportFilename(now = new Date()): string {
  return `meus-dados-kikin-${dateStamp(now)}.json`;
}

// =============================================================================
// 2. PEDIDO DE EXCLUSÃO (POST /api/v1/accounts/me/delete/request)
//
// Informa QUAL prova a conta exige e, quando pedido (padrão), dispara o código no
// WhatsApp REUTILIZANDO o mesmo fluxo de OTP do login (client_otp_codes), só com o
// propósito 'account_deletion' — nenhum mecanismo de OTP paralelo.
// =============================================================================

export type DeletionProofMethod = "password" | "whatsapp_otp";

export interface DeletionChallenge {
  method: DeletionProofMethod;
  confirmWord: string;
  whatsappMask?: string | null;
  codeSent?: boolean;
  devCode?: string;
  expiresInMinutes?: number;
}

interface DeletionAccountRow {
  id: string;
  email: string | null;
  email_normalized: string | null;
  password_hash: string | null;
  auth_provider: string;
  whatsapp_phone_hash: string | null;
  whatsapp_phone_enc: string | null;
  whatsapp_phone_masked: string | null;
}

async function loadDeletionAccount(accountId: string, db: DbClient): Promise<DeletionAccountRow> {
  const res = await db.query<DeletionAccountRow>(
    `SELECT id, email, email_normalized, password_hash, auth_provider,
            whatsapp_phone_hash, whatsapp_phone_enc, whatsapp_phone_masked
     FROM client_accounts WHERE id = $1`,
    [accountId]
  );
  const acc = res.rows[0];
  if (!acc) throw err(404, "NOT_FOUND", "Conta não encontrada.");
  return acc;
}

/** Qual prova esta conta aceita? senha local ⇒ senha; senão ⇒ OTP no WhatsApp cadastrado. */
export function proofMethodFor(acc: Pick<DeletionAccountRow, "password_hash" | "whatsapp_phone_hash">): DeletionProofMethod | null {
  if (acc.password_hash) return "password";
  if (acc.whatsapp_phone_hash) return "whatsapp_otp";
  return null;
}

export async function describeDeletionProof(
  accountId: string,
  input: { sendCode?: boolean } = {},
  db: Db = realDb
): Promise<DeletionChallenge> {
  const acc = await loadDeletionAccount(accountId, db);
  const method = proofMethodFor(acc);
  if (!method) {
    throw err(
      409,
      "PROOF_UNAVAILABLE",
      "Sua conta não tem senha nem WhatsApp cadastrado, então não é possível confirmar sua identidade pelo portal. Fale com o suporte do kikin para excluir a conta."
    );
  }

  if (method === "password") {
    return { method, confirmWord: CONFIRM_WORD };
  }

  // Conta WhatsApp: o código só pode ir para o número JÁ cadastrado (nunca para um número
  // digitado na hora — isso não provaria identidade nenhuma).
  const phone = whatsappAuth.decryptAccountPhone(acc.whatsapp_phone_enc);
  if (!phone) {
    throw err(
      409,
      "WHATSAPP_NOT_CONFIRMED",
      "Não conseguimos enviar o código: confirme seu WhatsApp no perfil do portal antes de excluir a conta."
    );
  }

  const base: DeletionChallenge = {
    method,
    confirmWord: CONFIRM_WORD,
    whatsappMask: acc.whatsapp_phone_masked || null,
  };
  // sendCode=false: a UI pergunta o método ao abrir o modal e só dispara o código no
  // botão "Enviar código no WhatsApp" (evita enviar mensagem a cada abertura).
  if (input.sendCode === false) return base;

  const sent = await whatsappAuth.requestWhatsappOtp({ phone, purpose: "account_deletion" });
  return {
    ...base,
    whatsappMask: sent.masked || base.whatsappMask,
    codeSent: true,
    expiresInMinutes: 10,
    ...(sent.devCode ? { devCode: sent.devCode } : {}),
  };
}

// =============================================================================
// 3. EXCLUSÃO (POST /api/v1/accounts/me/delete)
// =============================================================================

export interface DeleteAccountInput {
  confirm?: unknown;
  password?: unknown;
  otpCode?: unknown;
}

export interface DeleteAccountResult {
  deleted: true;
  removed: Record<string, number>;
  proofMethod: DeletionProofMethod;
  auditId: string | null;
  deletedAt: string;
}

export async function deleteAccount(
  accountId: string,
  input: DeleteAccountInput,
  ctx: { ip?: string | null } = {},
  db: Db = realDb
): Promise<DeleteAccountResult> {
  // (a) confirmação explícita digitada
  if (String(input?.confirm ?? "").trim().toUpperCase() !== CONFIRM_WORD) {
    throw err(409, "CONFIRM_INVALID", `Digite ${CONFIRM_WORD} para confirmar a exclusão da conta.`);
  }

  const acc = await loadDeletionAccount(accountId, db);
  const method = proofMethodFor(acc);
  if (!method) {
    throw err(
      409,
      "PROOF_UNAVAILABLE",
      "Sua conta não tem senha nem WhatsApp cadastrado, então não é possível confirmar sua identidade pelo portal. Fale com o suporte do kikin para excluir a conta."
    );
  }

  // (b) prova de identidade — senha (bcrypt) antes da transação: não muda estado.
  let passwordToCheck: string | null = null;
  let otpToCheck: string | null = null;
  if (method === "password") {
    passwordToCheck = String(input?.password ?? "");
    if (!passwordToCheck) throw err(400, "PROOF_REQUIRED", "Informe sua senha para confirmar a exclusão.");
    const ok = await bcrypt.compare(passwordToCheck, acc.password_hash as string);
    if (!ok) throw err(400, "INVALID_PASSWORD", "Senha incorreta. A conta não foi excluída.");
  } else {
    otpToCheck = String(input?.otpCode ?? "").trim();
    if (!/^\d{6}$/.test(otpToCheck)) {
      throw err(400, "PROOF_REQUIRED", "Informe o código de 6 dígitos enviado por WhatsApp.");
    }
    // Confere o código AQUI (fora da transação): um código errado incrementa as tentativas de
    // forma persistente, então o rollback da exclusão nunca "apaga" a tentativa.
    await whatsappAuth.checkWhatsappOtp({
      phoneHash: acc.whatsapp_phone_hash as string,
      code: otpToCheck,
      purpose: "account_deletion",
    });
  }

  const removed: Record<string, number> = {};
  const deletedAt = new Date().toISOString();
  let auditId: string | null = null;

  // (c) UMA transação: consumo do OTP (uso único) + remoção FK-segura + auditoria.
  await db.withTransaction(async (tx) => {
    if (method === "whatsapp_otp") {
      // Consome o código dentro da transação: se qualquer DELETE falhar, o rollback devolve
      // o código ao titular (ele não fica sem prova sem ter sido excluído).
      await whatsappAuth.markWhatsappOtpUsed({
        phoneHash: acc.whatsapp_phone_hash as string,
        code: otpToCheck as string,
        purpose: "account_deletion",
        db: tx,
      });
    }

    // Telefones ligados à conta (o da conta + os dos vínculos): client_otp_codes e
    // client_temp_signup não têm account_id, casam por hash de telefone.
    const linkHashes = await tx.query<{ phone_hash: string }>(
      `SELECT DISTINCT phone_hash FROM account_establishment_links WHERE account_id = $1`,
      [accountId]
    );
    const purgeHashes = new Set<string>();
    for (const r of linkHashes.rows) if (r.phone_hash) purgeHashes.add(r.phone_hash);
    if (acc.whatsapp_phone_hash) purgeHashes.add(acc.whatsapp_phone_hash);
    const hashList = [...purgeHashes];

    const del = async (table: PortalAccountTable, sql: string, params: unknown[]) => {
      const res = await tx.query(sql, params);
      removed[table] = res.rowCount ?? 0;
    };

    // ---- ordem FK-segura (mesma de DELETION_ORDER)
    await del("push_subscriptions", `DELETE FROM push_subscriptions WHERE account_id = $1`, [accountId]);
    await del("client_email_tokens", `DELETE FROM client_email_tokens WHERE account_id = $1`, [accountId]);
    await del("client_account_sessions", `DELETE FROM client_account_sessions WHERE account_id = $1`, [accountId]);
    await del("account_establishment_links", `DELETE FROM account_establishment_links WHERE account_id = $1`, [accountId]);
    if (hashList.length > 0) {
      await del("client_otp_codes", `DELETE FROM client_otp_codes WHERE phone_hash = ANY($1::text[])`, [hashList]);
      await del("client_temp_signup", `DELETE FROM client_temp_signup WHERE phone_hash = ANY($1::text[])`, [hashList]);
    } else {
      removed.client_otp_codes = 0;
      removed.client_temp_signup = 0;
    }
    await del("client_accounts", `DELETE FROM client_accounts WHERE id = $1`, [accountId]);

    // ---- auditoria (Art. 37): mesmos números que acabaram de ser apagados.
    const audit = await tx.query<{ id: string }>(
      `INSERT INTO account_deletion_log
         (account_ref_hash, email_hash, auth_provider, proof_method, removed_counts, ip_hash, deleted_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        hmac(accountId),
        hmac(acc.email_normalized || acc.email),
        acc.auth_provider,
        method,
        JSON.stringify(removed),
        hmac(ctx.ip || null),
        deletedAt,
      ]
    );
    auditId = audit.rows[0]?.id ?? null;
  });

  return { deleted: true, removed, proofMethod: method, auditId, deletedAt };
}

// Reexportado para os testes conseguirem montar o e-mail normalizado igual ao cadastro.
export { normalizeEmail };
