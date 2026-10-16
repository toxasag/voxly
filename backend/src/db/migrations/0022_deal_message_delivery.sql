-- =============================================================================
-- Статус доставки исходящего сообщения в канал.
--
-- До этой миграции `POST /crm/deals/:id/messages` только писал строку в
-- `deal_messages`, транспорт не вызывался: менеджер печатал в карточке, строка
-- появлялась в таймлайне, клиент в Telegram не получал ничего. Чат работал как
-- журнал, а не как переписка.
--
-- Статус хранится на строке сообщения, а не тостом на фронте: тост исчезает, а
-- неотправленное сообщение осталось бы висеть в таймлайне как отправленное.
--
-- `pending` для исходящих означает «принято сервером, в канал ещё не ушло»;
-- `sent` — транспорт подтвердил отправку; `failed` — отказ, причина в
-- `delivery_error`. Входящие и системные строки остаются `neutral`: доставлять
-- их некуда, и отдельный статус там означал бы «неизвестно».
-- =============================================================================

ALTER TABLE deal_messages
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deal_messages_delivery_status_valid'
  ) THEN
    ALTER TABLE deal_messages
      ADD CONSTRAINT deal_messages_delivery_status_valid
      CHECK (delivery_status IN ('neutral', 'pending', 'sent', 'failed'));
  END IF;
END
$$;

-- Ошибку доставки видно только у неудачных строк, поэтому индекс частичный:
-- полный индекс по колонке из четырёх значений планировщику бесполезен.
CREATE INDEX IF NOT EXISTS idx_deal_messages_failed_delivery
  ON deal_messages (tenant_id, deal_id)
  WHERE delivery_status = 'failed';
