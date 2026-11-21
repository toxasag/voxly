// ---------------------------------------------------------------------------
// Очереди фоновых задач (M7.2 Infrastructure Queues).
//
// Предоставляет отказоустойчивый интерфейс постановки и обработки задач
// с поддержкой очередей: `ai-usage`, `timeline-sync`, `broadcasts`,
// `task-reminders`, `notifications`, `invoice_reminders`, `knowledge-indexing`.
//
// Когда настроен REDIS_URL (production / staging / dev с Redis), задачи
// хранятся и обрабатываются через BullMQ (Queue + Worker с concurrency=5,
// экспоненциальным backoff и TTL на completed/failed).
// При отсутствии Redis в dev/test — прозрачный in-memory fallback.
// В production отсутствие Redis не маскируется (requireDurableQueue).
// ---------------------------------------------------------------------------

import { Queue, Worker, type Job as BullJob } from "bullmq";
import { getRedisConnectionOptions, requireDurableQueue } from "./redis.js";
import { registerBullQueue } from "./queue-metrics.js";

export type QueueName =
  | "ai-usage"
  | "timeline-sync"
  | "broadcasts"
  | "task-reminders"
  | "notifications"
  | "invoice_reminders"
  | "knowledge-indexing";

export interface QueueJob<T = unknown> {
  id: string;
  queue: QueueName;
  tenantId: string;
  name: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  backoffMs: number;
  createdAt: string;
}

export type JobHandler<T = unknown> = (job: QueueJob<T>) => Promise<void>;

interface BullPayload<T = unknown> {
  queue: QueueName;
  tenantId: string;
  name: string;
  data: T;
  maxAttempts: number;
  backoffMs: number;
  createdAt: string;
}

const BULL_PREFIX = "qm-";
const DEFAULT_CONCURRENCY = 5;
const REMOVE_ON_COMPLETE = { count: 1000, age: 86_400 };
const REMOVE_ON_FAIL = { count: 500, age: 86_400 };

export class QueueManager {
  private handlers = new Map<QueueName, JobHandler>();
  private bullQueues = new Map<QueueName, Queue<BullPayload>>();
  private bullWorkers = new Map<QueueName, Worker<BullPayload>>();
  private inMemoryQueue: QueueJob[] = [];
  private retryTimers = new Set<NodeJS.Timeout>();
  private isProcessing = false;
  private isShuttingDown = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(private readonly forceInMemory = false) {
    this.startInMemoryWorker();
  }

  private getBullConnection() {
    if (this.forceInMemory || process.env.NODE_ENV === "test") {
      return null;
    }
    return getRedisConnectionOptions();
  }

