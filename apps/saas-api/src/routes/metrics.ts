import type { FastifyPluginAsync } from 'fastify';
import IORedis from 'ioredis';
import { prisma } from '@voxly/db';
import {
  provisioningQueue,
  emailQueue,
  formLeadQueue,
  gramjsCrmEnrichQueue,
} from '../jobs/queues.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const metricsRedis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

async function getQueueCounts(queue: any): Promise<{ waiting: number; active: number; failed: number; delayed: number }> {
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
  } catch {
    return { waiting: 0, active: 0, failed: 0, delayed: 0 };
  }
}

async function readPlatformResources() {
  let memory = { totalBytes: 0, usedBytes: 0, availableBytes: 0 };
  try {
    const { readFile } = await import('node:fs/promises');
    const meminfo = await readFile('/proc/meminfo', 'utf8');
    const kb = (key: string) => {
      const m = new RegExp(`${key}:\\s+(\\d+)`).exec(meminfo);
      return m ? parseInt(m[1], 10) * 1024 : 0;
    };
    const totalBytes = kb('MemTotal');
    const availableBytes = kb('MemAvailable') || kb('MemFree');
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    memory = { totalBytes, usedBytes, availableBytes };
  } catch {
    /* not on linux / fallback */
  }

  let disk = { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
  try {
    const { statfs } = await import('node:fs/promises');
    const s = await statfs('/');
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    disk = { totalBytes, usedBytes, freeBytes };
  } catch {
    /* fallback */
  }

  return { memory, disk };
}

export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

  fastify.get('/metrics', async () => {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const rotatedKey = `tg:rotated:${dayStart.toISOString().slice(0, 10)}`;
    const [
      rotatedTotalRaw,
      chatMessages,
      botInstances,
      provisioningCounts,
      emailCounts,
      formLeadCounts,
      gramjsEnrichCounts,
      resources,
    ] = await Promise.all([
      metricsRedis.get(rotatedKey),
      prisma.chatMessage.findMany({
        where: { role: 'assistant', sentAt: { gte: dayStart } },
        select: { conversation: { select: { platform: true } }, deliveryStatus: true },
      }),
      prisma.botInstance.findMany({
        select: { botType: true, floodedUntil: true },
      }),
      getQueueCounts(provisioningQueue),
      getQueueCounts(emailQueue),
      getQueueCounts(formLeadQueue),
      getQueueCounts(gramjsCrmEnrichQueue),
      readPlatformResources(),
    ]);

    const rotatedTotal = Number(rotatedTotalRaw || 0);

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

    const alerts: Array<{ level: 'warning' | 'critical'; code: string; message: string }> = [];

    // Memory alert: >90% used
    if (resources.memory.totalBytes > 0) {
      const memUsedRatio = resources.memory.usedBytes / resources.memory.totalBytes;
      if (memUsedRatio >= 0.9) {
        alerts.push({
          level: 'critical',
          code: 'RAM_CRITICAL',
          message: `Использование оперативной памяти превышает 90% (${Math.round(memUsedRatio * 100)}%)`,
        });
      } else if (memUsedRatio >= 0.8) {
        alerts.push({
          level: 'warning',
          code: 'RAM_HIGH',
          message: `Использование оперативной памяти превышает 80% (${Math.round(memUsedRatio * 100)}%)`,
        });
      }
    }

    // Disk alert: >90% used
    if (resources.disk.totalBytes > 0) {
      const diskUsedRatio = resources.disk.usedBytes / resources.disk.totalBytes;
      if (diskUsedRatio >= 0.9) {
        alerts.push({
          level: 'critical',
          code: 'DISK_CRITICAL',
          message: `Заполненность диска превышает 90% (${Math.round(diskUsedRatio * 100)}%)`,
        });
      } else if (diskUsedRatio >= 0.8) {
        alerts.push({
          level: 'warning',
          code: 'DISK_HIGH',
          message: `Заполненность диска превышает 80% (${Math.round(diskUsedRatio * 100)}%)`,
        });
      }
    }

    // Queue alerts: failed or high waiting count
    const queueMap: Record<string, typeof provisioningCounts> = {
      provisioning: provisioningCounts,
      email: emailCounts,
      'form-leads': formLeadCounts,
      'gramjs-crm-enrich': gramjsEnrichCounts,
    };
    for (const [qName, qCounts] of Object.entries(queueMap)) {
      if (qCounts.failed > 0) {
        alerts.push({
          level: 'warning',
          code: `QUEUE_FAILURES_${qName.toUpperCase()}`,
          message: `В очереди ${qName} обнаружено ${qCounts.failed} ошибочных задач (failed)`,
        });
      }
      if (qCounts.waiting > 100) {
        alerts.push({
          level: 'warning',
          code: `QUEUE_BACKLOG_${qName.toUpperCase()}`,
          message: `В очереди ${qName} накопилось ${qCounts.waiting} задач в ожидании`,
        });
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
      queues: queueMap,
      resources,
      alerts,
    };
  });
};