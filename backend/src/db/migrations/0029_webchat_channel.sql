-- =============================================================================
-- 0029: Добавление канала связи webchat (онлайн-чат на сайте)
--
-- Канал `webchat` позволяет подключать виджет онлайн-чата на сайте тенанта.
-- Сообщения клиентов автоматически создают контакты и сделки в CRM через
-- CrmPipelineService, а ответы генерируются AI-агентом или оператором.
-- =============================================================================

ALTER TABLE channel_accounts
  DROP CONSTRAINT IF EXISTS channel_accounts_channel_check;

ALTER TABLE channel_accounts
  ADD CONSTRAINT channel_accounts_channel_check
  CHECK (channel IN ('telegram', 'whatsapp', 'max', 'avito', 'instagram', 'webchat'));
