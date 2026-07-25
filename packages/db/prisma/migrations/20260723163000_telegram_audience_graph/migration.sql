-- Shared Telegram audience / overlap graph v1
CREATE TABLE "TelegramPeer" (
    "id" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "peerType" TEXT NOT NULL,
    "username" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramPeer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramPeer_peerId_key" ON "TelegramPeer"("peerId");
CREATE INDEX "TelegramPeer_peerType_idx" ON "TelegramPeer"("peerType");
CREATE INDEX "TelegramPeer_username_idx" ON "TelegramPeer"("username");

CREATE TABLE "TelegramSighting" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceTenantId" TEXT NOT NULL,
    "sourceBotInstanceId" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramSighting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramSighting_telegramUserId_peerId_relation_key" ON "TelegramSighting"("telegramUserId", "peerId", "relation");
CREATE INDEX "TelegramSighting_telegramUserId_idx" ON "TelegramSighting"("telegramUserId");
CREATE INDEX "TelegramSighting_peerId_idx" ON "TelegramSighting"("peerId");
CREATE INDEX "TelegramSighting_sourceTenantId_idx" ON "TelegramSighting"("sourceTenantId");
