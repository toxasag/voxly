ALTER TABLE "MailingStageRule"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'gift',
  ADD COLUMN "mediaUrl" TEXT,
  ADD COLUMN "mediaType" TEXT;
