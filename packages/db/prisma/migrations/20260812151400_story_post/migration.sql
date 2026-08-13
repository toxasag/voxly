-- CreateTable
CREATE TABLE "StoryPost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botInstanceId" TEXT NOT NULL,
    "broadcastId" TEXT,
    "channel" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "text" TEXT,
    "linkUrl" TEXT,
    "linkText" TEXT,
    "trackingLinkId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "reactionsCount" INTEGER NOT NULL DEFAULT 0,
    "forwardsCount" INTEGER NOT NULL DEFAULT 0,
    "waViewsCount" INTEGER NOT NULL DEFAULT 0,
    "clicksCount" INTEGER NOT NULL DEFAULT 0,
    "providerData" JSONB,

    CONSTRAINT "StoryPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryPost_tenantId_idx" ON "StoryPost"("tenantId");
CREATE INDEX "StoryPost_botInstanceId_idx" ON "StoryPost"("botInstanceId");
CREATE INDEX "StoryPost_broadcastId_idx" ON "StoryPost"("broadcastId");
CREATE INDEX "StoryPost_postedAt_idx" ON "StoryPost"("postedAt");

-- AddForeignKey
ALTER TABLE "StoryPost" ADD CONSTRAINT "StoryPost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryPost" ADD CONSTRAINT "StoryPost_botInstanceId_fkey" FOREIGN KEY ("botInstanceId") REFERENCES "BotInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
