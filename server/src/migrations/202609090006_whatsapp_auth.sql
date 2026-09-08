-- Migration: 202609090006_whatsapp_auth.sql
-- Descrição: identidade/login por WhatsApp (número verificado por OTP) + e-mail opcional.
-- LGPD: o número do WhatsApp nunca fica em claro no banco — guardamos hash (busca/unicidade),
-- máscara (exibição) e o valor criptografado AES-256-GCM (usado só em memória para ENVIAR
-- mensagens). E-mail passa a ser opcional (partial unique).

ALTER TABLE client_accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE client_accounts ALTER COLUMN email_normalized DROP NOT NULL;

ALTER TABLE client_accounts DROP CONSTRAINT IF EXISTS client_accounts_email_normalized_key;
ALTER TABLE client_accounts DROP CONSTRAINT IF EXISTS client_accounts_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS client_accounts_email_uq
  ON client_accounts (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_accounts_email_normalized_uq
  ON client_accounts (email_normalized) WHERE email_normalized IS NOT NULL;

-- Número do WhatsApp como identidade da conta (reaproveita as colunas 005 como canal único).
-- Credencial aceita agora: senha local, Google, Microsoft ou número WhatsApp (e e-mail isolado).
ALTER TABLE client_accounts DROP CONSTRAINT IF EXISTS client_accounts_credential_check;
ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_credential_check CHECK (
  password_hash IS NOT NULL OR google_id IS NOT NULL OR microsoft_id IS NOT NULL
  OR whatsapp_phone_hash IS NOT NULL OR email IS NOT NULL
);

ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS whatsapp_phone_enc text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_verified_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS client_accounts_whatsapp_hash_uq
  ON client_accounts (whatsapp_phone_hash) WHERE whatsapp_phone_hash IS NOT NULL;

-- Códigos OTP (hash) — nunca o código em claro.
CREATE TABLE IF NOT EXISTS client_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'whatsapp_signin',
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_otp_codes_phone_idx
  ON client_otp_codes (phone_hash, purpose, created_at DESC);

-- Registro temporário pós-OTP (aguardando nome+termos). Número NUNCA em claro:
-- guardamos hash + máscara + valor criptografado (para criar a conta e auto-vincular).
CREATE TABLE IF NOT EXISTS client_temp_signup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text NOT NULL,
  masked text NOT NULL,
  phone_enc text NOT NULL,
  temp_token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
