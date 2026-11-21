import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const addMock = vi.fn().mockResolvedValue({ id: "bull-job-42" });
const queueCloseMock = vi.fn().mockResolvedValue(undefined);
const workerCloseMock = vi.fn().mockResolvedValue(undefined);
let capturedProcessor: ((job: unknown) => Promise<void>) | null = null;
const registeredQueues: string[] = [];

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    constructor(public name: string) {}
    on() {
      return this;
    }
    add = addMock;
    close = queueCloseMock;
  },
  Worker: class MockWorker {
    constructor(
      public name: string,
      processor: (job: unknown) => Promise<void>,
    ) {
      capturedProcessor = processor;
    }
    on() {
      return this;
    }
    close = workerCloseMock;
  },
}));

vi.mock("../infrastructure/redis.js", () => ({
  getRedisConnectionOptions: vi.fn().mockReturnValue({
    host: "127.0.0.1",
    port: 6379,
    db: 1,
    maxRetriesPerRequest: null,
  }),
  requireDurableQueue: vi.fn(),
}));

vi.mock("../infrastructure/queue-metrics.js", () => ({
  registerBullQueue: vi.fn((name: string) => {
    registeredQueues.push(name);
  }),
}));

import { QueueManager } from "../infrastructure/queue.js";

describe("QueueManager BullMQ durable mode", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    registeredQueues.length = 0;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("uses BullMQ Queue + Worker when Redis is configured outside test env and closes cleanly", async () => {
    process.env.NODE_ENV = "production";
    const manager = new QueueManager(false);
    expect(manager.isDurable()).toBe(true);

    const received: unknown[] = [];
    manager.registerHandler<{ amount: number }>("ai-usage", async (job) => {
      received.push({ id: job.id, tenantId: job.tenantId, amount: job.data.amount, attempts: job.attempts });
    });

    expect(registeredQueues).toContain("qm-ai-usage");
    expect(capturedProcessor).not.toBeNull();

    const enqueued = await manager.enqueue({
      queue: "ai-usage",
      tenantId: "t-1",
      name: "charge",
      data: { amount: 150 },
      maxAttempts: 4,
      backoffMs: 500,
    });

    expect(enqueued.id).toBe("bull-job-42");
    expect(addMock).toHaveBeenCalledWith(
      "charge",
      expect.objectContaining({
        queue: "ai-usage",
        tenantId: "t-1",
        data: { amount: 150 },
      }),
      expect.objectContaining({
        attempts: 4,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: { count: 1000, age: 86_400 },
        removeOnFail: { count: 500, age: 86_400 },
      }),
    );

    await capturedProcessor!({
      id: "bull-job-42",
      name: "charge",
      attemptsMade: 1,
      timestamp: Date.now(),
      opts: { attempts: 4 },
      data: {
        queue: "ai-usage",
        tenantId: "t-1",
        name: "charge",
        data: { amount: 150 },
        maxAttempts: 4,
        backoffMs: 500,
        createdAt: new Date().toISOString(),
      },
    });

    expect(received).toEqual([{ id: "bull-job-42", tenantId: "t-1", amount: 150, attempts: 2 }]);

    await manager.shutdown();
    expect(workerCloseMock).toHaveBeenCalledTimes(1);
    expect(queueCloseMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to in-memory queue when forceInMemory is true", async () => {
    process.env.NODE_ENV = "production";
    const manager = new QueueManager(true);
    expect(manager.isDurable()).toBe(false);

    let processed = false;
    manager.registerHandler("broadcasts", async () => {
      processed = true;
    });

    await manager.enqueue({
      queue: "broadcasts",
      tenantId: "t-2",
      name: "ping",
      data: {},
    });

    expect(addMock).not.toHaveBeenCalled();
    await manager.processNextBatch();
    expect(processed).toBe(true);
    await manager.shutdown();
  });
});
