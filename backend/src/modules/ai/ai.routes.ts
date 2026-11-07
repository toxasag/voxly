import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { query, queryOne } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { AiService } from "./ai.service.js";
import { KnowledgeBaseService } from "./knowledge.service.js";
import { BillingService } from "../finance/billing/billing.service.js";
import { PRODUCT_CODES } from "../finance/billing/billing.types.js";
import { platformConfigService } from "../admin/platform-config.service.js";
import {
  createAgentSchema,
  createDialogueFeedbackSchema,
  generatePromptSchema,
  syncKnowledgeMdSchema,
  topupBalanceSchema,
  updateAgentSchema,
} from "./ai.types.js";
import { AI_MODEL_CATALOG } from "./ai-pricing.js";
import { crawlMapReviews } from "./map-reviews-crawler.js";
import { knowledgeBaseQueue, isNewUrl } from "./knowledge-base.queue.js";
import { knowledgeSynthesizerService } from "./knowledge-synthesizer.service.js";
import {
  extensionOf,
  extractText,
  isSupportedExtension,
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_EXTENSIONS,
  UnsupportedDocumentError,
} from "./knowledge-text.js";
import { queueManager } from "../../infrastructure/queue.js";
import { AgentPipelineService } from "./agent-pipeline.service.js";
import { webExtractorService } from "./web-extractor.service.js";

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

const feedbackParams = z.object({
  id: z.string().uuid("id must be a UUID"),
  feedbackId: z.string().uuid("feedbackId must be a UUID"),
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
  category: z.string().trim().optional(),
});

/**
 * Импорт веб-страницы или справочника по URL.
 */
const knowledgeUrlSchema = z.object({
  url: z.string().url("Укажите корректный URL (http:// или https://)"),
  title: z.string().trim().max(120).optional(),
  as_draft: z.boolean().optional(),
  asDraft: z.boolean().optional(),
});

const createDraftSchema = z.object({
  title: z.string().trim().min(1, "Укажите название").max(200),
  text: z.string().trim().min(1, "Текст не может быть пустым").max(500_000),
  category: z.string().trim().optional(),
  source_url: z.string().trim().optional(),
  sourceUrl: z.string().trim().optional(),
});

const approveDraftSchema = z.object({
  text: z.string().trim().optional(),
  filename: z.string().trim().optional(),
  category: z.string().trim().optional(),
});

/**
 * Сканирование всех страниц сайта (Краулер).
 */
const crawlSiteSchema = z.object({
  url: z.string().url("Укажите корректный URL (http:// или https://)"),
  maxPages: z.number().int().min(1).max(50).default(25).optional(),
});

/**
 * Импорт отзывов и профиля организации с карт (Яндекс Карты, 2ГИС, Google Maps, Zoon).
 */
