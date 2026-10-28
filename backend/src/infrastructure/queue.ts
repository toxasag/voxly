// ---------------------------------------------------------------------------
// Очереди фоновых задач (M7.2 Infrastructure Queues).
//
// Предоставляет отказоустойчивый интерфейс постановки и обработки задач
// с поддержкой очередей: `ai-usage`, `timeline-sync`, `broadcasts`.
// При NODE_ENV=production отсутствие Redis не маскируется in-memory очередью:
// бизнес-критичные jobs должны быть durable либо явно отклонены.
// ---------------------------------------------------------------------------

import { requireDurableQueue } from "./redis.js";

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

class QueueManager {
  private handlers = new Map<QueueName, JobHandler>();
  private inMemoryQueue: QueueJob[] = [];
  private isProcessing = false;
  private isShuttingDown = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startWorker();
  }

  registerHandler<T = unknown>(queue: QueueName, handler: JobHandler<T>): void {
    this.handlers.set(queue, handler as JobHandler);
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

    const job: QueueJob<T> = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      queue: params.queue,
      tenantId: params.tenantId,
      name: params.name,
      data: params.data,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 5,
      backoffMs: params.backoffMs ?? 1000,
      createdAt: new Date().toISOString(),
    };

    this.inMemoryQueue.push(job as QueueJob);
    return job;
  }

  private startWorker(): void {
    this.intervalTimer = setInterval(() => {
      void this.processNextBatch();
    }, 200);
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
        // Нет обработчика для очереди
        return;
      }

      job.attempts += 1;
      try {
        await handler(job);
      } catch (err) {
        if (job.attempts < job.maxAttempts) {
          // Экспоненциальный backoff
          const delay = job.backoffMs * Math.pow(2, job.attempts - 1);
          setTimeout(() => {
            if (!this.isShuttingDown) {
              this.inMemoryQueue.push(job);
            }
          }, delay);
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

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}

export const queueManager = new QueueManager();
