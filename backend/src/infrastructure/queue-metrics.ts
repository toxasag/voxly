import type { Queue } from "bullmq";

export interface QueueHealthMetric {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  oldestJobAgeMs: number | null;
  error?: string;
}

const queues = new Map<string, Queue<unknown>>();

export function registerBullQueue(name: string, queue: Queue<unknown>): void {
  queues.set(name, queue);
}

export async function getBullQueueMetrics(): Promise<QueueHealthMetric[]> {
  const metrics: QueueHealthMetric[] = [];
  for (const [name, queue] of queues) {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
      const jobs = await queue.getJobs(["waiting", "active"], 0, 0, false);
      const oldest = jobs[0]?.timestamp;
      metrics.push({
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        oldestJobAgeMs: typeof oldest === "number" ? Math.max(0, Date.now() - oldest) : null,
      });
    } catch (error) {
      metrics.push({
        name,
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        oldestJobAgeMs: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return metrics;
}
