import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { platformConfigService } from "../admin/platform-config.service.js";
import { geminiKeyPoolService } from "./gemini-key-pool.service.js";

const verifyKeySchema = z.object({
  apiKey: z.string().trim().min(1, "API-ключ обязателен"),
  baseUrl: z.string().optional(),
  save: z.boolean().optional(),
});

export default async function geminiIntegrationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  app.post("/verify", async (request, reply) => {
    const parseResult = verifyKeySchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message || "Неверные входные данные",
          details: parseResult.error.format(),
        },
      });
    }

    const { apiKey, baseUrl, save } = parseResult.data;
    const effectiveBaseUrl = (baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");

    let lastErrorDetails = "";
    let statusCode = 400;

    // 1. Проверяем через нативный Google Gemini API
    try {
      const nativeUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(nativeUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
        };
        const models = Array.isArray(data.models) ? data.models : [];
        const count = models.length;

        if (save) {
          await platformConfigService.saveSingleWorkingKey("gemini", apiKey, effectiveBaseUrl);
        }

        return reply.status(200).send({
          success: true,
          is_active: true,
          provider: "gemini",
          tenant_id: request.tenant_id,
          modelsCount: count,
          message: "Ключ Google Gemini валиден и готов к работе",
          data: {
            isValid: true,
            modelsCount: count,
          },
        });
      } else {
        statusCode = res.status;
        const text = await res.text().catch(() => "");
        try {
          const j = JSON.parse(text) as {
            error?: { message?: string; details?: Array<{ message?: string }> };
          };
          lastErrorDetails = j.error?.message || j.error?.details?.[0]?.message || text.slice(0, 200);
        } catch {
          lastErrorDetails = text.slice(0, 200) || res.statusText;
        }
      }
    } catch (err) {
      lastErrorDetails = err instanceof Error ? err.message : String(err);
    }

    // 2. Если нативный эндпоинт вернул не 200, пробуем также через OpenAI-совместимый эндпоинт
    if (!lastErrorDetails.includes("API key not valid") && !lastErrorDetails.includes("deleted or disabled")) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(`${effectiveBaseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { data?: unknown[] };
          const count = Array.isArray(data.data) ? data.data.length : 0;

          if (save) {
            await platformConfigService.saveSingleWorkingKey("gemini", apiKey, effectiveBaseUrl);
          }

          return reply.status(200).send({
            success: true,
            is_active: true,
            provider: "gemini",
            tenant_id: request.tenant_id,
            modelsCount: count,
            message: "Ключ Google Gemini валиден и готов к работе",
            data: {
              isValid: true,
              modelsCount: count,
            },
          });
        } else {
          statusCode = res.status;
          const text = await res.text().catch(() => "");
          try {
            const j = JSON.parse(text) as { error?: { message?: string } };
            if (j.error?.message) {
              lastErrorDetails = j.error.message;
            }
          } catch {}
        }
      } catch {}
    }

    // Формируем чистый текст ошибки с обязательным кодом PROVIDER_KEY_INVALID
    const cleanErrorMsg = lastErrorDetails.trim() || "API key not valid. Please pass a valid API key.";
    const fullMessage = `Ошибка Google Gemini API: API_KEY_INVALID - ${cleanErrorMsg}`;

    return reply.status(400).send({
      success: false,
      error: {
        code: "PROVIDER_KEY_INVALID",
        message: fullMessage,
        details: cleanErrorMsg,
        statusCode,
      },
    });
  });

  /**
   * Получение статистики утилизации квот пула ключей Google Gemini (RPM/TPM/RPD, кулдауны).
   */
  app.get("/pool-stats", async (_request, reply) => {
    const stats = await geminiKeyPoolService.getPoolStats();
    return reply.status(200).send({
      success: true,
      data: stats,
    });
  });
}