const mapReviewsSchema = z.object({
  url: z.string().url("Укажите корректный URL на Яндекс Карты, 2ГИС, Google Maps, Zoon или Flamp"),
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

const whatsappImportSchema = z.object({
  text: z.string().min(10, "Переписка должна содержать текст").max(1_000_000, "Превышен максимальный объём текста (1 МБ)"),
  filename: z.string().optional(),
});

const updateDocumentSchema = z.object({
  text: z.string().min(1, "Текст документа не может быть пустым"),
  filename: z.string().optional(),
});

const testChatSchema = z.object({
  message: z.string().trim().min(1, "Сообщение не может быть пустым").max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .optional(),
});

export default async function aiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new AiService();
  const knowledge = new KnowledgeBaseService();
  const pipeline = new AgentPipelineService(app.log);

  const readAgents = [app.requirePermission("ai_bots:read"), app.requireModule("ai_bots")];
  const writeAgents = [app.requirePermission("ai_bots:configure"), app.requireModule("ai_bots")];

  // Каталог моделей с ценами и информацией о реальных провайдерах платформы.
  app.get("/models", { onRequest: [app.requirePermission("ai_bots:read")] }, async (_request, reply) => {
    let activeProvider: {
      name: string;
      providerType: string;
      chatModel?: string;
      isConfigured: boolean;
    } | null = null;

    let dynamicModels: Array<{
      id: string;
      label: string;
      provider: string;
      contextWindow: number;
      costInPer1k: number;
      costOutPer1k: number;
      isConfigured: boolean;
    }> = [];

    let isProviderConfigured = (_provider: string) => false;

    try {
      const effective = await platformConfigService.getEffectiveIntegrations();
      const activeProviders = effective.llmProviders.filter(
        (p) => p.isActive && p.apiKeys.length > 0 && Boolean(p.baseUrl),
      );

      isProviderConfigured = (targetProvider: string) => {
        const lower = targetProvider.toLowerCase();
        return activeProviders.some((p) => {
          const pType = p.providerType.toLowerCase();
          const pName = p.name.toLowerCase();
          if (pType === lower) return true;
          if (lower === "google" && (pType === "gemini" || pName.includes("gemini") || pName.includes("google"))) return true;
          if (lower === "openai" && (pType === "openai" || pName.includes("openai"))) return true;
          if (lower === "anthropic" && (pType === "anthropic" || pName.includes("claude") || pName.includes("anthropic"))) return true;
          if (lower === "deepseek" && (pType === "deepseek" || pName.includes("deepseek"))) return true;
          return false;
        });
      };

      const activeItem = activeProviders.find((p) => p.isDefault) || activeProviders[0];
      if (activeItem) {
        activeProvider = {
          name: activeItem.name,
          providerType: activeItem.providerType,
          chatModel: activeItem.chatModel,
          isConfigured: true,
        };
      } else if (effective.llm.isConfigured) {
        activeProvider = {
          name: "Основной провайдер",
          providerType: "custom",
          chatModel: effective.llm.chatModel || undefined,
          isConfigured: true,
        };
      }
    } catch (err) {
      _request.log.warn({ err }, "Не удалось прочитать конфигурацию интеграций для каталога моделей");
    }

    // Запрашиваем РЕАЛЬНО доступные чат-модели у активного провайдера отдельным изолированным вызовом
    if (activeProvider && activeProvider.isConfigured) {
      try {
        const available = await platformConfigService.fetchAvailableModels();
        if (available.success && available.models.length > 0) {
          const chatOnly = available.models.filter((m) => {
            if (m.type !== "chat") return false;
            const id = m.id.toLowerCase();
            if (id.includes("tts") || id.includes("audio") || id.includes("transcribe")) return false;
            if (id.includes("banana") || id.includes("robotics") || id.includes("lyria") || id.includes("clip")) return false;
            if (id === "aqa") return false;
            return true;
          });

          dynamicModels = chatOnly.map((m) => ({
            id: m.id,
            label: m.name,
            provider: activeProvider?.providerType || "google",
            contextWindow: 128_000,
            costInPer1k: 5,
            costOutPer1k: 15,
            isConfigured: true,
          }));
        }
      } catch (err) {
        _request.log.warn({ err }, "Не удалось запросить динамический список моделей от внешнего API");
      }
    }

    // Если у активного провайдера задана chatModel, гарантируем её присутствие на первом месте
    if (activeProvider?.chatModel) {
      const idx = dynamicModels.findIndex((m) => m.id === activeProvider?.chatModel);
      if (idx > -1) {
        const [target] = dynamicModels.splice(idx, 1);
        if (target) dynamicModels.unshift(target);
      } else {
        dynamicModels.unshift({
          id: activeProvider.chatModel,
          label: activeProvider.chatModel,
          provider: activeProvider.providerType || "google",
          contextWindow: 128_000,
          costInPer1k: 5,
          costOutPer1k: 15,
          isConfigured: true,
        });
      }
    }

    // Формируем список моделей каталога с честным статусом подключения
    const catalogWithRealStatus = Object.values(AI_MODEL_CATALOG).map((model) => {
      const isConfig =
        isProviderConfigured(model.provider) ||
        (Boolean(activeProvider?.isConfigured) &&
          (model.provider === "google" || model.provider === activeProvider?.providerType));

      return {
        id: model.id,
        label: model.label,
        provider: model.provider,
        contextWindow: model.contextWindow,
        costInPer1k: model.costInPer1k,
        costOutPer1k: model.costOutPer1k,
        isConfigured: isConfig,
      };
    });

    // Если провайдер вернул реальные модели, используем их; иначе базовый каталог с честными статусами
    const finalModels = dynamicModels.length > 0 ? dynamicModels : catalogWithRealStatus;

    const defaultProvider = activeProvider ?? {
      name: "Провайдер платформы",
      providerType: "unknown",
      isConfigured: false,
    };

    return reply.send({
      data: {
        activeProvider: defaultProvider,
        data: finalModels,
      },
      activeProvider: defaultProvider,
      dataList: finalModels,
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

    // Если при создании передан URL сайта, асинхронно ставим задачу сканирования в BullMQ очередь kb
    const websiteUrl = (body.website_url || body.websiteUrl)?.trim();
    if (websiteUrl) {
      try {
        await knowledgeBaseQueue.add("crawl-website", {
          tenantId: request.tenant_id,
          botId: agent.id,
          url: websiteUrl,
          source: "agent_settings_auto",
        });
      } catch (err) {
        request.log.warn({ err }, "[KnowledgeBaseQueue] Не удалось поставить в очередь сканирование сайта при создании агента");
      }
    }

    // Если при создании передан URL на отзывы/карты, извлекаем рейтинг и отзывы
    if (body.map_reviews_url && body.map_reviews_url.trim()) {
      try {
        const reviewsResult = await crawlMapReviews(body.map_reviews_url.trim());
        await knowledge.addDocument({
          tenantId: request.tenant_id,
          agentId: agent.id,
          filename: `Отзывы (${reviewsResult.platform}): ${reviewsResult.orgName.slice(0, 50)}`,
          mimeType: "text/markdown",
          text: reviewsResult.markdownContent,
        });
      } catch (err) {
        request.log.warn({ err }, "Не удалось автоматически загрузить отзывы при создании агента");
      }
    }

    // Если включен автосбор опыта из CRM (сделки и переписки)
    if (body.sync_crm === true) {
      void knowledgeSynthesizerService.synthesizeFromCrm(request.tenant_id, agent.id).catch((err) => {
        request.log.warn({ err }, "Не удалось автоматически синтезировать опыт из CRM");
      });
    }

    // Если передана выгрузка переписки WhatsApp
    if (body.whatsapp_chat_text && body.whatsapp_chat_text.trim().length > 20) {
      void knowledgeSynthesizerService
        .synthesizeFromWhatsApp(
          request.tenant_id,
          agent.id,
          body.whatsapp_chat_text.trim(),
          "WhatsApp-чат.txt",
        )
        .catch((err) => {
          request.log.warn({ err }, "Не удалось автоматически синтезировать переписку WhatsApp");
        });
    }

    return reply.status(201).send({ data: agent });
  });

  app.patch("/agents/:id", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const body = updateAgentSchema.parse(request.body);
    const existingAgent = await service.getAgent(request.tenant_id, id);
    const agent = await service.updateAgent(request.tenant_id, id, body);

    // Если передан URL сайта и он отличается от прежнего, запускаем сканирование страниц сайта в базу знаний через очередь
    const newWebsiteUrl = (body.website_url !== undefined ? body.website_url : body.websiteUrl)?.trim();
    const oldWebsiteUrl = (existingAgent.wizardConfig as Record<string, unknown> | null)?.website_url as string | undefined;

    if (newWebsiteUrl && isNewUrl(oldWebsiteUrl, newWebsiteUrl)) {
      try {
        await knowledgeBaseQueue.add("crawl-website", {
          tenantId: request.tenant_id,
          botId: agent.id,
          url: newWebsiteUrl,
          source: "agent_settings_auto",
        });
      } catch (err) {
        request.log.warn({ err }, "[KnowledgeBaseQueue] Не удалось поставить в очередь сканирование сайта при обновлении агента");
      }
    }

    // Если передан URL на отзывы/карты, извлекаем рейтинг и отзывы
    if (body.map_reviews_url && body.map_reviews_url.trim()) {
      void (async () => {
        try {
          const reviewsResult = await crawlMapReviews(body.map_reviews_url!.trim());
          await knowledge.addDocument({
            tenantId: request.tenant_id,
            agentId: agent.id,
            filename: `Отзывы (${reviewsResult.platform}): ${reviewsResult.orgName.slice(0, 50)}`,
            mimeType: "text/markdown",
            text: reviewsResult.markdownContent,
          });
        } catch (err) {
          request.log.warn({ err }, "Не удалось автоматически загрузить отзывы при обновлении агента");
        }
      })();
    }

    // Если включен автосбор опыта из CRM (сделки и переписки)
    if (body.sync_crm === true) {
      void knowledgeSynthesizerService.synthesizeFromCrm(request.tenant_id, agent.id).catch((err) => {
        request.log.warn({ err }, "Не удалось автоматически синтезировать опыт из CRM");
      });
    }

    // Если передана выгрузка переписки WhatsApp
    if (body.whatsapp_chat_text && body.whatsapp_chat_text.trim().length > 20) {
      void knowledgeSynthesizerService
        .synthesizeFromWhatsApp(
          request.tenant_id,
          agent.id,
          body.whatsapp_chat_text.trim(),
          "WhatsApp-чат.txt",
        )
        .catch((err) => {
          request.log.warn({ err }, "Не удалось автоматически синтезировать переписку WhatsApp");
        });
    }

    return reply.send({ data: agent });
  });

  app.post("/agents/:id/test-chat", { onRequest: readAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const body = testChatSchema.parse(request.body);

    const result = await pipeline.generateTestReply({
      tenantId: request.tenant_id,
      agentId: id,
      message: body.message,
      history: body.history,
    });

    return reply.send({ data: result });
  });

  // -------------------------------------------------------------------------
  // Генеративный синтез системного промпта из контекста и URL целевой страницы
  // -------------------------------------------------------------------------

  app.post("/generate-prompt", async (request, reply) => {
    let tenantId: string | undefined = request.tenant_id;
    if (!tenantId) {
      let token: string | undefined;
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length);
      } else if (request.headers.cookie) {
        const cookieMatch = request.headers.cookie.match(/(?:^|;\s*)(?:getvoxly_auth_token|access_token)=([^;]+)/);
        if (cookieMatch && cookieMatch[1]) token = decodeURIComponent(cookieMatch[1]);
      }
      if (token) {
        try {
          const payload = app.jwt.verify(token) as { tenant_id?: string };
          if (payload?.tenant_id) {
            tenantId = payload.tenant_id;
          }
        } catch {
          // Опциональный токен
        }
      }
    }
    const body = generatePromptSchema.parse(request.body ?? {});
    const result = await service.generatePrompt(body, tenantId);
    return reply.send({ data: result, ...result });
  });

  // -------------------------------------------------------------------------
  // Синхронизация активной Markdown базы знаний агента
  // -------------------------------------------------------------------------

  app.post("/agents/:id/knowledge-sync", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const body = syncKnowledgeMdSchema.parse(request.body ?? {});
    const md = body.knowledge_base_md ?? body.knowledgeBaseMd ?? "";
    const agent = await service.syncKnowledgeBaseMd(request.tenant_id, id, md);
    return reply.send({ data: agent });
  });

  // -------------------------------------------------------------------------
  // Обратная связь по диалогам и петля обучения (Dialogue Feedback Loop)
  // -------------------------------------------------------------------------

  app.post("/agents/:id/feedback", { onRequest: readAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const body = createDialogueFeedbackSchema.parse(request.body);
    const feedback = await service.createFeedback(request.tenant_id, id, body);
    return reply.status(201).send({ data: feedback });
  });

  app.get("/agents/:id/feedback", { onRequest: readAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const feedbacks = await service.listFeedbacks(request.tenant_id, id);
    return reply.send({ data: feedbacks });
  });

  app.post("/agents/:id/feedback/:feedbackId/approve", { onRequest: writeAgents }, async (request, reply) => {
    const { id, feedbackId } = feedbackParams.parse(request.params);
    const result = await service.approveFeedback(request.tenant_id, id, feedbackId);
    return reply.send({ data: result });
  });

  app.post("/agents/:id/feedback/:feedbackId/reject", { onRequest: writeAgents }, async (request, reply) => {
    const { id, feedbackId } = feedbackParams.parse(request.params);
    const result = await service.rejectFeedback(request.tenant_id, id, feedbackId);
    return reply.send({ data: result });
  });

  app.delete("/agents/:id/feedback/:feedbackId", { onRequest: writeAgents }, async (request, reply) => {
    const { id, feedbackId } = feedbackParams.parse(request.params);
    const result = await service.deleteFeedback(request.tenant_id, id, feedbackId);
    return reply.send({ data: result });
  });

  app.post("/agents/:id/rebuild-prompt", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const result = await service.rebuildAgentPromptWithFeedbacks(request.tenant_id, id);
    return reply.send({ data: result });
  });

  const handlePromptPreview = async (
    request: { tenant_id: string; params: unknown; body?: unknown },
    reply: { send: (payload: unknown) => unknown },
  ) => {
    const { id } = agentParams.parse(request.params);
    const body = (request.body as { system_prompt?: string; systemPrompt?: string } | undefined) ?? {};

    const agent = await queryOne<{
      id: string;
      name: string;
      description?: string | null;
      system_prompt: string;
      company_name_override?: string | null;
      consultant_name?: string | null;
      consultant_role?: string | null;
      wizard_config: Record<string, unknown> | null;
    }>(
      `SELECT id, name, description, system_prompt, company_name_override, consultant_name, consultant_role, wizard_config
       FROM ai_agents
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [request.tenant_id, id],
    );
    if (!agent) {
      throw new NotFoundError("AI-агент не найден");
    }

    const tenantRow = await queryOne<{ name: string }>(
      `SELECT name FROM tenants WHERE id = $1`,
      [request.tenant_id],
    );
    const tenantName = tenantRow?.name || "Компания";

    const docs = await query<{
      id: string;
      filename: string;
      category: string | null;
      content_text: string | null;
    }>(
      `SELECT id, filename, category, content_text
       FROM knowledge_base_documents
       WHERE tenant_id = $1 AND (agent_id = $2 OR agent_id IS NULL) AND status = 'ready' AND content_text IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 20`,
      [request.tenant_id, id],
    );

    const reviewDocs: string[] = [];
    const websiteDocs: string[] = [];
    const kbDocs: string[] = [];

    for (const doc of docs) {
      const fn = (doc.filename || "").toLowerCase();
      const text = (doc.content_text || "").trim();
      if (!text) continue;

      if (fn.includes("отзыв") || doc.category === "reviews") {
        if (reviewDocs.length < 2) {
          reviewDocs.push(`[${reviewDocs.length + 1}] Из «${doc.filename}»:\n${text.slice(0, 1000)}`);
        }
      } else if (fn.includes("сайт") || doc.category === "website") {
        if (websiteDocs.length < 2) {
          websiteDocs.push(`[${websiteDocs.length + 1}] Из «${doc.filename}»:\n${text.slice(0, 1200)}`);
        }
      } else {
        if (kbDocs.length < 3) {
          kbDocs.push(`[${kbDocs.length + 1}] Из «${doc.filename}»:\n${text.slice(0, 1200)}`);
        }
      }
    }

    const kbContext = kbDocs.length > 0
      ? kbDocs.join("\n\n")
      : "В базе знаний пока нет добавленных документов. Вы можете загрузить регламенты или прайс на вкладке «База знаний».";

    const websiteContext = websiteDocs.length > 0
      ? websiteDocs.join("\n\n")
      : "Материалы сайта пока не загружены.";

    const reviewsContext = reviewDocs.length > 0
      ? reviewDocs.join("\n\n")
      : "Отзывы клиентов пока не подключены.";

    const crmExamples = await query<{ customer_query: string; agent_reply: string }>(
      `SELECT customer_query, agent_reply
       FROM ai_sales_examples
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 3`,
      [request.tenant_id],
    );

    let crmContext = "Успешные диалоги формируются автоматически на основе закрытых сделок CRM.";
    if (crmExamples.length > 0) {
      crmContext = crmExamples
        .map((p, i) => `Пример ${i + 1}:\nКлиент: «${p.customer_query}»\nУспешный ответ: «${p.agent_reply}»`)
        .join("\n\n");
    }

    const channelAccounts = await query<{ channel: string; label: string | null }>(
      `SELECT c.channel, c.label
       FROM ai_agent_channel_bindings b
       JOIN channel_accounts c ON c.id = b.channel_account_id
       WHERE b.agent_id = $1 AND c.tenant_id = $2
       LIMIT 1`,
      [id, request.tenant_id],
    );
    const channelType = channelAccounts[0]?.channel || "чат на сайте";

    const currentTime = new Date().toLocaleTimeString("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
    }) + " МСК";

    const wc = (agent.wizard_config || {}) as Record<string, string | undefined>;
    const effectiveCompanyName =
      (agent.company_name_override && agent.company_name_override.trim().length > 0 ? agent.company_name_override.trim() : null) ||
      (wc.company_name_override && wc.company_name_override.trim().length > 0 ? wc.company_name_override.trim() : null) ||
      (wc.companyName && wc.companyName.trim().length > 0 ? wc.companyName.trim() : null) ||
      tenantName ||
      "Компания";

    const effectiveConsultantName =
      (agent.consultant_name && agent.consultant_name.trim().length > 0 ? agent.consultant_name.trim() : null) ||
      (wc.consultantName && wc.consultantName.trim().length > 0 ? wc.consultantName.trim() : null) ||
      agent.name ||
      "Консультант";

    const effectiveConsultantRole =
      (agent.consultant_role && agent.consultant_role.trim().length > 0 ? agent.consultant_role.trim() : null) ||
      (wc.consultantRole && wc.consultantRole.trim().length > 0 ? wc.consultantRole.trim() : null) ||
      "онлайн-помощник";

    const effectiveBusinessNiche =
      (wc.businessNiche && wc.businessNiche.trim().length > 0 ? wc.businessNiche.trim() : null) ||
      (agent.description && agent.description.trim().length > 5 ? agent.description.trim() : null) ||
      "оказание профильных услуг и консультация клиентов";

    const effectiveClientProfile =
      (wc.clientProfile && wc.clientProfile.trim().length > 0 ? wc.clientProfile.trim() : null) ||
      (wc.client_profile && String(wc.client_profile).trim().length > 0 ? String(wc.client_profile).trim() : null) ||
      "клиенты, которым требуется экспертная консультация и решение их задачи";

    const effectiveTargetAction =
      (wc.targetAction && wc.targetAction.trim().length > 0 ? wc.targetAction.trim() : null) ||
      "согласование деталей заказа и обмен контактами";

    const effectiveConstraints =
      (wc.constraints && wc.constraints.trim().length > 0 ? wc.constraints.trim() : null) ||
      "Не давать ложных обещаний, строго следовать закону и регламенту компании.";

    const effectiveHandoffSpecialist =
      (wc.handoffSpecialist && wc.handoffSpecialist.trim().length > 0 ? wc.handoffSpecialist.trim() : null) ||
      "старший специалист профильного отдела";

    const variables: Record<string, string> = {
      "tenant.name": effectiveCompanyName,
      "company.name": effectiveCompanyName,
      "consultant.name": effectiveConsultantName,
      "consultant.role": effectiveConsultantRole,
      "business.niche": effectiveBusinessNiche,
      "client.profile": effectiveClientProfile,
      "target.action": effectiveTargetAction,
      "constraints": effectiveConstraints,
      "handoff.specialist": effectiveHandoffSpecialist,
      "current_time": currentTime,
      "channel_type": channelType,
      "knowledge_base_context": kbContext,
      "website_context": websiteContext,
      "reviews_and_reputation": reviewsContext,
      "successful_crm_patterns": crmContext,
    };

    const template = (typeof body.system_prompt === "string" && body.system_prompt.trim().length > 0)
      ? body.system_prompt
      : ((typeof body.systemPrompt === "string" && body.systemPrompt.trim().length > 0)
        ? body.systemPrompt
        : agent.system_prompt);

    let resolved = template.replace(/\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g, (_match, token: string) => {
      return variables[token] ?? "";
    });

    resolved = resolved
      .replace(/<\/?(?:director_system_prompt|character_and_identity|context_and_knowledge|style_and_formatting|dialogue_management|golden_cage_rules_and_security|primary_objective|scene_rehearsals)>/gi, "")
      .replace(/^\s*<[/]?[a-zA-Z0-9_]+>\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return reply.send({
      data: {
        resolvedPrompt: resolved,
        variables,
      },
    });
  };

  app.get("/agents/:id/prompt-preview", { onRequest: readAgents }, handlePromptPreview);
  app.post("/agents/:id/prompt-preview", { onRequest: readAgents }, handlePromptPreview);

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

      let category = "general";
      if (file.fields && typeof file.fields === "object") {
        const catField = (file.fields as Record<string, { value?: unknown }>).category;
        if (typeof catField?.value === "string" && catField.value.trim()) {
          category = catField.value.trim();
        }
      }

      const document = await knowledge.addDocument({
        tenantId: request.tenant_id,
        agentId: id,
        filename: file.filename,
        mimeType: file.mimetype,
        text,
        category,
      });

      void queueManager
        .enqueue({
          queue: "knowledge-indexing",
          tenantId: request.tenant_id,
          name: `index-doc-${document.id}`,
          data: { tenantId: request.tenant_id, documentId: document.id },
        })
        .catch(() => {});

      return reply.status(201).send({ data: document });
    }

    const body = knowledgeTextSchema.parse(request.body);

    const document = await knowledge.addDocument({
      tenantId: request.tenant_id,
      agentId: id,
      filename: body.title,
      mimeType: "text/plain",
      text: body.text,
      category: body.category || "general",
    });

    void queueManager
      .enqueue({
        queue: "knowledge-indexing",
        tenantId: request.tenant_id,
        name: `index-doc-${document.id}`,
        data: { tenantId: request.tenant_id, documentId: document.id },
      })
      .catch(() => {});

    return reply.status(201).send({ data: document });
  });

  app.post("/agents/:id/knowledge/url", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const urlBody = knowledgeUrlSchema.parse(request.body);
    const { url, title } = urlBody;
    const isDraft = urlBody.as_draft === true || urlBody.asDraft === true;

    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new AppError(400, "INVALID_URL", "Поддерживаются только протоколы http:// и https://");
    }
    if (
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname.startsWith("127.") ||
      parsedUrl.hostname.startsWith("169.254.") ||
      parsedUrl.hostname.startsWith("10.") ||
      parsedUrl.hostname.startsWith("192.168.")
    ) {
      throw new AppError(400, "FORBIDDEN_URL", "Запрос к локальным адресам запрещен");
    }

    let html = "";
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new AppError(502, "FETCH_FAILED", `Не удалось загрузить страницу: HTTP ${response.status}`);
      }

      html = await response.text();
    } catch (err) {
      if (err instanceof AppError) throw err;
      const msg = err instanceof Error ? err.message : "Ошибка сети";
      throw new AppError(502, "FETCH_FAILED", `Ошибка при загрузке URL: ${msg}`);
    }

    // AI-структурирование и выделение ключевых фактов/разделов страницы
    const extraction = await webExtractorService.extractAndStructure({
      url,
      htmlOrText: html,
      title,
      tenantId: request.tenant_id,
    });

    const docTitle = title?.trim() || extraction.title || `${parsedUrl.hostname}${parsedUrl.pathname !== "/" ? parsedUrl.pathname : ""}`;

    if (isDraft) {
      const draftDoc = await knowledge.createDraftDocument({
        tenantId: request.tenant_id,
        agentId: id,
        filename: `Сайт: ${docTitle}`,
        mimeType: "text/markdown",
        text: extraction.structuredMarkdown,
        sourceUrl: url,
        category: "website",
      });
      return reply.status(201).send({
        data: draftDoc,
        meta: { sectionsCount: extraction.sectionsCount, totalChars: extraction.totalChars },
      });
    }

    const document = await knowledge.addDocument({
      tenantId: request.tenant_id,
      agentId: id,
      filename: `Сайт: ${docTitle}`,
      mimeType: "text/markdown",
      text: extraction.structuredMarkdown,
      category: "website",
    });

    return reply.status(201).send({
      data: document,
      meta: { sectionsCount: extraction.sectionsCount, totalChars: extraction.totalChars },
    });
  });

  // AI-реструктуризация существующего документа в четкие семантические секции
  app.post("/agents/:id/knowledge/:docId/restructure", { onRequest: writeAgents }, async (request, reply) => {
    const { id, docId } = z.object({ id: z.string().uuid(), docId: z.string().uuid() }).parse(request.params);

    const doc = await queryOne<{
      id: string;
      filename: string;
      content_text: string | null;
      source_url: string | null;
      status: string;
    }>(
      `SELECT id, filename, content_text, source_url, status
       FROM knowledge_base_documents
       WHERE tenant_id = $1 AND id = $2 AND agent_id = $3`,
      [request.tenant_id, docId, id],
    );

    if (!doc || !doc.content_text) {
      throw new NotFoundError("Документ не найден или пуст");
    }

    const extraction = await webExtractorService.extractAndStructure({
      url: doc.source_url || undefined,
      htmlOrText: doc.content_text,
      title: doc.filename.replace(/^Сайт:\s*/, ""),
      tenantId: request.tenant_id,
    });

    const updated = await knowledge.updateDocument({
      tenantId: request.tenant_id,
      agentId: id,
      documentId: docId,
      filename: doc.filename,
      text: extraction.structuredMarkdown,
    });

    return reply.send({
      data: updated,
      meta: { sectionsCount: extraction.sectionsCount, totalChars: extraction.totalChars },
    });
  });

  // Сканирование всех страниц сайта (Краулер / Паук по внутренним ссылкам и sitemap.xml)
  app.post("/agents/:id/knowledge/crawl-site", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const { url, maxPages } = crawlSiteSchema.parse(request.body);

    const job = await knowledgeBaseQueue.add("crawl-website", {
      tenantId: request.tenant_id,
      botId: id,
      url,
      maxPages: maxPages ?? 25,
      source: "manual_button",
    });

    return reply.status(200).send({
      data: {
        jobId: job.id,
        status: "pending",
        scannedCount: 0,
        indexedCount: 0,
        documents: [],
        message: "Задача сканирования сайта добавлена в очередь",
      },
    });
  });

  // Получение статуса сканирования сайта агента
  app.get("/agents/:id/knowledge/crawl-status", { onRequest: readAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const agent = await service.getAgent(request.tenant_id, id);
    const cfg = (agent.wizardConfig || {}) as Record<string, unknown>;
    const status = (cfg.crawl_status as string) || "idle";

    return reply.send({
      data: {
        status,
        websiteUrl: (cfg.website_url as string) ?? null,
        pagesScanned: (cfg.crawl_pages_scanned as number) ?? 0,
        pagesIndexed: (cfg.crawl_pages_indexed as number) ?? 0,
        error: (cfg.crawl_error as string) ?? null,
        updatedAt: (cfg.crawl_updated_at as string) ?? null,
      },
    });
  });

  // Загрузка отзывов и профиля организации с карт (Яндекс Карты, 2ГИС, Google Maps, Zoon) по ссылке
  app.post("/agents/:id/knowledge/map-reviews", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const { url } = mapReviewsSchema.parse(request.body);

    let result;
    try {
      result = await crawlMapReviews(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось загрузить отзывы с карт";
      throw new AppError(400, "MAP_REVIEWS_FAILED", msg);
    }

    const document = await knowledge.addDocument({
      tenantId: request.tenant_id,
      agentId: id,
      filename: `Отзывы (${result.platform}): ${result.orgName.slice(0, 50)}`,
      mimeType: "text/markdown",
      text: result.markdownContent,
    });

    return reply.status(201).send({
      data: {
        document,
        details: {
          platform: result.platform,
          orgName: result.orgName,
          rating: result.rating,
          reviewsCount: result.reviewsCount,
          reviewsFound: result.reviews.length,
        },
      },
    });
  });

  app.get("/agents/:id/sales-examples", { onRequest: readAgents }, async (request, reply) => {
    const examples = await query<{
      id: string;
      deal_id: string;
      deal_title: string | null;
      customer_query: string;
      agent_reply: string;
      created_at: Date;
    }>(
      `SELECT e.id, e.deal_id, d.title as deal_title, e.customer_query, e.agent_reply, e.created_at
       FROM ai_sales_examples e
       LEFT JOIN deals d ON d.id = e.deal_id
       WHERE e.tenant_id = $1
       ORDER BY e.created_at DESC
       LIMIT 50`,
      [request.tenant_id],
    );

    return reply.send({
      data: examples.map((ex) => ({
        id: ex.id,
        dealId: ex.deal_id,
        dealTitle: ex.deal_title ?? "Сделка",
        customerQuery: ex.customer_query,
        agentReply: ex.agent_reply,
        createdAt: ex.created_at.toISOString(),
      })),
      meta: {
        total: examples.length,
      },
    });
  });

  app.get("/knowledge/crm-stats", { onRequest: readAgents }, async (request, reply) => {
    const stats = await knowledgeSynthesizerService.getCrmStats(request.tenant_id);
    return reply.send({ data: stats });
  });

  app.post("/agents/:id/knowledge/sync-crm", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const result = await knowledgeSynthesizerService.synthesizeFromCrm(request.tenant_id, id);
    return reply.status(201).send({ data: result });
  });

  app.post("/agents/:id/knowledge/import-whatsapp", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const body = whatsappImportSchema.parse(request.body);
    const result = await knowledgeSynthesizerService.synthesizeFromWhatsApp(
      request.tenant_id,
      id,
      body.text,
      body.filename,
    );
    return reply.status(201).send({ data: result });
  });

  // Human-in-the-loop RAG: создание черновика документа (без векторизации)
  app.post("/agents/:id/knowledge/draft", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const body = createDraftSchema.parse(request.body);
    const draft = await knowledge.createDraftDocument({
      tenantId: request.tenant_id,
      agentId: id,
      filename: body.title,
      mimeType: "text/markdown",
      text: body.text,
      category: body.category || "general",
      sourceUrl: body.source_url || body.sourceUrl,
    });
    return reply.status(201).send({ data: draft });
  });

  // Human-in-the-loop RAG: согласование и векторизация черновика (Approve & Vectorize)
  app.post("/agents/:id/knowledge/:docId/approve", { onRequest: writeAgents }, async (request, reply) => {
    const { id, docId } = documentParams.parse(request.params);
    const body = approveDraftSchema.parse(request.body ?? {});
    const doc = await knowledge.approveAndIndexDocument({
      tenantId: request.tenant_id,
      agentId: id,
      documentId: docId,
      text: body.text,
      filename: body.filename,
      category: body.category,
    });
    return reply.send({ data: doc });
  });

  app.get("/agents/:id/knowledge/:docId", { onRequest: readAgents }, async (request, reply) => {
    const { id, docId } = documentParams.parse(request.params);
    const doc = await knowledge.getDocument(request.tenant_id, id, docId);
    return reply.send({ data: doc });
  });

  app.put("/agents/:id/knowledge/:docId", { onRequest: writeAgents }, async (request, reply) => {
    const { id, docId } = documentParams.parse(request.params);
    const body = updateDocumentSchema.parse(request.body);
    const doc = await knowledge.updateDocument({
      tenantId: request.tenant_id,
      agentId: id,
      documentId: docId,
      text: body.text,
      filename: body.filename,
    });
    return reply.send({ data: doc });
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

  // Пополнение баланса через платёжный шлюз Robokassa
  app.post("/balance/checkout", { onRequest: [app.requirePermission("billing:manage")] }, async (request, reply) => {
    const body = topupBalanceSchema.parse(request.body);
    const billing = new BillingService();

    const checkout = await billing.createCheckout({
      tenantId: request.tenant_id,
      actorId: request.authUser.id,
      payload: {
        amount_rubles: body.amount_rubles,
        product_code: PRODUCT_CODES.AI_TOPUP,
        description: `Пополнение баланса ИИ (${body.amount_rubles} руб.)`,
      },
    });

    return reply.status(201).send({ data: checkout });
  });
}
