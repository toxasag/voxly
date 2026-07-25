-- Human-friendly label separate from Evolution/TG slug (Cyrillic OK for WhatsApp).
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
