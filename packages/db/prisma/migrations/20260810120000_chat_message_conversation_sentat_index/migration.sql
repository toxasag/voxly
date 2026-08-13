-- Composite index for chat history loading (ORDER BY sentAt) and delta polling
-- (WHERE conversationId = ? AND sentAt > ?). Existing single-column index stays.
CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_sentAt_idx"
  ON "ChatMessage"("conversationId", "sentAt");
