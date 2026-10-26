import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  GeminiRateLimiter,
  hashApiKey,
  normalizeGeminiModel,
  getModelQuota,
  getModelFallbackChain,
} from "../modules/ai/gemini-rate-limiter.js";
import {
  GeminiKeyPoolService,
  GeminiQuotaExhaustedError,
} from "../modules/ai/gemini-key-pool.service.js";

describe("Gemini Key Pool & Rate Limiter Subsystem", () => {
  let rateLimiter: GeminiRateLimiter;
  let poolService: GeminiKeyPoolService;

  const mockKey1 = "AIzaSyTestKeyAlpha00000000000000000001";
  const mockKey2 = "AIzaSyTestKeyBeta000000000000000000002";
  const mockKey3 = "AIzaSyTestKeyGamma00000000000000000003";

  beforeEach(() => {
    vi.clearAllMocks();
    // Создаем свежий инстанс с fallback на in-memory (чистое состояние)
    rateLimiter = new GeminiRateLimiter();
    poolService = new GeminiKeyPoolService(rateLimiter);

    // Мокаем getAllPoolKeys для возврата наших тестовых ключей
    vi.spyOn(poolService, "getAllPoolKeys").mockResolvedValue([
      mockKey1,
      mockKey2,
      mockKey3,
    ]);
  });

  describe("Model Normalization and Quotas", () => {
    it("normalizes model names correctly", () => {
      expect(normalizeGeminiModel("models/gemini-3.8-flash")).toBe("gemini-3.8-flash");
      expect(normalizeGeminiModel("google/gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
      expect(normalizeGeminiModel("gemini-3.8-flash:generateContent")).toBe("gemini-3.8-flash");
      expect(normalizeGeminiModel("Gemini-2.5-Flash")).toBe("gemini-2.5-flash");
    });

    it("returns correct Google AI Studio Free Tier quotas", () => {
      const flashQuota = getModelQuota("gemini-3.8-flash");
      expect(flashQuota.rpm).toBe(5);
      expect(flashQuota.rpd).toBe(20);

      const liteQuota = getModelQuota("gemini-3.5-flash-lite");
      expect(liteQuota.rpm).toBe(15);
      expect(liteQuota.rpd).toBe(500);
    });

    it("has fallback chain from Flash to Flash Lite", () => {
      const chain = getModelFallbackChain("gemini-3.8-flash");
      expect(chain).toContain("gemini-3.5-flash-lite");
    });
  });

  describe("Sliding Window & Least-Loaded Selection", () => {
    it("selects the key with the lowest load score", async () => {
      const keyId1 = hashApiKey(mockKey1);
      const keyId2 = hashApiKey(mockKey2);
      const keyId3 = hashApiKey(mockKey3);

      // Загружаем key1 тремя запросами
      await rateLimiter.recordRequest(keyId1, "gemini-3.5-flash-lite", 1000);
      await rateLimiter.recordRequest(keyId1, "gemini-3.5-flash-lite", 1000);
      await rateLimiter.recordRequest(keyId1, "gemini-3.5-flash-lite", 1000);

      // Загружаем key2 одним запросом
      await rateLimiter.recordRequest(keyId2, "gemini-3.5-flash-lite", 1000);

      // key3 пустой (0 запросов) -> acquireKey должен выбрать key3
      const acquired = await poolService.acquireKey("gemini-3.5-flash-lite");
      expect(acquired.keyId).toBe(keyId3);
      expect(acquired.apiKey).toBe(mockKey3);
      expect(acquired.isFallback).toBe(false);
    });

    it("enforces RPM limits per key", async () => {
      const keyId = "test_rpm_key";
      const model = "gemini-3.8-flash"; // 5 RPM

      for (let i = 0; i < 5; i++) {
        const check = await rateLimiter.canAcquire(keyId, model);
        expect(check.allowed).toBe(true);
        await rateLimiter.recordRequest(keyId, model, 100);
      }

      // 6-й запрос в ту же минуту должен быть заблокирован
      const checkBlocked = await rateLimiter.canAcquire(keyId, model);
      expect(checkBlocked.allowed).toBe(false);
      expect(checkBlocked.reason).toBe("RPM_LIMIT");
      expect(checkBlocked.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("enforces RPD limits per key", async () => {
      const keyId = "test_rpd_key";
      const model = "gemini-3.8-flash"; // 20 RPD

      // Симулируем 20 запросов
      for (let i = 0; i < 20; i++) {
        await rateLimiter.recordRequest(keyId, model, 100);
      }

      // 21-й запрос должен вернуть RPD_LIMIT
      const checkBlocked = await rateLimiter.canAcquire(keyId, model);
      expect(checkBlocked.allowed).toBe(false);
      expect(checkBlocked.reason).toBe("RPD_LIMIT");
    });
  });

  describe("Automatic Cascading Model Fallback", () => {
    it("cascades from Flash (20 RPD exhausted) to Flash Lite (500 RPD) automatically", async () => {
      const model = "gemini-3.8-flash"; // 20 RPD
      const keys = [mockKey1, mockKey2, mockKey3];

      // Искусственно исчерпываем суточную квоту (20 RPD) для всех трех ключей на модели gemini-3.8-flash
      for (const k of keys) {
        const kId = hashApiKey(k);
        for (let i = 0; i < 20; i++) {
          await rateLimiter.recordRequest(kId, model, 500);
        }
      }

      // Теперь запрашиваем gemini-3.8-flash. Поскольку квота исчерпана на всех ключах,
      // сервис должен автоматически переключиться на совместимую модель из цепочки фоллбэка
      const acquired = await poolService.acquireKey(model);

      expect(acquired.isFallback).toBe(true);
      expect(acquired.originalModel).toBe("gemini-3.8-flash");
      // Модель фоллбэка должна быть одной из совместимых (например, gemini-3.7-flash или gemini-3.5-flash-lite)
      expect(["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]).toContain(acquired.model);
    });
  });

  describe("Circuit Breaker & Cooldown on 429", () => {
    it("puts key in cooldown when markRateLimited is called and rotates to next key", async () => {
      const model = "gemini-3.8-flash";
      const keyId1 = hashApiKey(mockKey1);

      // Помечаем key1 как получивший 429 RPM на 45 секунд
      await poolService.markRateLimited(mockKey1, model, 45, "RPM");

      // acquireKey должен вернуть либо key2, либо key3, но не key1
      const acquired = await poolService.acquireKey(model);
      expect(acquired.keyId).not.toBe(keyId1);
      expect([hashApiKey(mockKey2), hashApiKey(mockKey3)]).toContain(acquired.keyId);
    });

    it("throws GeminiQuotaExhaustedError when all keys and models are exhausted", async () => {
      // Исключаем все ключи или ставим их в кулдаун
      await poolService.markRateLimited(mockKey1, "all", 60, "RPM");
      await poolService.markRateLimited(mockKey2, "all", 60, "RPM");
      await poolService.markRateLimited(mockKey3, "all", 60, "RPM");

      await expect(poolService.acquireKey("gemini-3.8-flash")).rejects.toThrow(
        GeminiQuotaExhaustedError,
      );
    });
  });

  describe("Pool Statistics Reporting", () => {
    it("returns correct pool stats with masked keys and health status", async () => {
      const stats = await poolService.getPoolStats();

      expect(stats.totalKeys).toBe(3);
      expect(stats.availableKeys).toBe(3);
      expect(stats.keys).toHaveLength(3);

      const firstKey = stats.keys[0]!;
      expect(firstKey.maskedKey).toContain("••••");
      expect(firstKey.isHealthy).toBe(true);
      expect(firstKey.inCooldown).toBe(false);
    });
  });
});
