import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { AppError } from "../../plugins/errorHandler.js";
import { AiService } from "./ai.service.js";
import { KnowledgeBaseService } from "./knowledge.service.js";
import {
  createAgentSchema,
  topupBalanceSchema,
  updateAgentSchema,
} from "./ai.types.js";
import { AI_MODEL_CATALOG } from "./ai-pricing.js";
import {
  extensionOf,
  extractText,
  isSupportedExtension,
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_EXTENSIONS,
  UnsupportedDocumentError,
} from "./knowledge-text.js";

// ---------------------------------------------------------------------------
// AI-агенты и баланс ИИ, смонтировано в app.ts под /api/v1/ai.
//
// Права: чтение агентов — `ai_bots:read`, изменение — `ai_bots:configure`.
// Баланс ИИ живёт здесь же, но требует `billing:manage`: это денежная операция,
// и настройка ботов не должна давать право пополнять счёт.
//
// Гейт модуля `ai_bots` применяется к агентам, но НЕ к балансу: баланс виден в
// биллинге и при отключённом модуле — иначе арендатор не смог бы увидеть, за что
// с него списали.
// ---------------------------------------------------------------------------

const agentParams = z.object({ id: z.string().uuid("id must be a UUID") });

const documentParams = z.object({
  id: z.string().uuid("id must be a UUID"),
  docId: z.string().uuid("docId must be a UUID"),
});

/**
 * Загрузка документа текстом (без файла).
 *
 * Отдельно от multipart: вставка текста из буфера обмена — основной способ
 * добавить короткий регламент, и требовать от интерфейса собирать ради этого
 * `FormData` было бы лишним.
 */
const knowledgeTextSchema = z.object({
  title: z.string().trim().min(1, "Укажите название").max(200),
  text: z.string().trim().min(1, "Текст не может быть пустым").max(500_000),
});

/**
 * Набор привязанных аккаунтов каналов — целиком, а не по одному.
 *
 * Интерфейс отправляет итоговый список отмеченных чекбоксов; инкрементальные
 * операции требовали бы от него вычислять разницу, что расходится при
 * параллельном редактировании.
 */
const channelBindingsSchema = z.object({
  channel_account_ids: z.array(z.string().uuid()).max(50),
});

