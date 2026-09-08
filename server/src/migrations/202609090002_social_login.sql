-- Migration: 202609090002_social_login.sql
-- Descrição: login/cadastro social (Google/Microsoft) em client_accounts.
-- LGPD: guardamos apenas o identificador do provedor (sub) + e-mail verificado;
-- nenhum dado extra do provedor é persistido em claro além do que já usamos.

-- Identificador do usuário no Google (sub do id_token) e avatar opcional.
ALTER TABLE client_accounts ADD COLUMN IF NOT EXISTS google_id text;
ALTER TABLE client_accounts ADD COLUMN IF NOT EXISTS microsoft_id text;
ALTER TABLE client_accounts ADD COLUMN IF NOT EXISTS avatar_url text;

-- Provedor predominante da conta: 'local' (e-mail+senha), 'google' ou 'microsoft'.
ALTER TABLE client_accounts ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'local';

-- Contas criadas 100% por OAuth não possuem senha local.
ALTER TABLE client_accounts ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_accounts_google_id_uq
  ON client_accounts (google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_accounts_microsoft_id_uq
  ON client_accounts (microsoft_id) WHERE microsoft_id IS NOT NULL;

-- Garante que toda conta tenha ao menos uma credencial (senha local OU provedor social).
ALTER TABLE client_accounts DROP CONSTRAINT IF EXISTS client_accounts_credential_check;
ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_credential_check CHECK (
  password_hash IS NOT NULL OR google_id IS NOT NULL OR microsoft_id IS NOT NULL
);
