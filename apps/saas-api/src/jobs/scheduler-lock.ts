import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let lockRedis: IORedis | null = null;

function getLockRedis(): IORedis {
  if (!lockRedis) {
    lockRedis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return lockRedis;
}

/**
 * Acquire a short-lived Redis NX lock so scheduled jobs do not double-run
 * across saas-api replicas. Returns true if this process should execute the job.
 * Fail-open when Redis is unreachable (local/dev without Redis still runs jobs).
 */
export async function withSchedulerLock(
  jobName: string,
  ttlSeconds: number,
  fn: () => Promise<void>,
): Promise<'ran' | 'skipped' | 'unlocked-error'> {
  const key = `voxly:scheduler:lock:${jobName}`;
  const redis = getLockRedis();
  let token: string | null = null;
  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => undefined);
    }
    token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ok = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
    if (ok !== 'OK') return 'skipped';
  } catch (err) {
    console.warn(`[scheduler] lock acquire failed for ${jobName}, running unlocked`, err);
    await fn();
    return 'unlocked-error';
  }

  try {
    await fn();
    return 'ran';
  } finally {
    try {
      const current = await redis.get(key);
      if (current === token) await redis.del(key);
    } catch {
      // TTL will clear the key
    }
  }
}

/** Test helper — closes the lazy Redis connection. */
export async function closeSchedulerLockRedis(): Promise<void> {
  if (lockRedis) {
    await lockRedis.quit().catch(() => undefined);
    lockRedis = null;
  }
}
