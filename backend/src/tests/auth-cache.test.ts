import type { ServerResponse } from "node:http";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Redis } from "ioredis";
import { deleteKeysByPattern } from "../infrastructure/redis.js";
import {
  closeAllSseStreams,
  getActiveSseCount,
  registerSseStream,
} from "../infrastructure/sse-registry.js";
import {
  authUserCacheKey,
  tenantModulesCacheKey,
} from "../plugins/auth-cache.js";

describe("deleteKeysByPattern (non-blocking SCAN)", () => {
  it("iterates SCAN cursor until '0' and deletes matched keys in batches", async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce(["42", ["k:1", "k:2"]])
      .mockResolvedValueOnce(["0", ["k:3"]]);
    const del = vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const fakeRedis = { scan, del } as unknown as Redis;
    const deleted = await deleteKeysByPattern(fakeRedis, "k:*", 100);

    expect(deleted).toBe(3);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenNthCalledWith(1, "0", "MATCH", "k:*", "COUNT", 100);
    expect(scan).toHaveBeenNthCalledWith(2, "42", "MATCH", "k:*", "COUNT", 100);
    expect(del).toHaveBeenNthCalledWith(1, "k:1", "k:2");
    expect(del).toHaveBeenNthCalledWith(2, "k:3");
  });

  it("does not call del when SCAN returns empty pages", async () => {
    const scan = vi.fn().mockResolvedValueOnce(["0", []]);
    const del = vi.fn();

    const fakeRedis = { scan, del } as unknown as Redis;
    const deleted = await deleteKeysByPattern(fakeRedis, "missing:*");

    expect(deleted).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });
});

describe("sse-registry graceful shutdown", () => {
  beforeEach(() => {
    closeAllSseStreams();
  });

  it("tracks active SSE connections and closes them cleanly on shutdown", () => {
    const end1 = vi.fn();
    const end2 = vi.fn();

    const res1 = { destroyed: false, writableEnded: false, end: end1 } as unknown as ServerResponse;
    const res2 = { destroyed: false, writableEnded: false, end: end2 } as unknown as ServerResponse;

    const unregister1 = registerSseStream(res1);
    registerSseStream(res2);

    expect(getActiveSseCount()).toBe(2);

    // Обычное закрытие одного клиента убирает его из реестра без вызова end() при shutdown
    unregister1();
    expect(getActiveSseCount()).toBe(1);

    // Graceful shutdown закрывает оставшиеся потоки
    closeAllSseStreams();
    expect(getActiveSseCount()).toBe(0);
    expect(end1).not.toHaveBeenCalled();
    expect(end2).toHaveBeenCalledTimes(1);
  });
});

describe("auth-cache key format", () => {
  it("scopes cache keys strictly by tenantId to preserve multi-tenant isolation", () => {
    expect(authUserCacheKey("tenant-a", "user-1")).toBe("auth:user:tenant-a:user-1");
    expect(authUserCacheKey("tenant-b", "user-1")).toBe("auth:user:tenant-b:user-1");
    expect(tenantModulesCacheKey("tenant-a")).toBe("auth:mods:tenant-a");
  });
});
