import { describe, expect, it } from "vitest";
import { getRedisHealth } from "../infrastructure/redis.js";

describe("Redis health contract", () => {
  it("reports an explicit configured/connected shape", () => {
    const health = getRedisHealth();
    expect(typeof health.configured).toBe("boolean");
    expect(typeof health.connected).toBe("boolean");
  });
});
