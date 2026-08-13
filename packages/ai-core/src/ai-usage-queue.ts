// Voxly AI Core — durable "ai-usage" charge queue (Phase 3.3)
//
// Fire-and-forget ASR/vision charges can be lost if the process crashes between the
// provider call and the `chargeAiUsage` write. This module gives those call sites a
// durable alternative: enqueue the already-resolved charge and let a BullMQ worker
// (started once, in saas-api) apply it with retries. `usageChargeKey` is reused as the
// BullMQ jobId (dedupes redundant enqueues) and is enforced unique on `AiUsageLog`
// (dedupes actual charges), so retries and re-enqueues are safe no-ops.
//
// Text-reply charges stay synchronous (the caller needs `chargeResult` immediately to
// persist on the message) — only the best-effort media charges should move to this queue.

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { chargeAiUsage, type ChargeAiUsageParams, type ChargeResult } from './index.js';

export const AI_USAGE_QUEUE_NAME = 'ai-usage';

export type AiUsageJobData = ChargeAiUsageParams & { usageChargeKey: string };

let queueSingleton: Queue<AiUsageJobData> | null = null;

/** Lazily create the queue's Redis connection + Queue instance (no eager connect at import time). */
function getAiUsageQueue(): Queue<AiUsageJobData> {
  if (!queueSingleton) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    queueSingleton = new Queue<AiUsageJobData>(AI_USAGE_QUEUE_NAME, { connection });
  }
  return queueSingleton;
}

/**
 * Deterministic idempotency key for a usage charge. Prefer a stable external id
 * (message id, etc.) when available so retried webhooks/events can't double-charge;
 * falls back to a random suffix when no stable id exists at the call site.
 */
export function buildUsageChargeKey(parts: {
  channel: string;
  tenantId: string;
  requestType: string;
  externalId?: string;
}): string {
  if (parts.externalId) {
    return `${parts.channel}:${parts.tenantId}:${parts.requestType}:${parts.externalId}`;
  }
  // No stable id at this call site: the key is random, so idempotency across retries /
  // redeliveries cannot be guaranteed. Warn so these paths are visible if they ever grow.
  console.warn(
    `[ai-usage-queue] no externalId for ${parts.channel}/${parts.requestType} — charge key is non-idempotent`,
  );
  const suffix = `r${Math.random().toString(36).slice(2)}${Date.now()}`;
  return `${parts.channel}:${parts.tenantId}:${parts.requestType}:${suffix}`;
}

/**
 * Enqueue a charge for durable, retried processing instead of charging inline.
 * Best-effort: if Redis/BullMQ is unavailable, falls back to charging directly so the
 * caller never silently drops a charge just because the queue could not be reached.
 */
export async function enqueueAiUsageCharge(data: AiUsageJobData): Promise<void> {
  try {
    await getAiUsageQueue().add('charge', data, {
      jobId: data.usageChargeKey,
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 500,
      // Keep failed jobs (dead-letter) for inspection instead of silently dropping them.
      removeOnFail: false,
    });
  } catch (err) {
    console.warn('[ai-usage-queue] enqueue failed, charging inline instead', err);
    await chargeAiUsage(data);
  }
}

async function processAiUsageJob(job: Job<AiUsageJobData>): Promise<ChargeResult> {
  return chargeAiUsage(job.data);
}

/**
 * Start the (single) consumer for the `ai-usage` queue. Call this once, from a process
 * that should own AI billing writes (currently saas-api, gated the same way as its other
 * BullMQ workers via `VOXLY_DISABLE_WORKERS`).
 */
export function startAiUsageWorker(): Worker<AiUsageJobData> {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker<AiUsageJobData>(AI_USAGE_QUEUE_NAME, processAiUsageJob, {
    connection,
    concurrency: 5,
  });
  worker.on('failed', (job, err) => {
    console.error(`[ai-usage-queue] job ${job?.id} failed:`, err.message);
  });
  return worker;
}
