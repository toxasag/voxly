import type { ModelTier, ModelProfile } from "./gateway.types.js";

/**
 * Каталог профилей моделей с разделением по Tiers и индивидуальным квотам.
 */
export const MODEL_PROFILES_CATALOG: Record<string, ModelProfile> = {
  // --- TIER: FAST_CHEAP ---
  "gemini-3.5-flash-lite": {
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    tier: "FAST_CHEAP",
    limits: { rpm: 15, tpm: 250_000, rpd: 500, maxContext: 1_000_000 },
    fallbackModelId: "gemini-3.1-flash-lite",
    priority: 10,
    costInPer1k: 5,
    costOutPer1k: 20,
  },
  "gemini-3.1-flash-lite": {
    id: "gemini-3.1-flash-lite",
    provider: "gemini",
    tier: "FAST_CHEAP",
    limits: { rpm: 15, tpm: 250_000, rpd: 500, maxContext: 1_000_000 },
    fallbackModelId: "gpt-4o-mini",
    priority: 15,
    costInPer1k: 5,
    costOutPer1k: 20,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    tier: "FAST_CHEAP",
    limits: { rpm: 500, tpm: 200_000, maxContext: 128_000 },
    fallbackModelId: "deepseek-v3",
    priority: 20,
    costInPer1k: 15,
    costOutPer1k: 60,
  },
  "deepseek-v3": {
    id: "deepseek-v3",
    provider: "deepseek",
    tier: "FAST_CHEAP",
    limits: { rpm: 100, tpm: 150_000, maxContext: 64_000 },
    fallbackModelId: "gemini-3.5-flash-lite",
    priority: 25,
    costInPer1k: 14,
    costOutPer1k: 28,
  },
  "gemini-flash-lite-latest": {
    id: "gemini-flash-lite-latest",
    provider: "gemini",
    tier: "FAST_CHEAP",
    limits: { rpm: 15, tpm: 250_000, rpd: 500, maxContext: 1_000_000 },
    fallbackModelId: "gemini-3.5-flash-lite",
    priority: 12,
    costInPer1k: 5,
    costOutPer1k: 20,
  },
  "gemini-3.5-flash": {
    id: "gemini-3.5-flash",
    provider: "gemini",
    tier: "FAST_CHEAP",
    limits: { rpm: 30, tpm: 250_000, rpd: 5000, maxContext: 1_000_000 },
    fallbackModelId: "gemini-flash-lite-latest",
    priority: 30,
    costInPer1k: 10,
    costOutPer1k: 40,
  },
  "gemini-3.8-flash": {
    id: "gemini-3.8-flash",
    provider: "gemini",
    tier: "FAST_CHEAP",
    limits: { rpm: 30, tpm: 250_000, rpd: 5000, maxContext: 1_000_000 },
    fallbackModelId: "gemini-flash-lite-latest",
    priority: 30,
    costInPer1k: 10,
    costOutPer1k: 40,
  },
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    provider: "gemini",
    tier: "FAST_CHEAP",
    limits: { rpm: 30, tpm: 250_000, rpd: 5000, maxContext: 1_000_000 },
    fallbackModelId: "gemini-flash-lite-latest",
    priority: 35,
    costInPer1k: 10,
    costOutPer1k: 40,
  },

  // --- TIER: REASONING_HEAVY ---
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    tier: "REASONING_HEAVY",
    limits: { rpm: 200, tpm: 80_000, maxContext: 128_000 },
    fallbackModelId: "claude-sonnet-4",
    priority: 10,
    costInPer1k: 250,
    costOutPer1k: 1000,
  },
  "claude-sonnet-4": {
    id: "claude-sonnet-4",
    provider: "anthropic",
    tier: "REASONING_HEAVY",
    limits: { rpm: 50, tpm: 40_000, maxContext: 200_000 },
    fallbackModelId: "gemini-2.5-pro",
    priority: 15,
    costInPer1k: 300,
    costOutPer1k: 1500,
  },
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    provider: "gemini",
    tier: "REASONING_HEAVY",
    limits: { rpm: 2, tpm: 32_000, rpd: 50, maxContext: 2_000_000 },
    fallbackModelId: "gpt-4o-mini",
    priority: 20,
    costInPer1k: 125,
    costOutPer1k: 500,
  },
  "claude-opus-4": {
    id: "claude-opus-4",
    provider: "anthropic",
    tier: "REASONING_HEAVY",
    limits: { rpm: 20, tpm: 20_000, maxContext: 200_000 },
    fallbackModelId: "gpt-4o",
    priority: 30,
    costInPer1k: 1500,
    costOutPer1k: 7500,
  },

  // --- TIER: FALLBACK_SAFE ---
  "openrouter/auto": {
    id: "openrouter/auto",
    provider: "openrouter",
    tier: "FALLBACK_SAFE",
    limits: { rpm: 100, tpm: 100_000, maxContext: 64_000 },
    priority: 10,
    costInPer1k: 10,
    costOutPer1k: 30,
  },
};

/**
 * Карта каскадных переходов (Fallback Chains) при исчерпании лимитов.
 */
