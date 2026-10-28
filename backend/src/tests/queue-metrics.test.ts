import { describe, expect, it } from "vitest";
import { getBullQueueMetrics } from "../infrastructure/queue-metrics.js";

describe("BullMQ metrics contract", () => {
  it("returns a stable metrics array when no queues are registered", async () => {
    const metrics = await getBullQueueMetrics();
    expect(Array.isArray(metrics)).toBe(true);
    for (const metric of metrics) {
      expect(typeof metric.name).toBe("string");
      expect(typeof metric.waiting).toBe("number");
      expect(typeof metric.active).toBe("number");
      expect(typeof metric.failed).toBe("number");
      expect(metric.oldestJobAgeMs === null || typeof metric.oldestJobAgeMs === "number").toBe(true);
    }
  });
});
