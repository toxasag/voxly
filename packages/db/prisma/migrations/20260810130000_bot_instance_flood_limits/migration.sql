-- Anti-flood / mailing limits on BotInstance (Фаза 1A).
-- dailySendLimit/dailyStoryLimit: null = channel default (см. docs/agent/MAILING-LIMITS.md).
-- warmupSince: warm-up start; isPremium: Telegram Premium auto-detect; floodedUntil: platform block.
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "dailySendLimit" INTEGER;
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "dailyStoryLimit" INTEGER;
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "warmupSince" TIMESTAMP(3);
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "isPremium" BOOLEAN;
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "floodedUntil" TIMESTAMP(3);
