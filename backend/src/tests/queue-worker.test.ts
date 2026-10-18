import { describe, it, expect, vi, beforeEach } from "vitest";
import { queueManager } from "../infrastructure/queue.js";

describe("Queue Worker Infrastructure (Block 7.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues and executes job by registered queue handler", async () => {
    const executed: unknown[] = [];
    queueManager.registerHandler<{ text: string }>("broadcasts", async (job) => {
      executed.push(job.data.text);
    });

    await queueManager.enqueue({
      queue: "broadcasts",
      tenantId: "tenant-1",
      name: "send-broadcast",
      data: { text: "Hello from queue" },
    });

    await queueManager.processNextBatch();

    expect(executed).toContain("Hello from queue");
  });

  it("retries failed job with exponential backoff up to maxAttempts", async () => {
    let callCount = 0;
    queueManager.registerHandler("timeline-sync", async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Temporary network glitch");
      }
    });

    await queueManager.enqueue({
      queue: "timeline-sync",
      tenantId: "tenant-1",
      name: "sync-deal",
      data: { dealId: "d-1" },
      maxAttempts: 3,
      backoffMs: 10,
    });

    // 1-я попытка (падает)
    await queueManager.processNextBatch();
    expect(callCount).toBe(1);

    // Ждем backoff
    await new Promise((r) => setTimeout(r, 25));

    // 2-я попытка (успешно)
    await queueManager.processNextBatch();
    expect(callCount).toBe(2);
  });
});
