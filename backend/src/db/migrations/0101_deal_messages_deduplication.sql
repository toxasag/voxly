-- Migration 0101: Deal messages deduplication and external message ID index
-- 1. Создаем частичный GIN/B-tree индекс по external_message_id для быстрого поиска дубликатов при синхронизации
CREATE INDEX IF NOT EXISTS idx_deal_messages_external_id
  ON deal_messages (tenant_id, deal_id, (metadata->>'external_message_id'))
  WHERE (metadata->>'external_message_id') IS NOT NULL;

-- 2. Очищаем накопившиеся дубликаты повторных синхронизаций в ленте сделок (оставляем самое раннее сообщение)
DELETE FROM deal_messages
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY tenant_id, deal_id, direction, channel, trim(content), COALESCE(attachment, '')
             ORDER BY created_at ASC, id ASC
           ) as rnum,
           created_at,
           LAG(created_at) OVER (
             PARTITION BY tenant_id, deal_id, direction, channel, trim(content), COALESCE(attachment, '')
             ORDER BY created_at ASC, id ASC
           ) as prev_created_at
    FROM deal_messages
  ) t
  WHERE t.rnum > 1
    AND (
      t.prev_created_at IS NULL
      OR t.created_at - t.prev_created_at < interval '12 hours'
    )
);
