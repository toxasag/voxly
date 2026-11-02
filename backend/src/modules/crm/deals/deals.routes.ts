import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DealsService } from "./deals.service.js";
import { DealMessagingService } from "./deal-messaging.service.js";
import { mediaEnrichmentService } from "../media/media-enrichment.service.js";
import {
  createDealMessageSchema,
  createDealSchema,
  createStageSchema,
  moveDealStageSchema,
  updateDealSchema,
  updateStageSchema,
} from "./deals.types.js";
import { NotFoundError } from "../../../plugins/errorHandler.js";
import { ensureTenantDefaults } from "../../tenant/tenant-defaults.js";

const listQuerySchema = z.object({
  pipeline_id: z.string().uuid().optional(),
  stage_id: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  /** Фильтры для секций «Сделки» на карточках контакта и компании. */
  contact_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const kanbanQuerySchema = z.object({
  pipeline_id: z.string().uuid("pipeline_id is required"),
});

const idParamsSchema = z.object({ id: z.string().uuid("id must be a UUID") });

const pipelineParamsSchema = z.object({
  pipelineId: z.string().uuid("pipelineId must be a UUID"),
});

const stageParamsSchema = z.object({
  pipelineId: z.string().uuid("pipelineId must be a UUID"),
  stageId: z.string().uuid("stageId must be a UUID"),
});

export async function dealsRoutes(app: FastifyInstance): Promise<void> {
  const service = new DealsService();
  const messaging = new DealMessagingService(service, app.log);

  const canRead = app.requirePermission("deals:read");
  const canWrite = app.requirePermission("deals:write");

  // GET /deals — paginated list
  app.get("", { onRequest: canRead }, async (request, reply) => {
    const { pipeline_id, stage_id, search, contact_id, company_id, limit, offset } =
      listQuerySchema.parse(request.query);

    const { items, total } = await service.list(request.tenant_id, {
      pipelineId: pipeline_id,
      stageId: stage_id,
      search,
      contactId: contact_id,
      companyId: company_id,
      limit,
      offset,
    });

    return reply.send({ data: items, meta: { limit, offset, total } });
  });

  // GET /deals/pipelines — tenant-scoped catalog for selecting a Kanban board.
  // Must be registered before /:id or Fastify would parse "pipelines" as an id.
  // Auto-seeds the default pipeline on first read so a brand-new tenant gets a
  // usable board without a manual provisioning step.
  app.get("/pipelines", { onRequest: canRead }, async (request, reply) => {
    let pipelines = await service.listPipelines(request.tenant_id);

    if (pipelines.length === 0) {
      await ensureTenantDefaults(request.tenant_id);
      pipelines = await service.listPipelines(request.tenant_id);
    }

    return reply.send({ data: pipelines, meta: { total: pipelines.length } });
  });

  // GET /deals/kanban — board projection, all stages of a pipeline
  app.get("/kanban", { onRequest: canRead }, async (request, reply) => {
    const { pipeline_id } = kanbanQuerySchema.parse(request.query);
    const columns = await service.kanban(request.tenant_id, pipeline_id);

    return reply.send({
      data: columns,
      meta: {
        pipelineId: pipeline_id,
        stageCount: columns.length,
        dealCount: columns.reduce((sum, column) => sum + column.dealCount, 0),
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Stages — визуальный редактор воронки (кнопка «Настроить» на канбане).
  // Зарегистрированы до /:id, иначе Fastify принял бы "pipelines" за id сделки.
  // ---------------------------------------------------------------------------

  app.post("/pipelines/:pipelineId/stages", { onRequest: canWrite }, async (request, reply) => {
    const { pipelineId } = pipelineParamsSchema.parse(request.params);
    const body = createStageSchema.parse(request.body);

    const column = await service.createStage(request.tenant_id, pipelineId, body);

    return reply.status(201).send({ data: column });
  });

  app.patch("/pipelines/:pipelineId/stages/:stageId", { onRequest: canWrite }, async (request, reply) => {
    const { pipelineId, stageId } = stageParamsSchema.parse(request.params);
    const body = updateStageSchema.parse(request.body);

    const column = await service.updateStage(request.tenant_id, pipelineId, stageId, body);

    if (column === null) throw new NotFoundError("Stage not found");

    return reply.send({ data: column });
  });

  app.delete("/pipelines/:pipelineId/stages/:stageId", { onRequest: canWrite }, async (request, reply) => {
    const { pipelineId, stageId } = stageParamsSchema.parse(request.params);

    const deleted = await service.deleteStage(request.tenant_id, pipelineId, stageId);

    if (!deleted) throw new NotFoundError("Stage not found");

    return reply.status(204).send();
  });

  app.get("/:id", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const deal = await service.get(request.tenant_id, id);

    if (deal === null) throw new NotFoundError("Deal not found");

    return reply.send({ data: deal });
  });

  app.post("", { onRequest: canWrite }, async (request, reply) => {
    const body = createDealSchema.parse(request.body);
    const deal = await service.create(request.tenant_id, request.authUser.id, body);

    return reply.status(201).send({ data: deal });
  });

  app.patch("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateDealSchema.parse(request.body);
    const deal = await service.update(request.tenant_id, id, body);

    if (deal === null) throw new NotFoundError("Deal not found");

    return reply.send({ data: deal });
  });

  // PATCH /deals/:id/stage — kanban drag-and-drop target
  app.patch("/:id/stage", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { stage_id, target_index } = moveDealStageSchema.parse(request.body);

    const deal = await service.moveStage(
      request.tenant_id,
      id,
      stage_id,
      request.authUser.id,
      target_index,
    );

    if (deal === null) throw new NotFoundError("Deal not found");

    return reply.send({ data: deal });
  });

  app.delete("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const deleted = await service.softDelete(request.tenant_id, id);

    if (!deleted) throw new NotFoundError("Deal not found");

    return reply.status(204).send();
  });

  app.post("/:id/mark-personal", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const result = await service.markPersonal(request.tenant_id, id, request.authUser.id);
    return reply.send({ data: result });
  });

  app.post("/:id/unmark-personal", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const result = await service.unmarkPersonal(request.tenant_id, id, request.authUser.id);
    return reply.send({ data: result });
  });

  // ---------------------------------------------------------------------------
  // Timeline (M1.6.6)
  // ---------------------------------------------------------------------------

  app.get("/:id/messages", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const messages = await service.listMessages(request.tenant_id, id);

    return reply.send({ data: messages, meta: { total: messages.length } });
  });

  // Алиас для клиентов и фронтенд-чата: таймлайн сообщений сделки
  app.get("/:id/timeline", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const messages = await service.listMessages(request.tenant_id, id);

    return reply.send({ data: messages, meta: { total: messages.length } });
  });

  // Пакетное обогащение всех медиа-вложений в переписке сделки
  app.post("/:id/enrich-media", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const count = await mediaEnrichmentService.batchEnrichDealMessages(request.tenant_id, id);
    const messages = await service.listMessages(request.tenant_id, id);
    return reply.send({ data: { enrichedCount: count, messages } });
  });

  // Обогащение конкретного сообщения в сделке
  app.post("/:id/messages/:messageId/enrich", { onRequest: canWrite }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const updated = await mediaEnrichmentService.enrichMessageMedia(request.tenant_id, messageId);
    return reply.send({ data: updated });
  });

  // Транскрибация аудиосообщения в сделке
  app.post("/:id/messages/:messageId/transcribe", { onRequest: canWrite }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const transcript = await mediaEnrichmentService.transcribeAudioMessage(request.tenant_id, messageId);
    return reply.send({ data: transcript });
  });

  // GET /deals/:id/contact-history — сквозная история контакта и LTV для карточки сделки
  app.get("/:id/contact-history", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const history = await service.getContactHistory(request.tenant_id, id);

    return reply.send({ data: history });
  });

  /**
   * Ответ менеджера: запись в таймлайн **и** отправка в канал клиента.
   *
   * Отказ доставки не превращается в 5xx: сообщение записано, и ответ 201 со
   * `deliveryStatus: "failed"` честнее ошибки, после которой фронт не знает,
   * сохранён ли текст. Причина видна в таймлайне у самой строки.
   */
  app.post("/:id/messages", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = createDealMessageSchema.parse(request.body);

    const message = await messaging.sendManagerMessage({
      tenantId: request.tenant_id,
      dealId: id,
      senderName: request.authUser.name,
      payload: body,
    });

    return reply.status(201).send({ data: message });
  });

  /**
   * Список доступных аккаунтов («Пишем от:») для отправки первого или очередного сообщения.
   */
  app.get("/:id/send-from-options", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const options = await messaging.getSendFromOptions(request.tenant_id, id);
    return reply.send({ data: options, meta: { total: options.length } });
  });

  /**
   * Статус автопилота AI для сделки.
   */
  app.get("/:id/ai-status", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const status = await messaging.getAiStatus(request.tenant_id, id);
    return reply.send({ data: status });
  });

  const aiControlSchema = z.object({
    action: z.enum(["enable", "pause", "disable"]),
  });

  /**
   * Управление режимом автопилота AI (включение, пауза на 1 час, выключение).
   */
  app.post("/:id/ai-control", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { action } = aiControlSchema.parse(request.body);
    const status = await messaging.setAiControl(request.tenant_id, id, action);
    return reply.send({ data: status });
  });

  /**
   * AI Copilot: генерация черновика ответа оператора по контексту диалога и базе знаний.
   */
  app.post("/:id/ai-draft", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const draft = await messaging.generateAiDraft(request.tenant_id, id);
    return reply.send({ data: draft });
  });

  /**
   * Синхронизация предшествующей переписки из подключенных каналов (MAX, Telegram).
   */
  app.post("/:id/sync-chat-history", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const result = await messaging.syncDealChatHistory(request.tenant_id, id);
    return reply.send({ data: result });
  });
}
