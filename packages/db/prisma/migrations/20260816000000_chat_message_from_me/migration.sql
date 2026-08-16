-- Add fromMe flag to ChatMessage (WhatsApp/operator outbound receipts, media fetch fromMe)
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "fromMe" BOOLEAN NOT NULL DEFAULT false;
