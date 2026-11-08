import { platformConfigService } from "../../admin/platform-config.service.js";
import type { ModelHealthStatus } from "./gateway.types.js";

/**
 * Сервис мониторинга доступности и здоровья LLM-моделей.
 *
 * Предотвращает простои и падения AI-ботов:
 * 1. Отслеживает временные ошибки провайдеров (HTTP 402 Daily check-in / Subscription,
 *    404 Model Not Found / Retired, 503 Overloaded / No available channel).
 * 2. Мгновенно исключает недоступные модели из каскадной цепочки в SmartModelRouter (0 мс задержки).
 * 3. Поддерживает фоновую и ручную диагностику candidate-моделей по всем активным шлюзам.
 */
export class ModelHealthService {
  private healthCache = new Map<string, ModelHealthStatus>();

  private buildKey(provider: string, modelId: string): string {
    return `${provider.toLowerCase().trim()}:${modelId.toLowerCase().trim()}`;
  }

  /**
   * Проверка доступности модели.
   * Если модель помечена как unavailable и TTL ещё не истёк — возвращает false.
   */
  isModelAvailable(provider: string, modelId: string): boolean {
    const key = this.buildKey(provider, modelId);
    const entry = this.healthCache.get(key);
    if (!entry) return true;

    if (Date.now() > entry.expiresAt) {
      this.healthCache.delete(key);
      return true;
    }

    return entry.status !== "unavailable";
  }

  /**
   * Фиксация состояния здоровья модели (healthy, degraded, unavailable).
   */
  recordModelHealth(
    provider: string,
    modelId: string,
    status: "healthy" | "degraded" | "unavailable",
    options: {
      providerType?: string;
      latencyMs?: number;
      failureReason?: string;
      statusCode?: number;
      ttlSeconds?: number;
    } = {},
  ): void {
    const key = this.buildKey(provider, modelId);
    const defaultTtlSeconds =
      status === "unavailable" ? 600 : status === "degraded" ? 180 : 3600;
    const ttlSeconds = options.ttlSeconds ?? defaultTtlSeconds;

    const record: ModelHealthStatus = {
      providerId: provider,
      providerType: options.providerType || provider,
      modelId: modelId.toLowerCase().trim(),
      status,
      latencyMs: options.latencyMs,
      failureReason: options.failureReason,
      statusCode: options.statusCode,
      lastCheckedAt: Date.now(),
      expiresAt: Date.now() + ttlSeconds * 1000,
    };

    this.healthCache.set(key, record);
  }

  /**
   * Получение текущего состояния модели.
   */
  getModelHealth(provider: string, modelId: string): ModelHealthStatus | null {
    const key = this.buildKey(provider, modelId);
    const entry = this.healthCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.healthCache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Получение всех активных записей здоровья моделей.
   */
  getAllModelStatuses(): ModelHealthStatus[] {
    const now = Date.now();
    const result: ModelHealthStatus[] = [];

    for (const [key, entry] of this.healthCache.entries()) {
      if (now > entry.expiresAt) {
        this.healthCache.delete(key);
      } else {
        result.push(entry);
      }
    }

    return result;
  }

  /**
   * Проверка здоровья отдельной модели прямым минимальным тестовым вызовом.
   */
  async checkModel(
    baseUrl: string,
    apiKey: string,
    providerId: string,
    providerType: string,
    modelId: string,
  ): Promise<ModelHealthStatus> {
    const cleanUrl = baseUrl.replace(/\/+$/, "");
    const startedAt = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(`${cleanUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 2,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startedAt;

      if (res.ok) {
        this.recordModelHealth(providerId, modelId, "healthy", {
          providerType,
          latencyMs,
          statusCode: 200,
        });
        return this.getModelHealth(providerId, modelId)!;
      }

      const text = await res.text().catch(() => "");
      let failureReason = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (j.error?.message) failureReason = j.error.message;
      } catch {
        failureReason = text.slice(0, 150) || res.statusText;
      }

      const isUnavailable =
        res.status === 402 ||
        res.status === 404 ||
        failureReason.includes("Daily check-in required") ||
        failureReason.includes("available only with a subscription") ||
        failureReason.includes("insufficient credits") ||
        failureReason.includes("No available channel") ||
        failureReason.includes("no longer available");

      const status = isUnavailable ? "unavailable" : "degraded";
      this.recordModelHealth(providerId, modelId, status, {
        providerType,
        latencyMs,
        failureReason,
        statusCode: res.status,
      });

      return this.getModelHealth(providerId, modelId)!;
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const msg = err instanceof Error ? err.message : String(err);
      this.recordModelHealth(providerId, modelId, "degraded", {
        providerType,
        latencyMs,
        failureReason: `Network error: ${msg}`,
      });
      return this.getModelHealth(providerId, modelId)!;
    }
  }

  /**
   * Комплексная диагностика всех активных провайдеров и их моделей.
   */
  async checkAllActiveModels(): Promise<ModelHealthStatus[]> {
    const integrations = await platformConfigService.getEffectiveIntegrations();
    const activeProviders = integrations.llmProviders.filter(
      (p) => p.isActive && p.apiKeys.length > 0 && Boolean(p.baseUrl),
    );

    const results: ModelHealthStatus[] = [];

    for (const prov of activeProviders) {
      const apiKey = prov.apiKeys.find((k) => !platformConfigService.isKeyInvalid(k)) || prov.apiKeys[0];
      if (!apiKey) continue;

      const candidateModels = Array.from(
        new Set([
          prov.chatModel,
          "gemini-3.5-flash-lite",
          "gemini-3.5-flash",
          "gemini-3.8-flash",
          "gpt-4o-mini",
        ]),
      ).filter(Boolean);

      for (const m of candidateModels) {
        // Проверяем модель только если провайдер поддерживает этот класс или это chatModel
        if (
          m === prov.chatModel ||
          (prov.providerType === "gemini" && m.includes("gemini")) ||
          (prov.providerType === "openai" && (m.includes("gpt") || m.includes("gemini") || m.includes("deepseek")))
        ) {
          const status = await this.checkModel(prov.baseUrl, apiKey, prov.id, prov.providerType, m);
          results.push(status);
        }
      }
    }

    return results;
  }
}

export const modelHealthService = new ModelHealthService();
