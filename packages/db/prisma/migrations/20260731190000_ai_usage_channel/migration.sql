-- Per-channel attribution for AI usage charges

-- Nullable on purpose: charges written before channel tracking legitimately have no channel
-- and must stay valid. Nothing is backfilled — the API/UI render them as «Не определён».
ALTER TABLE "AiUsageLog" ADD COLUMN IF NOT EXISTS "channel" TEXT;

-- Serves GET /api/ai/agents/usage: equality on tenantId, group by channel, range on createdAt.
-- Leading tenantId narrows to the tenant, channel next so the grouping gets pre-sorted input,
-- createdAt last as the range boundary inside each channel run.
CREATE INDEX IF NOT EXISTS "AiUsageLog_tenantId_channel_createdAt_idx"
  ON "AiUsageLog"("tenantId", "channel", "createdAt");
