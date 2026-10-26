import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AnalyticsService } from "./analytics.service.js";
import { analyticsIntegrationsService } from "./analytics-integrations.service.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { ANALYTICS_PROVIDERS } from "./analytics.types.js";
import { NotFoundError } from "../../plugins/errorHandler.js";

const providerParamSchema = z.object({
  provider: z.enum(ANALYTICS_PROVIDERS),
});

const updateIntegrationSchema = z.object({
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).default({}),
});

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const service = new AnalyticsService();

  await app.register(authenticatePlugin);

  /**
   * Сводные показатели аналитики (KPI, PnL, воронка сделок, загрузка мастеров, топ ремонтов)
   */
  app.get("/overview", async (request, reply) => {
    const tenantId = request.tenant_id;
    const data = await service.getOverview(tenantId);
    return reply.send({ data });
  });

  /**
   * Список подключенных систем веб-аналитики и серверных конверсий
   */
  app.get("/integrations", async (request, reply) => {
    const tenantId = request.tenant_id;
    const data = await analyticsIntegrationsService.listIntegrations(tenantId);
    return reply.send({ data });
  });

  /**
   * Получение настроек интеграции конкретного провайдера
   */
  app.get("/integrations/:provider", async (request, reply) => {
    const tenantId = request.tenant_id;
    const { provider } = providerParamSchema.parse(request.params);
    const data = await analyticsIntegrationsService.getIntegration(tenantId, provider);
    if (!data) {
      throw new NotFoundError(`Интеграция ${provider} не найдена`);
    }
    return reply.send({ data });
  });

  /**
   * Сохранение настроек интеграции (с шифрованием секретов)
   */
  app.put("/integrations/:provider", async (request, reply) => {
    const tenantId = request.tenant_id;
    const { provider } = providerParamSchema.parse(request.params);
    const payload = updateIntegrationSchema.parse(request.body);
    const data = await analyticsIntegrationsService.saveIntegration(tenantId, provider, payload);
    return reply.send({ data });
  });

  /**
   * Тестовая отправка события в систему аналитики
   */
  app.post("/integrations/:provider/test", async (request, reply) => {
    const tenantId = request.tenant_id;
    const { provider } = providerParamSchema.parse(request.params);
    const result = await analyticsIntegrationsService.testIntegration(tenantId, provider);
    return reply.send({ data: result });
  });
};
