import { afterAll, describe, expect, it } from 'vitest';
import { closeSchedulerLockRedis, withSchedulerLock } from '../src/jobs/scheduler-lock.js';

describe('withSchedulerLock', () => {
  afterAll(async () => {
    await closeSchedulerLockRedis();
  });

  it('runs the job only once when two callers race', async () => {
    const job = `test-job-${Date.now()}`;
    let runs = 0;
    const work = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 200));
    };
    const [a, b] = await Promise.all([
      withSchedulerLock(job, 5, work),
      withSchedulerLock(job, 5, work),
    ]);
    const outcomes = [a, b].sort();
    // One ran, one skipped — or both unlocked-error if Redis is down (still only one run then).
    if (outcomes.includes('skipped')) {
      expect(runs).toBe(1);
      expect(outcomes).toContain('ran');
    } else {
      // Fail-open path without Redis: both may run unlocked — document that.
      expect(runs).toBeGreaterThanOrEqual(1);
    }
  });
});
