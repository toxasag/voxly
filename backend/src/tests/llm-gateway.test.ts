import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  modelTierRouter,
  keyPoolManager,
  redisLuaLimiter,
  SmartModelRouter,
  LlmGatewayExhaustedError,
} from "../modules/ai/gateway/index.js";

describe("Distributed LLM Gateway & Two-Level Rotation (Key + Model Routing)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisLuaLimiter.resetAll();
  });

  afterEach(async () => {
    await redisLuaLimiter.resetAll();
  });

  describe("Level 2: Model Tier Router & Hierarchical Fallback Matrix", () => {
    it("correctly identifies model tiers and providers", () => {
      const gpt4o = modelTierRouter.getModelProfile("gpt-4o");
      expect(gpt4o.tier).toBe("REASONING_HEAVY");
      expect(gpt4o.provider).toBe("openai");

      const geminiLite = modelTierRouter.getModelProfile("gemini-3.5-flash-lite");
      expect(geminiLite.tier).toBe("FAST_CHEAP");
      expect(geminiLite.provider).toBe("gemini");
      expect(geminiLite.limits.rpd).toBe(500);

      const deepseek = modelTierRouter.getModelProfile("deepseek-v3");
      expect(deepseek.tier).toBe("FAST_CHEAP");
      expect(deepseek.provider).toBe("deepseek");
    });

    it("builds hierarchical cascade fallback chain without cycles", () => {
      const chain = modelTierRouter.getFallbackChain("gpt-4o");
      expect(chain).toContain("gpt-4o-mini");
      expect(chain).toContain("gemini-3.5-flash-lite");
      expect(new Set(chain).size).toBe(chain.length); // no duplicates
      expect(chain).not.toContain("gpt-4o"); // original model not in fallback
    });

    it("cascades from flash models to high-capacity flash-lite models", () => {
      const chain = modelTierRouter.getFallbackChain("gemini-3.8-flash");
      expect(chain).toContain("gemini-3.5-flash-lite");
      expect(chain.indexOf("gemini-3.5-flash-lite")).toBeGreaterThan(-1);
    });
  });

  describe("Level 1: Horizontal Key Pool & Atomic Slot Reservation", () => {
    const key1 = "sk-proj-test-key-alpha-111111111111111";
    const key2 = "sk-proj-test-key-beta-2222222222222222";

    beforeEach(() => {
      vi.spyOn(keyPoolManager, "getKeysForProvider").mockResolvedValue([
        {
          id: "ok_alpha",
          provider: "openai",
          key: key1,
          maskedKey: "sk-proj••••111",
          status: "active",
          cooldownUntil: 0,
          loadScore: 0,
        },
        {
          id: "ok_beta",
          provider: "openai",
          key: key2,
          maskedKey: "sk-proj••••222",
          status: "active",
          cooldownUntil: 0,
          loadScore: 0,
        },
      ]);
    });

    it("allocates slot to the least-loaded key", async () => {
      const limits = { rpm: 10, tpm: 100_000, maxContext: 32_000 };

      // Загружаем key1
      await redisLuaLimiter.reserveSlot("ok_alpha", "openai", "gpt-4o-mini", limits, 1000);
      await redisLuaLimiter.reserveSlot("ok_alpha", "openai", "gpt-4o-mini", limits, 1000);

      // acquireKeySlot должен выбрать наименее загруженный key2
      const slot = await keyPoolManager.acquireKeySlot("openai", "gpt-4o-mini", limits);
      expect(slot).not.toBeNull();
      expect(slot?.keyId).toBe("ok_beta");
    });

    it("respects RPM limits and blocks when threshold reached", async () => {
      const limits = { rpm: 2, tpm: 100_000, maxContext: 32_000 };

      const slot1 = await redisLuaLimiter.reserveSlot("test_key", "openai", "gpt-4o-mini", limits);
      expect(slot1.allowed).toBe(true);

      const slot2 = await redisLuaLimiter.reserveSlot("test_key", "openai", "gpt-4o-mini", limits);
      expect(slot2.allowed).toBe(true);

      const slot3 = await redisLuaLimiter.reserveSlot("test_key", "openai", "gpt-4o-mini", limits);
      expect(slot3.allowed).toBe(false);
      expect(slot3.reason).toBe("RPM_LIMIT");
    });

    it("handles 429 rate limit cooldown with retry-after header parsing", async () => {
      const headers = new Headers({ "retry-after": "45" });
      const cooloff = await keyPoolManager.handleRateLimit(
        "ok_alpha",
        "openai",
        "gpt-4o-mini",
        headers,
        "rate limit reached",
      );

      expect(cooloff).toBe(45);

      const limits = { rpm: 10, tpm: 100_000, maxContext: 32_000 };
      const res = await redisLuaLimiter.reserveSlot("ok_alpha", "openai", "gpt-4o-mini", limits);
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe("COOLDOWN");
    });
  });

  describe("Circuit Breaker on 5xx Errors", () => {
    it("trips circuit breaker to OPEN after consecutive 5xx errors", async () => {
      // 1-я ошибка
      let tripped = await redisLuaLimiter.recordFailure("openai", "gpt-4o", 3, 30);
      expect(tripped).toBe(false);

      // 2-я ошибка
      tripped = await redisLuaLimiter.recordFailure("openai", "gpt-4o", 3, 30);
      expect(tripped).toBe(false);

      // 3-я ошибка -> Circuit Breaker срабатывает
      tripped = await redisLuaLimiter.recordFailure("openai", "gpt-4o", 3, 30);
      expect(tripped).toBe(true);

      const limits = { rpm: 100, tpm: 100_000, maxContext: 32_000 };
      const check = await redisLuaLimiter.reserveSlot("any_key", "openai", "gpt-4o", limits);
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe("CIRCUIT_OPEN");
    });

    it("resets failure counter on success", async () => {
      await redisLuaLimiter.recordFailure("openai", "gpt-4o", 3, 30);
      await redisLuaLimiter.recordFailure("openai", "gpt-4o", 3, 30);

      // Успешный запрос
      await redisLuaLimiter.recordSuccess("openai", "gpt-4o");

      // После успеха требуется снова 3 ошибки для открытия Circuit Breaker
      const tripped = await redisLuaLimiter.recordFailure("openai", "gpt-4o", 3, 30);
      expect(tripped).toBe(false);
    });
  });

  describe("SmartModelRouter: End-to-End Key Rotation & Model Fallback", () => {
    let router: SmartModelRouter;

    beforeEach(() => {
      router = new SmartModelRouter();

      // Мокаем ключи для провайдеров
      vi.spyOn(keyPoolManager, "getKeysForProvider").mockImplementation(async (provider) => {
        if (provider === "openai") {
          return [
            {
              id: "ok_alpha",
              provider: "openai",
              key: "sk-openai-key-alpha",
              maskedKey: "sk-open••••lpha",
              status: "active",
              cooldownUntil: 0,
              loadScore: 0,
            },
            {
              id: "ok_beta",
              provider: "openai",
              key: "sk-openai-key-beta",
              maskedKey: "sk-open••••beta",
              status: "active",
              cooldownUntil: 0,
              loadScore: 0,
            },
          ];
        }
        if (provider === "gemini") {
          return [
            {
              id: "gk_gamma",
              provider: "gemini",
              key: "AIzaSyGeminiKeyGamma",
              maskedKey: "AIza••••amma",
              status: "active",
              cooldownUntil: 0,
              loadScore: 0,
            },
          ];
        }
        return [];
      });
    });

    it("transparently rotates from Key A to Key B on 429", async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      // 1-й вызов (с key alpha) возвращает 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "60" }),
        text: async () => "Rate limit exceeded",
      });

      // 2-й вызов (с key beta) возвращает 200 OK
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Успешный ответ от ключа B" } }],
          usage: { prompt_tokens: 15, completion_tokens: 25 },
          model: "gpt-4o-mini",
        }),
      });

      const result = await router.execute({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Привет" }],
      });

      expect(result.content).toBe("Успешный ответ от ключа B");
      expect(result.keyId).toBe("ok_beta");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Проверяем, что первый ключ ушел в кулдаун
      const checkAlpha = await redisLuaLimiter.isCooldown("ok_alpha", "gpt-4o-mini");
      expect(checkAlpha.inCooldown).toBe(true);
    });

    it("transparently falls back to secondary model when all keys of primary model are exhausted", async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      // Ставим оба ключа openai в кулдаун для gpt-4o
      await redisLuaLimiter.setCooldown("ok_alpha", "gpt-4o", 120, "TEST_EXHAUSTED");
      await redisLuaLimiter.setCooldown("ok_beta", "gpt-4o", 120, "TEST_EXHAUSTED");

      // На fallback модели (gpt-4o-mini или gemini-3.5-flash-lite) запрос успешно исполняется
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Ответ от резервной модели" } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
          model: "gpt-4o-mini",
        }),
      });

      const result = await router.execute({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Сложная задача" }],
      });

      expect(result.content).toBe("Ответ от резервной модели");
      expect(result.isFallback).toBe(true);
      expect(result.originalModel).toBe("gpt-4o");
    });

    it("throws LlmGatewayExhaustedError when all keys and fallback models are in cooldown", async () => {
      // Ставим в кулдаун все ключи
      await redisLuaLimiter.setCooldown("ok_alpha", null, 120, "TOTAL_EXHAUSTION");
      await redisLuaLimiter.setCooldown("ok_beta", null, 120, "TOTAL_EXHAUSTION");
      await redisLuaLimiter.setCooldown("gk_gamma", null, 120, "TOTAL_EXHAUSTION");

      await expect(
        router.execute({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Тест" }],
        }),
      ).rejects.toThrow(LlmGatewayExhaustedError);
    });
  });
});
