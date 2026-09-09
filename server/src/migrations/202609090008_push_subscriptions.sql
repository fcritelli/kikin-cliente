-- Migration: 202609090008_push_subscriptions.sql
-- Descrição: inscrições de Web Push por conta do portal (notificações no celular/desktop
-- mesmo com a aba fechada). Aditiva — não altera tabelas existentes.
--
-- Consentimento = a própria inscrição criada por ação do usuário no navegador (botão
-- "Receber no celular"). Cada inscrição pertence a uma conta e é única por `endpoint`
-- (upsert); a remoção acontece por ação do usuário ou automaticamente quando o provedor
-- responde 404/410/403 (endpoint expirado/revogado).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_account_idx
  ON push_subscriptions (account_id);
