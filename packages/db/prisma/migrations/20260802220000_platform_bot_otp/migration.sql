-- GetVoxlybot OTP / support / broadcasts

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramLinkedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "AuthOtpChallenge" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT,
    "telegramUserId" BIGINT,
    "chatId" BIGINT,
    "userId" TEXT,
    "pendingPayload" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthOtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthOtpChallenge_nonce_key" ON "AuthOtpChallenge"("nonce");
CREATE INDEX IF NOT EXISTS "AuthOtpChallenge_telegramUserId_purpose_idx" ON "AuthOtpChallenge"("telegramUserId", "purpose");
CREATE INDEX IF NOT EXISTS "AuthOtpChallenge_expiresAt_idx" ON "AuthOtpChallenge"("expiresAt");
CREATE INDEX IF NOT EXISTS "AuthOtpChallenge_userId_idx" ON "AuthOtpChallenge"("userId");

CREATE TABLE IF NOT EXISTS "PlatformBotSubscriber" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "userId" TEXT,
    "username" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformBotSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformBotSubscriber_telegramUserId_key" ON "PlatformBotSubscriber"("telegramUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformBotSubscriber_userId_key" ON "PlatformBotSubscriber"("userId");
CREATE INDEX IF NOT EXISTS "PlatformBotSubscriber_userId_idx" ON "PlatformBotSubscriber"("userId");

ALTER TABLE "PlatformBotSubscriber"
  DROP CONSTRAINT IF EXISTS "PlatformBotSubscriber_userId_fkey";
ALTER TABLE "PlatformBotSubscriber"
  ADD CONSTRAINT "PlatformBotSubscriber_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "PlatformSupportMessage" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "username" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformSupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlatformSupportMessage_telegramUserId_createdAt_idx"
  ON "PlatformSupportMessage"("telegramUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlatformSupportMessage_readAt_idx" ON "PlatformSupportMessage"("readAt");

CREATE TABLE IF NOT EXISTS "PlatformBroadcast" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "PlatformBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlatformBroadcast_status_scheduledAt_idx"
  ON "PlatformBroadcast"("status", "scheduledAt");
