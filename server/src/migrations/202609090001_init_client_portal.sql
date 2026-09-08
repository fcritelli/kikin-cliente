-- Migration: 202609090001_init_client_portal.sql
-- Descrição: schema inicial do portal do cliente final (contas e sessões).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Contas do cliente final (e-mail + senha). LGPD: dados de contato do cliente
-- (telefone/CPF) NUNCA em claro — apenas hash+masked em tabelas de vínculo futuras.
CREATE TABLE IF NOT EXISTS client_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  email_normalized text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  email_verified_at timestamptz,
  consent_terms_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(email) <> ''),
  CHECK (btrim(full_name) <> '')
);

-- Sessões de refresh (token com hash) com rotação e expiração
CREATE TABLE IF NOT EXISTS client_account_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip_address inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_account_sessions_account_idx
  ON client_account_sessions (account_id);

-- Tokens de e-mail (verificação/reset) com hash — nunca guardamos o token em claro
CREATE TABLE IF NOT EXISTS client_email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_email_tokens_account_idx
  ON client_email_tokens (account_id);
