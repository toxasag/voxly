// ---------------------------------------------------------------------------
// Маршруты API интеграции с Битрикс24: /api/v1/settings/integrations/bitrix24
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../../plugins/authenticate.js";
import { bitrix24Service } from "./bitrix24.service.js";

const updateConfigBody = z.object({
  webhook_url: z.string().trim().max(500).optional(),
  is_enabled: z.boolean().optional(),
  allowed_sources: z.array(z.string().trim()).optional(),
});

const testConnectionBody = z.object({
  webhook_url: z.string().trim().max(500).optional(),
});

export default async function bitrix24Routes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);
  const admin = app.requirePermission("tenant:admin");

  /**
   * GET /
   * Получить конфигурацию Битрикс24 текущего арендатора.
   */
  app.get("/", { onRequest: admin }, async (request, reply) => {
    const config = await bitrix24Service.getConfig(request.tenant_id);
    return reply.send({ data: config, config, ...config });
  });

  const handleUpdate = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = updateConfigBody.parse(request.body);
    const updated = await bitrix24Service.saveConfig(request.tenant_id, {
      webhook_url: body.webhook_url,
      is_enabled: body.is_enabled,
      allowed_sources: body.allowed_sources,
    });
    return reply.send({ data: updated, config: updated, ...updated });
  };

  /**
   * PUT /
   * Сохранить настройки вебхука, статус активности и разрешенные источники.
   */
  app.put("/", { onRequest: admin }, handleUpdate);

  /**
   * PATCH /
   * Частичное обновление настроек интеграции (например, фильтр источников).
   */
  app.patch("/", { onRequest: admin }, handleUpdate);

  /**
   * POST /test
   * Проверить подключение к Битрикс24 (отправка тестового лида с [ТЕСТ]).
   */
  app.post("/test", { onRequest: admin }, async (request, reply) => {
    const body = testConnectionBody.parse(request.body ?? {});
    const result = await bitrix24Service.testConnection(request.tenant_id, body.webhook_url);
    return reply.send({ data: result, ...result });
  });
}
