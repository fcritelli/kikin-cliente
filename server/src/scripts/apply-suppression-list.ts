import {
  accountRefHash,
  purgePortalAccountRows,
  realDb,
  type Db,
} from "../modules/lgpd/lgpd.service.js";

/**
 * LISTA DE SUPRESSÃO do portal do cliente (lacuna G-12 do plano LGPD).
 *
 * PROBLEMA: a exclusão de conta do portal é um DELETE real e a auditoria fica em
 * `account_deletion_log` — mas um BACKUP ANTIGO do banco do portal, se restaurado, traz de volta
 * (ressuscita) as contas que o titular mandou apagar. Um pedido de exclusão já exercido
 * (Art. 18, VI) não pode ser desfeito por uma restauração de backup.
 *
 * SOLUÇÃO: `account_deletion_log` guarda o pseudônimo da conta (`account_ref_hash` =
 * HMAC-SHA256(segredo do portal, id da conta)) e SOBREVIVE à exclusão (não tem FK). Este script
 * percorre as contas que existem em `client_accounts`, recalcula o MESMO HMAC do id — com a
 * mesma função do registro, `accountRefHash()`, nunca uma fórmula reescrita aqui — e, para cada
 * conta cujo hash bate com um pedido de exclusão, reaplica a remoção usando a MESMA função da
 * exclusão original: `purgePortalAccountRows()`. Nada de uma segunda lista de tabelas.
 *
 * SEGURANÇA (LGPD, minimização): este script só lê/grava hashes. Nunca imprime e-mail, id, uuid
 * ou telefone em claro — nem quando uma operação falha (o motivo é sanitizado). O que sai é o
 * hash CURTO (12 caracteres) + as contagens por tabela.
 *
 * COMO RODAR (depois de restaurar um backup do banco do PORTAL):
 *   npm run suppression:report --prefix server          # DRY-RUN: só relata o que faria
 *   npm run suppression:apply  --prefix server          # executa a supressão
 *   ... -- --json                                       # saída estruturada (um objeto JSON)
 *   SUPPRESSION_APPLY=true npm run suppression:report   # aplica sem o --apply
 *
 * IDEMPOTENTE: depois de aplicar, a conta não existe mais em `client_accounts`; uma segunda
 * execução não encontra nada (e não recria nada). `account_deletion_log` não é reescrito — o
 * registro original do Art. 37 permanece como está.
 */

// --------------------------------------------------------------------------- tipos

export type SuppressionMode = "dry-run" | "apply";

export interface SuppressionOptions {
  /** `true` executa a supressão; padrão `false` = DRY-RUN (não apaga nada). */
  apply?: boolean;
  /** Banco do portal injetável (testes). Padrão: Postgres real. */
  db?: Db;
  /** Coletor de log (testes/`--json`). Padrão: console.log. */
  log?: (line: string) => void;
}

export interface SuppressionReport {
  generatedAt: string;
  mode: SuppressionMode;
  /** Linhas DISTINTAS de `account_deletion_log`: pedidos de exclusão já registrados. */
  suppressions: number;
  /** Contas existentes varridas em `client_accounts`. */
  accountsScanned: number;
  /** Hash CURTO de cada conta existente que corresponde a um pedido de exclusão. */
  matched: string[];
  /** O que foi apagado, por conta (modo apply). */
  purged: Array<{ ref: string; removed: Record<string, number>; total: number }>;
  /** Contas que deveriam ser suprimidas e NÃO foram (hash curto + motivo sanitizado). */
  failures: Array<{ ref: string; reason: string }>;
  /** Por que nada pôde ser reaplicado (ex.: banco antigo, sem a tabela de auditoria). */
  skipped: string | null;
}

export interface SuppressionCliOptions {
  apply: boolean;
  json: boolean;
}

// ------------------------------------------------------------------------- parsing

/**
 * `--apply` (ou `SUPPRESSION_APPLY=true`) executa; qualquer outra combinação é DRY-RUN.
 * `--dry-run` explícito tem precedência sobre `--apply`: quem pediu "não apague" é atendido.
 */
export function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): SuppressionCliOptions {
  const envApply = /^(1|true|yes|sim|on)$/i.test(String(env.SUPPRESSION_APPLY ?? "").trim());
  const wantsApply = argv.includes("--apply") || envApply;
  return {
    apply: wantsApply && !argv.includes("--dry-run"),
    json: argv.includes("--json"),
  };
}

// ------------------------------------------------------------------------- utilidades

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

/** Nomes de erro do Postgres para "tabela/coluna não existe" — banco antigo, schema incompleto. */
const MISSING_SCHEMA_CODES = new Set(["42P01", "42703", "3F000", "42883", "42704"]);

/**
 * `true` quando o erro é de schema ausente (tabela/coluna/função), e não um defeito real.
 * Reconhece o `code` do driver `pg` e, como rede de segurança, a mensagem (útil para fakes e
 * para mensagens localizadas) — um banco antigo não pode derrubar o script com stack trace.
 */
export function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && MISSING_SCHEMA_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist|undefined_table|undefined_column|não existe/i.test(message);
}

/** Motivo de falha sem NENHUM dado pessoal: o id da conta vira `[id]` e o texto é encurtado. */
export function safeReason(error: unknown, accountId: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split(accountId).join("[id]").replace(/\s+/g, " ").trim().slice(0, 300);
}

function summarize(removed: Record<string, number>): string {
  const parts = Object.entries(removed)
    .filter(([, n]) => Number(n) > 0)
    .map(([table, n]) => `${table}=${n}`);
  return parts.length > 0 ? parts.join(", ") : "nenhuma linha";
}

// ------------------------------------------------------------------------- rotina