export const HIERARCHICAL_FALLBACK_MATRIX: Record<string, string[]> = {
  // Heavy Reasoning -> Safe Fallback to Fast & Resilient models
  "gpt-4o": ["gpt-4o-mini", "claude-sonnet-4", "gemini-2.5-pro", "gemini-3.5-flash-lite"],
  "claude-sonnet-4": ["gpt-4o", "gemini-2.5-pro", "gpt-4o-mini", "gemini-3.5-flash-lite"],
  "gemini-2.5-pro": ["gpt-4o-mini", "gemini-3.5-flash-lite", "deepseek-v3"],
  "claude-opus-4": ["gpt-4o", "claude-sonnet-4", "gpt-4o-mini"],

  // Fast & Cheap -> Resilient Cross-Provider Fallbacks
  "gemini-3.8-flash": ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gpt-4o-mini"],
  "gemini-3.5-flash": ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gpt-4o-mini"],
  "gemini-3.5-flash-lite": ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gpt-4o-mini"],
  "gemini-2.5-flash": ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash"],
  "gemini-2.5-flash-lite": ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"],
  "free/gemini-3.8-flash": ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash"],
  "free/gemini-3.1-pro": ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-pro"],
  "gemini-flash-lite-latest": ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"],
  "gemini-3.1-flash-lite": ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"],
  "gpt-4o-mini": ["gemini-3.5-flash-lite", "gemini-3.8-flash", "deepseek-v3"],
  "deepseek-v3": ["gpt-4o-mini", "gemini-3.5-flash-lite"],
};

export class ModelTierRouter {
  /**
   * Нормализация названия модели (удаление префиксов models/, google/, openrouter/).
   */
  normalizeModelId(rawModel: string): string {
    let clean = rawModel.trim();
    clean = clean.replace(/:[a-zA-Z]+$/, ""); // отрезаем суффиксы вызовов :generateContent
    if (clean.startsWith("models/")) clean = clean.replace(/^models\//, "");
    if (clean.startsWith("google/")) clean = clean.replace(/^google\//, "");
    if (clean.startsWith("gemini/")) clean = clean.replace(/^gemini\//, "");
    return clean.toLowerCase();
  }

  /**
   * Определение провайдера по идентификатору модели или URL.
   */
  resolveProvider(model: string, baseUrl?: string): string {
    const norm = model.toLowerCase();
    const url = baseUrl?.toLowerCase() || "";

    if (url.includes("generativelanguage.googleapis.com") || norm.includes("gemini")) {
      return "gemini";
    }
    if (url.includes("api.openai.com") || norm.startsWith("gpt-") || norm.startsWith("o1-") || norm.startsWith("o3-")) {
      return "openai";
    }
    if (url.includes("api.deepseek.com") || norm.includes("deepseek")) {
      return "deepseek";
    }
    if (url.includes("api.anthropic.com") || norm.includes("claude")) {
      return "anthropic";
    }
    if (url.includes("openrouter.ai") || norm.startsWith("openrouter/")) {
      return "openrouter";
    }
    return "custom";
  }

  /**
   * Получение профиля модели с дефолтными безопасными лимитами.
   */
  getModelProfile(model: string, baseUrl?: string): ModelProfile {
    const norm = this.normalizeModelId(model);
    const existing = MODEL_PROFILES_CATALOG[norm];
    if (existing) {
      return existing;
    }

    const provider = this.resolveProvider(norm, baseUrl);
    const isReasoning = norm.includes("pro") || norm.includes("opus") || norm.includes("sonnet") || norm === "gpt-4o";
    const tier: ModelTier = isReasoning ? "REASONING_HEAVY" : "FAST_CHEAP";

    return {
      id: norm,
      provider,
      tier,
      limits: isReasoning
        ? { rpm: 10, tpm: 50_000, maxContext: 128_000 }
        : { rpm: 30, tpm: 150_000, maxContext: 64_000 },
      priority: 50,
      costInPer1k: 20,
      costOutPer1k: 50,
    };
  }

  /**
   * Построение иерархической цепочки переключения (Fallback Chain).
   * Исключает рекурсию и дублирование моделей.
   */
  getFallbackChain(requestedModel: string, tierHint?: ModelTier): string[] {
    const norm = this.normalizeModelId(requestedModel);
    const chain: string[] = [];
    const visited = new Set<string>([norm]);

    // 1. Прямые каскадные соответствия из матрицы
    const matrixFallbacks = HIERARCHICAL_FALLBACK_MATRIX[norm] || [];
    for (const fb of matrixFallbacks) {
      const normFb = this.normalizeModelId(fb);
      if (!visited.has(normFb)) {
        visited.add(normFb);
        chain.push(normFb);
      }
    }

    // 2. Если передан tierHint или цепочка пуста — добавляем модели того же Tier
    const profile = this.getModelProfile(norm);
    const effectiveTier = tierHint || profile.tier;

    const tierCandidates = Object.values(MODEL_PROFILES_CATALOG)
      .filter((p) => p.tier === effectiveTier && !visited.has(p.id))
      .sort((a, b) => a.priority - b.priority)
      .map((p) => p.id);

    for (const tc of tierCandidates) {
      if (!visited.has(tc)) {
        visited.add(tc);
        chain.push(tc);
      }
    }

    // 3. Безопасный глобальный резерв (FALLBACK_SAFE) в конце цепочки
    const safeCandidates = ["gemini-3.5-flash-lite", "gpt-4o-mini"];
    for (const sc of safeCandidates) {
      if (!visited.has(sc)) {
        visited.add(sc);
        chain.push(sc);
      }
    }

    return chain;
  }
}

export const modelTierRouter = new ModelTierRouter();
