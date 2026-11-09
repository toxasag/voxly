import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isGoogleCloudPropagationDelay,
  PlatformConfigService,
} from "../modules/admin/platform-config.service.js";
import { ModelHealthService } from "../modules/ai/gateway/model-health.service.js";

describe("Google Gemini IAM Propagation & Multi-Model Health", () => {
  it("correctly identifies Google Cloud IAM propagation delay errors (HTTP 403)", () => {
    const error1 =
      "Gemini API has not been used in project 349724509827 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/generativelanguage.googleapis.com/overview?project=349724509827 then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.";
    assert.equal(isGoogleCloudPropagationDelay(403, error1), true);

    const error2 = "SERVICE_DISABLED: The Generative Language API is disabled.";
    assert.equal(isGoogleCloudPropagationDelay(403, error2), true);

    const error3 = "wait a few minutes for the action to propagate to our systems and retry";
    assert.equal(isGoogleCloudPropagationDelay(403, error3), true);

    const permanent401 = "API key not valid. Please pass a valid API key.";
    assert.equal(isGoogleCloudPropagationDelay(401, permanent401), false);

    const accountSuspended = "Account has been suspended or deleted";
    assert.equal(isGoogleCloudPropagationDelay(403, accountSuspended), false);

    const rateLimit429 = "RESOURCE_EXHAUSTED: Quota exceeded";
    assert.equal(isGoogleCloudPropagationDelay(429, rateLimit429), false);
  });

  it("manages pending_activation keys lifecycle without marking them permanently invalid", () => {
    const service = new PlatformConfigService();
    const testKey = "AIzaSyTestPropagationKey1234567890";

    // Изначально ключ валиден (не в черном списке)
    assert.equal(service.isKeyInvalid(testKey), false);
    assert.equal(service.isKeyPendingActivation(testKey), false);

    // Помечаем ключ как ожидающий активации
    service.markKeyPendingActivation(testKey, 10_000);
    assert.equal(service.isKeyPendingActivation(testKey), true);
    // Ключ в статусе pending_activation НЕ считается invalid!
    assert.equal(service.isKeyInvalid(testKey), false);

    // После успешной синхронизации помечаем как валидный
    service.markKeyValid(testKey);
    assert.equal(service.isKeyPendingActivation(testKey), false);
    assert.equal(service.isKeyInvalid(testKey), false);
  });

  it("ModelHealthService tracks availability and automatically flags failing models", () => {
    const healthService = new ModelHealthService();

    // 1. Изначально модель доступна
    assert.equal(healthService.isModelAvailable("genadich", "free/gemini-3.8-flash"), true);

    // 2. Фиксируем ошибку "Daily check-in required" (402)
    healthService.recordModelHealth("genadich", "free/gemini-3.8-flash", "unavailable", {
      statusCode: 402,
      failureReason: "Daily check-in required to use free models",
      ttlSeconds: 600,
    });

    // 3. Модель мгновенно помечается как unavailable
    assert.equal(healthService.isModelAvailable("genadich", "free/gemini-3.8-flash"), false);

    const status = healthService.getModelHealth("genadich", "free/gemini-3.8-flash");
    assert.ok(status);
    assert.equal(status.status, "unavailable");
    assert.equal(status.statusCode, 402);
    assert.ok(status.failureReason?.includes("Daily check-in"));

    // 4. Другая модель (например, на прямом Gemini) остаётся здоровой
    assert.equal(healthService.isModelAvailable("gemini", "gemini-3.5-flash-lite"), true);

    // 5. После успешного ответа восстанавливаем здоровье
    healthService.recordModelHealth("genadich", "free/gemini-3.8-flash", "healthy", {
      statusCode: 200,
      latencyMs: 340,
    });
    assert.equal(healthService.isModelAvailable("genadich", "free/gemini-3.8-flash"), true);
  });
});
