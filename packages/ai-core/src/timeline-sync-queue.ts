// Voxly CRM — durable "timeline-sync" queue (Phase 5.3)
// Enqueues chat timeline events for async, retried processing.
// Uses BullMQ with per-tenant toggle check.

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '@voxly/db';

export const TIMELINE_SYNC_QUEUE_NAME = 'timeline-sync';

export type TimelineSyncJobData = {
  tenantId: string;
  twentyPersonId: string | null;
  phoneFingerprint: string | null;
  kind: 'chat_inbound' | 'chat_outbound' | 'chat_thread_created' | 'chat_deal_created';
  channel: string;
  title: string;
  description?: string | null;
  meta?: object | null;
  conversationId?: string | null;
  opportunityId?: string | null;
  messageId?: string | null;
};

let queueSingleton: Queue<TimelineSyncJobData> | null = null;

function getTimelineSyncQueue(): Queue<TimelineSyncJobData> {
  if (!queueSingleton) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    queueSingleton = new Queue<TimelineSyncJobData>(TIMELINE_SYNC_QUEUE_NAME, { connection });
  }
  return queueSingleton;
}

export function buildTimelineSyncKey(parts: {
  tenantId: string;
  kind: string;
  conversationId?: string | null;
  messageId?: string | null;
}): string {
  const base = `${parts.tenantId}:${parts.kind}`;
  // Message events must be keyed per message: a conversation-level jobId is
  // dropped by BullMQ as a duplicate after the FIRST event ever processed,
  // silencing the whole thread (chat timeline never advances).
  if (parts.messageId) return `${base}:msg:${parts.messageId}`;
  if (parts.conversationId) return `${base}:${parts.conversationId}`;
  return `${base}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueueTimelineSync(
  data: TimelineSyncJobData,
  opts?: { key?: string }
): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const key = opts?.key || buildTimelineSyncKey({
    tenantId: data.tenantId,
    kind: data.kind,
    conversationId: data.conversationId,
    messageId: data.messageId,
  });

  const queue = getTimelineSyncQueue();
  try {
    await queue.add('sync', data, {
      jobId: key,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    });
    return { ok: true, jobId: key };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[timeline-sync] enqueue failed, falling back to direct write:', msg);
    // Fallback: direct write (best-effort, no retries)
    try {
      await writeTimelineSyncDirect(data);
      return { ok: true, jobId: key, error: 'queue_unavailable_fallback_used' };
    } catch (e) {
      console.error('[timeline-sync] direct write also failed:', e);
      return { ok: false, error: msg };
    }
  }
}

async function writeTimelineSyncDirect(data: TimelineSyncJobData): Promise<void> {
  const metaObj = data.meta && Object.keys(data.meta).length > 0 ? data.meta : undefined;
  await prisma.customerActivity.create({
    data: {
      tenantId: data.tenantId,
      twentyPersonId: data.twentyPersonId || null,
      phoneFingerprint: data.phoneFingerprint || null,
      kind: data.kind,
      channel: data.channel,
      title: data.title,
      description: data.description || null,
      meta: metaObj,
    },
  });
}

export async function startTimelineSyncWorker(opts?: {
  /**
   * Secondary sink (e.g. Twenty «Временная шкала» chat events). Best-effort:
   * local CustomerActivity stays the source of truth; errors never fail the job
   * (a retry would duplicate the local row).
   */
  writeExternal?: (data: TimelineSyncJobData) => Promise<void>;
}): Promise<void> {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker<TimelineSyncJobData>(
    TIMELINE_SYNC_QUEUE_NAME,
    async (job) => {
      const data = job.data;
      // Check per-tenant toggle
      const tenant = await prisma.tenant.findUnique({
        where: { id: data.tenantId },
        select: { timelineSyncEnabled: true },
      });
      if (!tenant?.timelineSyncEnabled) {
        console.log(`[timeline-sync] tenant ${data.tenantId} has timelineSyncEnabled=false, skipping`);
        return;
      }

      await writeTimelineSyncDirect(data);
      if (opts?.writeExternal) {
        try {
          await opts.writeExternal(data);
        } catch (err) {
          console.warn(
            '[timeline-sync] external sink failed:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    },
    {
      connection,
      concurrency: 10,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[timeline-sync] job failed:`, job?.id, err);
  });

  console.log('[timeline-sync] worker started');
}

// Re-export for convenience
export { prisma } from '@voxly/db';