  private getOrCreateBullQueue(queueName: QueueName): Queue<BullPayload> | null {
    const existing = this.bullQueues.get(queueName);
    if (existing) return existing;

    const connection = this.getBullConnection();
    if (!connection) return null;

    const bullName = `${BULL_PREFIX}${queueName}`;
    const q = new Queue<BullPayload>(bullName, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: REMOVE_ON_COMPLETE,
        removeOnFail: REMOVE_ON_FAIL,
      },
    });
    q.on("error", (err) => {
      if (process.env.NODE_ENV !== "test") {
        console.warn(`[QueueManager:${bullName}] queue error:`, err.message);
      }
    });
    this.bullQueues.set(queueName, q);
    registerBullQueue(bullName, q as unknown as Queue<unknown>);
    return q;
  }

  private ensureBullWorker(queueName: QueueName): void {
    if (this.bullWorkers.has(queueName) || this.isShuttingDown) {
      return;
    }

    const connection = this.getBullConnection();
    if (!connection) return;

    // Создаём Queue сразу, чтобы метрики /health и /admin/metrics видели очередь
    // даже до постановки первой задачи.
    this.getOrCreateBullQueue(queueName);

    const bullName = `${BULL_PREFIX}${queueName}`;
    const worker = new Worker<BullPayload>(
      bullName,
      async (bullJob: BullJob<BullPayload>) => {
        const handler = this.handlers.get(queueName);
        if (!handler) {
          throw new Error(`No handler registered for queue "${queueName}"`);
        }
        const payload = bullJob.data;
        const wrapped: QueueJob = {
          id: String(bullJob.id ?? `bull-${Date.now()}`),
          queue: queueName,
          tenantId: payload.tenantId,
          name: payload.name || bullJob.name,
          data: payload.data,
          attempts: bullJob.attemptsMade + 1,
          maxAttempts: payload.maxAttempts ?? bullJob.opts.attempts ?? 5,
          backoffMs: payload.backoffMs ?? 1000,
          createdAt: payload.createdAt ?? new Date(bullJob.timestamp).toISOString(),
        };
        await handler(wrapped);
      },
      {
        connection,
        concurrency: DEFAULT_CONCURRENCY,
      },
    );

    worker.on("error", (err) => {
      if (process.env.NODE_ENV !== "test") {
        console.warn(`[QueueManager:${bullName}] worker error:`, err.message);
      }
    });

    worker.on("failed", (job, err) => {
      if (process.env.NODE_ENV !== "test") {
        console.error(
          `[QueueManager:${bullName}] job ${job?.id ?? "?"} failed (attempt ${job?.attemptsMade ?? 0}):`,
          err.message,
        );
      }
    });

    this.bullWorkers.set(queueName, worker);
  }

  registerHandler<T = unknown>(queue: QueueName, handler: JobHandler<T>): void {
    this.handlers.set(queue, handler as JobHandler);
    this.ensureBullWorker(queue);
  }

  async enqueue<T = unknown>(params: {
    queue: QueueName;
    tenantId: string;
    name: string;
    data: T;
    maxAttempts?: number;
    backoffMs?: number;
  }): Promise<QueueJob<T>> {
    requireDurableQueue("queue-manager");

    const maxAttempts = params.maxAttempts ?? 5;
    const backoffMs = params.backoffMs ?? 1000;
    const createdAt = new Date().toISOString();

    const bullQueue = this.getOrCreateBullQueue(params.queue);
    if (bullQueue) {
      const added = await bullQueue.add(
        params.name,
        {
          queue: params.queue,
          tenantId: params.tenantId,
          name: params.name,
          data: params.data,
          maxAttempts,
          backoffMs,
          createdAt,
        },
        {
          attempts: maxAttempts,
          backoff: { type: "exponential", delay: backoffMs },
          removeOnComplete: REMOVE_ON_COMPLETE,
          removeOnFail: REMOVE_ON_FAIL,
        },
      );

      return {
        id: String(added.id ?? `job-${Date.now()}`),
        queue: params.queue,
        tenantId: params.tenantId,
        name: params.name,
        data: params.data,
        attempts: 0,
        maxAttempts,
        backoffMs,
        createdAt,
      };
    }

    const job: QueueJob<T> = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      queue: params.queue,
      tenantId: params.tenantId,
      name: params.name,
      data: params.data,
      attempts: 0,
      maxAttempts,
      backoffMs,
      createdAt,
    };

    this.inMemoryQueue.push(job as QueueJob);
    return job;
  }

  private startInMemoryWorker(): void {
    this.intervalTimer = setInterval(() => {
      void this.processNextBatch();
    }, 200);
    this.intervalTimer.unref();
  }

  async processNextBatch(): Promise<void> {
    if (this.isProcessing || this.isShuttingDown || this.inMemoryQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    try {
      const job = this.inMemoryQueue.shift();
      if (!job) return;

      const handler = this.handlers.get(job.queue);
      if (!handler) {
        return;
      }

      job.attempts += 1;
      try {
        await handler(job);
      } catch {
        if (job.attempts < job.maxAttempts) {
          const delay = job.backoffMs * Math.pow(2, job.attempts - 1);
          const timer = setTimeout(() => {
            this.retryTimers.delete(timer);
            if (!this.isShuttingDown) {
              this.inMemoryQueue.push(job);
            }
          }, delay);
          timer.unref();
          this.retryTimers.add(timer);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  getPendingCount(queue?: QueueName): number {
    if (!queue) return this.inMemoryQueue.length;
    return this.inMemoryQueue.filter((j) => j.queue === queue).length;
  }

  isDurable(): boolean {
    return this.getBullConnection() !== null;
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    const workers = [...this.bullWorkers.values()];
    const queues = [...this.bullQueues.values()];
    this.bullWorkers.clear();
    this.bullQueues.clear();

    await Promise.allSettled([
      ...workers.map((w) => w.close()),
      ...queues.map((q) => q.close()),
    ]);
  }
}

export const queueManager = new QueueManager();
