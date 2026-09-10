-- Migration: 202609090009_account_deletion_log.sql
-- Descrição: registro de auditoria da EXCLUSÃO de conta no portal do cliente (LGPD Art. 37).
-- Aditiva e idempotente: não altera nenhuma tabela existente.
--
-- LGPD (minimização): NADA de PII em claro —
--   * account_ref_hash = HMAC-SHA256(KIKIN_CLIENT_PORTAL_SECRET, id da conta) => pseudônimo estável
--     para auditoria/abuso, sem guardar o uuid da conta nem criar FK (a conta deixa de existir);
--   * email_hash       = HMAC-SHA256(segredo, e-mail normalizado) => permite correlacionar pedido
--     de exclusão sem revelar o e-mail (nem permitir dicionário sobre sha256 puro);
--   * ip_hash          = HMAC-SHA256(segredo, IP) quando disponível (nunca o IP cru);
--   * removed_counts   = contagens por tabela removida na MESMA transação (prova do que foi apagado);
--   * proof_method     = 'password' | 'whatsapp_otp' (qual prova de identidade foi exigida/validada).
--
-- Sem FK para client_accounts de propósito: a linha de auditoria sobrevive à exclusão da conta
-- (é o registro legal do próprio Art. 37) e nada aqui permite reidentificar o titular.

CREATE TABLE IF NOT EXISTS account_deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_ref_hash text NOT NULL,
  email_hash text,
  auth_provider text,
  proof_method text NOT NULL,
  removed_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_deletion_log_proof_method_check
    CHECK (proof_method IN ('password', 'whatsapp_otp'))
);

CREATE INDEX IF NOT EXISTS account_deletion_log_deleted_at_idx
  ON account_deletion_log (deleted_at DESC);

CREATE INDEX IF NOT EXISTS account_deletion_log_account_ref_idx
  ON account_deletion_log (account_ref_hash);

CREATE INDEX IF NOT EXISTS account_deletion_log_email_idx
  ON account_deletion_log (email_hash);
