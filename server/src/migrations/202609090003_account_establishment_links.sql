-- Migration: 202609090003_account_establishment_links.sql
-- Descrição: vínculo conta do portal ↔ client(s) do Kikin por estabelecimento (ADR-001).
-- LGPD: guardamos apenas o hash do telefone normalizado (HMAC) + máscara p/ exibição;
-- NUNCA o telefone em claro.

CREATE TABLE IF NOT EXISTS account_establishment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  -- Estabelecimento no Kikin (uuid do salão) e client final no Kikin (uuid do clients)
  salon_id text NOT NULL,
  kikin_client_id text NOT NULL,
  -- Nome do cliente no Kikin (dado do próprio titular, p/ exibição "sou eu")
  client_name text NOT NULL,
  -- Hash HMAC do telefone normalizado + máscara (LGPD)
  phone_hash text NOT NULL,
  phone_masked text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(salon_id) <> ''),
  CHECK (btrim(kikin_client_id) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS account_establishment_links_account_salon_client_uq
  ON account_establishment_links (account_id, salon_id, kikin_client_id);

-- Deduplicação entre CONTAS (ADR-001) é feita no service (transaction: mesmo phone_hash em
-- outra conta ativa -> 409). Aqui um índice NÃO único acelera a checagem — a mesma pessoa pode
-- ter vínculos em vários salões (o mesmo phone_hash se repete dentro da MESMA conta).
CREATE INDEX IF NOT EXISTS account_establishment_links_phone_hash_idx
  ON account_establishment_links (phone_hash);

CREATE INDEX IF NOT EXISTS account_establishment_links_account_idx
  ON account_establishment_links (account_id);
