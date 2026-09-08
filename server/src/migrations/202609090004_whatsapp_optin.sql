-- Migration: 202609090004_whatsapp_optin.sql
-- Descrição: consentimento de WhatsApp (LGPD) no vínculo conta ↔ client.
-- O telefone do vínculo É o número de WhatsApp (normalizado com DDI 55; nunca guardamos o
-- número cru — apenas hash + máscara). whatsapp_optin_at registra o consentimento para
-- confirmações/lembretes por WhatsApp (estrutura pronta p/ provedor futuro; sem provedor,
-- a UI já oferece "falar com o salão" via wa.me).

ALTER TABLE account_establishment_links
  ADD COLUMN IF NOT EXISTS whatsapp_optin_at timestamptz;
