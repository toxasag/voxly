-- Daily warm-up snapshots per account (Job 1C.4).
-- The gift-bot worker upserts one row per bot per UTC day on each broadcast send:
--   limit = effective daily send limit (override or warmup-scaled default),
--   sent  = Redis counter tg:day:{bot}:{date}:sent (authoritative INCR result).
CREATE TABLE "WarmupLog" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "limit" INTEGER NOT NULL,
  "sent" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarmupLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WarmupLog_botId_date_key" ON "WarmupLog"("botId", "date");
CREATE INDEX "WarmupLog_botId_date_idx" ON "WarmupLog"("botId", "date");
ALTER TABLE "WarmupLog" ADD CONSTRAINT "WarmupLog_botId_fkey" FOREIGN KEY ("botId") REFERENCES "BotInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
