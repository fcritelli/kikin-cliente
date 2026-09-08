-- Migration: 202609090005_profile_whatsapp.sql
-- Descrição: número de WhatsApp único da conta (LGPD: só hash + máscara; nunca cru).
-- É o canal de contato/lembretes (aplicado ao perfil do cliente); os vínculos com cada
-- estabelecimento continuam identificados pelo telefone do cadastro do salão (hash), sem mudança.

ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS whatsapp_phone_hash text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_masked text,
  ADD COLUMN IF NOT EXISTS whatsapp_updated_at timestamptz;
