-- Migration: 202609090007_links_account_salon_unique.sql
-- Descrição: idempotência do vínculo — no máximo UM vínculo por (conta, estabelecimento).
-- Mesmo que o Kikin tenha 2 cadastros do cliente no mesmo salão (ex.: telefone com formatos
-- diferentes), o portal mantém 1 vínculo por conta+salão.

-- Remove duplicados mantendo o vínculo mais antigo (idempotência retroativa).
DELETE FROM account_establishment_links a
WHERE a.id NOT IN (
  SELECT DISTINCT ON (account_id, salon_id) id
  FROM account_establishment_links
  ORDER BY account_id, salon_id, created_at, id
);

CREATE UNIQUE INDEX IF NOT EXISTS account_establishment_links_account_salon_uq
  ON account_establishment_links (account_id, salon_id);
