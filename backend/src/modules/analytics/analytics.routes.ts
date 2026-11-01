import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AnalyticsService } from "./analytics.service.js";
import { analyticsIntegrationsService } from "./analytics-integrations.service.js";
import { attributionEngineService } from "./attribution-engine.service.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { ANALYTICS_PROVIDERS } from "./analytics.types.js";
import { NotFoundError, ValidationError } from "../../plugins/errorHandler.js";
import { queryOne } from "../../db/client.js";

const providerParamSchema = z.object({
  provider: z.enum(ANALYTICS_PROVIDERS),
});

const idParamSchema = z.object({
  id: z.string().uuid("Invalid UUID format"),
});

const testQueueParamsSchema = z.object({
  provider: z.enum(ANALYTICS_PROVIDERS),
  jobId: z.string().min(1),
});

const eventRulesSchema = z
  .object({
    onLeadCreated: z.boolean().optional(),
    onDealWon: z.boolean().optional(),
    onFirstMessage: z.boolean().optional(),
    stageIds: z.array(z.string()).optional(),
  })
  .optional();

const updateIntegrationSchema = z.object({
  name: z.string().optional(),
  siteName: z.string().optional(),
  siteUrl: z.string().nullable().optional(),
  counterId: z.string().nullable().optional(),
  channelAccountId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  credentials: z.record(z.unknown()).optional(),
  eventRules: eventRulesSchema,
});

const createIntegrationSchema = z.object({
  provider: z.enum(ANALYTICS_PROVIDERS),
  name: z.string().optional(),
  siteName: z.string().optional(),
  siteUrl: z.string().nullable().optional(),
  counterId: z.string().nullable().optional(),
  channelAccountId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  credentials: z.record(z.unknown()).optional(),
  eventRules: eventRulesSchema,
});

const clickSchema = z.object({
  messenger: z.enum(["telegram", "whatsapp", "vk", "max", "webchat"]),
  channelAccountId: z.string().uuid().nullable().optional(),
  gaClientId: z.string().nullable().optional(),
  ymClientId: z.string().nullable().optional(),
  yandexuid: z.string().nullable().optional(),
  gclid: z.string().nullable().optional(),
  yclid: z.string().nullable().optional(),
  fbclid: z.string().nullable().optional(),
  vkclid: z.string().nullable().optional(),
  utm: z
    .object({
      source: z.string().optional(),
      medium: z.string().optional(),
      campaign: z.string().optional(),
      content: z.string().optional(),
      term: z.string().optional(),
    })
    .optional(),
  referrer: z.string().optional(),
  pageUrl: z.string().optional(),
});

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const service = new AnalyticsService();

  /**
   * Публичный эндпоинт регистрации клика по мессенджеру и генерации персонализированного deep link.
   * Вызывается виджетом онлайн-чата или кнопками перехода на сайте.
   */
  app.post("/click", async (request, reply) => {
    const payload = clickSchema.parse(request.body);

    let tenantId = (request as { tenant_id?: string }).tenant_id;
    if (!tenantId && payload.channelAccountId) {
      const channel = await queryOne<{ tenant_id: string }>(
        `SELECT tenant_id FROM channel_accounts WHERE id = $1 AND deleted_at IS NULL`,
        [payload.channelAccountId],
      );
      if (channel) {
        tenantId = channel.tenant_id;
      }
    }

    if (!tenantId) {
      throw new ValidationError("Не указан tenantId или валидный channelAccountId");
    }

    const result = await attributionEngineService.registerClick(tenantId, payload);
    return reply.status(201).send({ data: result });
  });

  // Остальные маршруты требуют авторизации
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
   * Создание нового счётчика / сайта
   */
  app.post("/integrations", async (request, reply) => {
    const tenantId = request.tenant_id;
    const payload = createIntegrationSchema.parse(request.body);
    const data = await analyticsIntegrationsService.createIntegration(tenantId, payload);
    return reply.status(201).send({ data });
  });

  /**
   * Получение настроек интеграции конкретного провайдера (обратная совместимость)
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
   * Обновление интеграции по ID или имени провайдера (PUT / PATCH)
   */
  const handleUpdate = async (request: { tenant_id: string; params: unknown; body: unknown }, reply: { send: (data: unknown) => unknown }) => {
    const tenantId = request.tenant_id;
    const { id } = request.params as { id: string };
    const payload = updateIntegrationSchema.parse(request.body);

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      const data = await analyticsIntegrationsService.updateIntegrationById(tenantId, id, payload);
      return reply.send({ data });
    }

    const providerResult = providerParamSchema.safeParse({ provider: id });
    if (providerResult.success) {
      const data = await analyticsIntegrationsService.saveIntegration(tenantId, providerResult.data.provider, payload);
      return reply.send({ data });
    }

    throw new ValidationError("Параметр должен быть валидным UUID интеграции или именем провайдера");
  };

  app.patch("/integrations/:id", handleUpdate);
  app.put("/integrations/:id", handleUpdate);
  app.put("/integrations/by-id/:id", handleUpdate);

  /**
   * Удаление интеграции по ID
   */
  const handleDelete = async (request: { tenant_id: string; params: unknown }, reply: { status: (code: number) => { send: () => unknown } }) => {
    const tenantId = request.tenant_id;
    const { id } = idParamSchema.parse(request.params);
    const deleted = await analyticsIntegrationsService.deleteIntegration(tenantId, id);
    if (!deleted) {
      throw new NotFoundError("Интеграция не найдена");
    }
    return reply.status(204).send();
  };

  app.delete("/integrations/:id", handleDelete);
  app.delete("/integrations/by-id/:id", handleDelete);

  /**
   * Прямая синхронная тестовая отправка события в систему аналитики
   * Поддерживает :id (UUID конкретного счётчика) или :provider (имя провайдера)
   */
  app.post("/integrations/:id/test", async (request, reply) => {
    const tenantId = request.tenant_id;
    const { id } = request.params as { id: string };

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      const result = await analyticsIntegrationsService.testIntegrationById(tenantId, id);
      return reply.send({ data: result });
    }

    const providerResult = providerParamSchema.safeParse({ provider: id });
    if (providerResult.success) {
      const result = await analyticsIntegrationsService.testIntegration(tenantId, providerResult.data.provider);
      return reply.send({ data: result });
    }

    throw new ValidationError("Параметр должен быть валидным UUID интеграции или именем провайдера");
  });

  /**
   * Постановка тестовой задачи в фоновую очередь BullMQ для проверки настроек
   */
  app.post("/integrations/:provider/test-queue", async (request, reply) => {
    const tenantId = request.tenant_id;
    const { provider } = providerParamSchema.parse(request.params);
    const result = await analyticsIntegrationsService.testIntegrationInQueue(tenantId, provider);
    return reply.status(202).send({ data: result });
  });

  /**
   * Получение статуса выполнения тестовой задачи из очереди BullMQ
   */
  app.get("/integrations/:provider/test-queue/:jobId", async (request, reply) => {
    const tenantId = request.tenant_id;
    const { jobId } = testQueueParamsSchema.parse(request.params);
    const result = await analyticsIntegrationsService.getTestJobStatus(tenantId, jobId);
    if (!result) {
      return reply.send({ data: { jobId, status: "pending", message: "Задача обрабатывается воркером" } });
    }
    return reply.send({ data: result });
  });
};
