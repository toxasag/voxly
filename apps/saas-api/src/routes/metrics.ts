import type { FastifyPluginAsync } from 'fastify';
import IORedis from 'ioredis';
import { prisma } from '@voxly/db';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const metricsRedis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

  fastify.get('/metrics', async () => {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const rotatedKey = `tg:rotated:${dayStart.toISOString().slice(0, 10)}`;
    const rotatedTotal = Number((await metricsRedis.get(rotatedKey)) || 0);

    const [chatMessages, botInstances] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { role: 'assistant', sentAt: { gte: dayStart } },
        select: { conversation: { select: { platform: true } }, deliveryStatus: true },
      }),
      prisma.botInstance.findMany({
        select: { botType: true, floodedUntil: true },
      }),
    ]);

    const channels = ['telegram_gramjs', 'whatsapp', 'telegram_bot', 'max', 'channel'] as const;
    type Channel = (typeof channels)[number];

    const metrics: Record<Channel, { sent: number; failed: number; flooded: number; rotated: number }> = {
      telegram_gramjs: { sent: 0, failed: 0, flooded: 0, rotated: 0 },
      whatsapp: { sent: 0, failed: 0, flooded: 0, rotated: 0 },
      telegram_bot: { sent: 0, failed: 0, flooded: 0, rotated: 0 },
      max: { sent: 0, failed: 0, flooded: 0, rotated: 0 },
      channel: { sent: 0, failed: 0, flooded: 0, rotated: 0 },
    };

    const platformToChannel: Record<string, Channel> = {
      telegram: 'telegram_bot',
      gramjs: 'telegram_gramjs',
      whatsapp: 'whatsapp',
      max: 'max',
      max_personal: 'max',
      telegram_business: 'telegram_bot',
      telegram_private: 'telegram_bot',
      telegram_gramjs: 'telegram_gramjs',
    };

    for (const m of chatMessages) {
      const platform = m.conversation?.platform || 'telegram';
      const ch = platformToChannel[platform] || 'telegram_bot';
      if (m.deliveryStatus === 'sent' || m.deliveryStatus === 'delivered' || m.deliveryStatus === 'read') {
        metrics[ch].sent += 1;
      } else if (m.deliveryStatus === 'failed') {
        metrics[ch].failed += 1;
      }
    }

    const floodedByType: Record<string, number> = {};
    for (const b of botInstances) {
      const ch = platformToChannel[b.botType] || 'telegram_bot';
      if (b.floodedUntil && new Date(b.floodedUntil) > now) {
        metrics[ch].flooded += 1;
        floodedByType[ch] = (floodedByType[ch] || 0) + 1;
      }
    }

    // Distribute rotated total proportionally to channels that had sent messages
    const channelsWithSends = Object.entries(metrics).filter(([, v]) => v.sent > 0);
    if (rotatedTotal > 0 && channelsWithSends.length > 0) {
      const perChannel = Math.floor(rotatedTotal / channelsWithSends.length);
      for (const [ch] of channelsWithSends) {
        metrics[ch as Channel].rotated = perChannel;
      }
      // Remainder to first channel
      const remainder = rotatedTotal % channelsWithSends.length;
      if (remainder > 0) {
        metrics[channelsWithSends[0][0] as Channel].rotated += remainder;
      }
    }

    return {
      window: { since: dayStart.toISOString(), until: now.toISOString() },
      byChannel: metrics,
      summary: {
        totalSent: Object.values(metrics).reduce((a, v) => a + v.sent, 0),
        totalFailed: Object.values(metrics).reduce((a, v) => a + v.failed, 0),
        totalFlooded: Object.values(metrics).reduce((a, v) => a + v.flooded, 0),
        totalRotated: Object.values(metrics).reduce((a, v) => a + v.rotated, 0),
      },
      floodedAccounts: floodedByType,
    };
  });
};