export default async function aiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new AiService();
  const knowledge = new KnowledgeBaseService();

  const readAgents = [app.requirePermission("ai_bots:read"), app.requireModule("ai_bots")];
  const writeAgents = [app.requirePermission("ai_bots:configure"), app.requireModule("ai_bots")];

  // Каталог моделей с ценами. Отдаётся сервером, потому что цена — основание для
  // списания: держать её копию на клиенте означало бы риск расхождения.
  app.get("/models", { onRequest: [app.requirePermission("ai_bots:read")] }, async (_request, reply) => {
    return reply.send({
      data: Object.values(AI_MODEL_CATALOG).map((model) => ({
        id: model.id,
        label: model.label,
        provider: model.provider,
        contextWindow: model.contextWindow,
        costInPer1k: model.costInPer1k,
        costOutPer1k: model.costOutPer1k,
      })),
    });
  });

  app.get("/agents", { onRequest: readAgents }, async (request, reply) => {
    const items = await service.listAgents(request.tenant_id);
    return reply.send({ data: items, meta: { total: items.length } });
  });

  app.get("/agents/:id", { onRequest: readAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    return reply.send({ data: await service.getAgent(request.tenant_id, id) });
  });

  app.post("/agents", { onRequest: writeAgents }, async (request, reply) => {
    const body = createAgentSchema.parse(request.body);
    const agent = await service.createAgent(request.tenant_id, body);
    return reply.status(201).send({ data: agent });
  });

  app.patch("/agents/:id", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const body = updateAgentSchema.parse(request.body);
    return reply.send({ data: await service.updateAgent(request.tenant_id, id, body) });
  });

  app.delete("/agents/:id", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    await service.deleteAgent(request.tenant_id, id);
    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // База знаний агента (RAG)
  //
  // Права те же, что у самого агента: база знаний определяет его ответы, поэтому
  // право на её изменение равно праву на настройку агента.
  // -------------------------------------------------------------------------

  app.get("/agents/:id/knowledge", { onRequest: readAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const items = await knowledge.listDocuments(request.tenant_id, id);

    return reply.send({
      data: items,
      meta: {
        total: items.length,
        // Интерфейс показывает предупреждение до попытки загрузки: иначе
        // пользователь узнавал бы о неготовности платформы только по ошибке.
        vectorisationAvailable: knowledge.isVectorisationAvailable,
        supportedExtensions: SUPPORTED_EXTENSIONS,
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      },
    });
  });

  /**
   * Загрузка документа: текстом или файлом.
   *
   * Один маршрут на оба способа, различаемых по `Content-Type`: с точки зрения
   * пользователя это одно действие «добавить документ», и второй путь означал бы
   * дублирование проверок агента, лимитов и статусов.
   */
  app.post("/agents/:id/knowledge", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);

    if (request.isMultipart()) {
      const file = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });

      if (file === undefined) {
        throw new AppError(400, "VALIDATION_ERROR", "Файл не передан", {
          file: ["Выберите файл"],
        });
      }

      const extension = extensionOf(file.filename);
      if (!isSupportedExtension(extension)) throw new UnsupportedDocumentError(file.filename);

      const buffer = await file.toBuffer();

      // `truncated` выставляется, когда файл упёрся в лимит: без проверки в базу
      // попал бы обрезанный документ, выглядящий как успешно загруженный.
      if (file.file.truncated) {
        throw new AppError(
          413,
          "FILE_TOO_LARGE",
          `Файл больше ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} МБ`,
          { file: [`Максимальный размер — ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} МБ`] },
        );
      }

      const text = await extractText({ filename: file.filename, extension, buffer });

      const document = await knowledge.addDocument({
        tenantId: request.tenant_id,
        agentId: id,
        filename: file.filename,
        mimeType: file.mimetype,
        text,
      });

      return reply.status(201).send({ data: document });
    }

    const body = knowledgeTextSchema.parse(request.body);

    const document = await knowledge.addDocument({
      tenantId: request.tenant_id,
      agentId: id,
      filename: body.title,
      mimeType: "text/plain",
      text: body.text,
    });

    return reply.status(201).send({ data: document });
  });

  app.delete("/agents/:id/knowledge/:docId", { onRequest: writeAgents }, async (request, reply) => {
    const { id, docId } = documentParams.parse(request.params);
    await knowledge.deleteDocument(request.tenant_id, id, docId);
    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // Привязка агента к аккаунтам каналов
  // -------------------------------------------------------------------------

  app.get("/agents/:id/channels", { onRequest: readAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const items = await knowledge.listChannelBindings(request.tenant_id, id);
    return reply.send({ data: items, meta: { total: items.length } });
  });

  app.put("/agents/:id/channels", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const body = channelBindingsSchema.parse(request.body);

    await knowledge.replaceChannelBindings({
      tenantId: request.tenant_id,
      agentId: id,
      channelAccountIds: body.channel_account_ids,
    });

    const items = await knowledge.listChannelBindings(request.tenant_id, id);
    return reply.send({ data: items, meta: { total: items.length } });
  });

  // -------------------------------------------------------------------------
  // Баланс ИИ
  // -------------------------------------------------------------------------

  app.get("/balance", { onRequest: [app.requirePermission("billing:manage")] }, async (request, reply) => {
    return reply.send({ data: await service.getBalance(request.tenant_id) });
  });

  // Ручное начисление не является оплатой: доступно только владельцу платформы.
  app.post("/balance/topup", { onRequest: [app.requirePermission("billing:manage"), app.requirePlatformOwner()] }, async (request, reply) => {
    const body = topupBalanceSchema.parse(request.body);

    const balance = await service.topupBalance({
      tenantId: request.tenant_id,
      actorId: request.authUser.id,
      amountRubles: body.amount_rubles,
    });

    return reply.send({ data: balance });
  });
}