/**
 * Reaplica a exclusão das contas suprimidas. Devolve o relatório (também usado pelo `--json`).
 *
 * Em DRY-RUN não executa nenhum SQL de escrita — nem DELETE, nem INSERT. A varredura de contas lê
 * APENAS o `id` (nada de nome/e-mail/telefone): o necessário para recalcular o HMAC.
 */
export async function applySuppressionList(
  options: SuppressionOptions = {}
): Promise<SuppressionReport> {
  const apply = options.apply === true;
  const db = options.db ?? realDb;
  const log = options.log ?? ((line: string) => console.log(line));

  const report: SuppressionReport = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    suppressions: 0,
    accountsScanned: 0,
    matched: [],
    purged: [],
    failures: [],
    skipped: null,
  };

  // O modo ativo é dito com todas as letras: nunca deixar dúvida se aquilo apagou ou não.
  log(
    apply
      ? "🔒 [lista de supressão] MODO: APPLY — as contas suprimidas serão APAGADAS agora."
      : "🔒 [lista de supressão] MODO: DRY-RUN — NADA será apagado (use --apply para executar)."
  );

  // (1) Pedidos de exclusão já registrados (só os hashes; a tabela não tem PII).
  let suppressed: Set<string>;
  try {
    const res = await db.query<{ account_ref_hash: string | null }>(
      `SELECT DISTINCT account_ref_hash FROM account_deletion_log`
    );
    suppressed = new Set(
      res.rows.map((r) => r.account_ref_hash).filter((h): h is string => !!h)
    );
  } catch (error) {
    if (isMissingSchema(error)) {
      report.skipped = "tabela account_deletion_log ausente neste banco (schema antigo)";
      log(`⚠️ [lista de supressão] ${report.skipped}: nada a reaplicar.`);
      return report;
    }
    throw error;
  }

  report.suppressions = suppressed.size;
  log(`   pedidos de exclusão registrados (account_deletion_log): ${report.suppressions}`);

  if (suppressed.size === 0) {
    log("ℹ️ [lista de supressão] nenhum pedido de exclusão registrado: nada a reaplicar.");
    return report;
  }

  // (2) Contas que EXISTEM agora (o backup pode ter trazido de volta as já excluídas).
  let accounts: Array<{ id: string }>;
  try {
    const res = await db.query<{ id: string }>(`SELECT id FROM client_accounts`);
    accounts = res.rows;
  } catch (error) {
    if (isMissingSchema(error)) {
      report.skipped = "tabela client_accounts ausente neste banco (schema antigo)";
      log(`⚠️ [lista de supressão] ${report.skipped}: nada a reaplicar.`);
      return report;
    }
    throw error;
  }
  report.accountsScanned = accounts.length;
  log(`   contas existentes em client_accounts: ${report.accountsScanned}`);

  // (3) Casa o HMAC do id da conta com os pedidos de exclusão.
  for (const row of accounts) {
    const accountId = String(row.id);
    // MESMA função do registro da exclusão — a fórmula do HMAC não é reescrita aqui.
    const ref = accountRefHash(accountId);
    if (!suppressed.has(ref)) continue;

    const short = shortHash(ref);
    report.matched.push(short);

    if (!apply) {
      log(`• [dry-run] conta suprimida encontrada (ref ${short}): seria apagada agora, com as 7 tabelas do portal.`);
      continue;
    }

    try {
      // Uma transação por conta: as 7 tabelas saem juntas ou nenhuma sai (nada de supressão
      // pela metade, que deixaria a conta ressuscitada com dados órfãos).
      const removed = await db.withTransaction((tx) => purgePortalAccountRows(tx, accountId));
      const total = Object.values(removed).reduce((sum, n) => sum + Number(n || 0), 0);
      report.purged.push({ ref: short, removed, total });
      log(`✔ conta suprimida apagada (ref ${short}): ${total} linha(s) — ${summarize(removed)}`);
    } catch (error) {
      const reason = safeReason(error, accountId);
      report.failures.push({ ref: short, reason });
      log(`✗ FALHA ao apagar a conta suprimida (ref ${short}): ${reason}`);
    }
  }

  if (report.matched.length === 0) {
    log("ℹ️ [lista de supressão] nenhuma conta existente corresponde a um pedido de exclusão: nada a reaplicar.");
    return report;
  }

  if (apply) {
    log(
      `✅ [lista de supressão] supressão reaplicada em ${report.purged.length} de ${report.matched.length} conta(s) ` +
        `que voltaram com a restauração do backup.`
    );
    if (report.failures.length > 0) {
      log(
        `⚠️ [lista de supressão] ${report.failures.length} conta(s) NÃO puderam ser suprimidas: ` +
          "trate cada falha acima e rode de novo (a rotina é idempotente)."
      );
    }
  } else {
    log(
      `ℹ️ [lista de supressão] DRY-RUN: ${report.matched.length} conta(s) suprimida(s) encontrada(s) e NADA foi apagado. ` +
        "Rode com --apply (ou SUPPRESSION_APPLY=true) para reaplicar a exclusão."
    );
  }

  return report;
}

// ------------------------------------------------------------------------- entrada

async function run(): Promise<void> {
  const { apply, json } = parseArgs(process.argv.slice(2));
  try {
    const report = await applySuppressionList({
      apply,
      // Com --json o stdout carrega SÓ o objeto JSON (nada de log solto no meio).
      log: json ? () => undefined : undefined,
    });
    if (json) console.log(JSON.stringify(report, null, 2));
    // Falha ao suprimir uma conta é motivo para sair != 0: a supressão NÃO está garantida.
    process.exit(report.failures.length > 0 ? 1 : 0);
  } catch (error) {
    console.error("❌ [lista de supressão] erro inesperado:", error);
    process.exit(1);
  }
}

if (process.argv[1]?.includes("apply-suppression-list")) {
  void run();
}
