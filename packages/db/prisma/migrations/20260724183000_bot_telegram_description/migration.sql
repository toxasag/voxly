-- Bot profile text shown when opening t.me/bot before /start
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "telegramDescription" TEXT;
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "telegramShortDescription" TEXT;
