import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { query } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { AppError } from "../../plugins/errorHandler.js";
import { AiService } from "./ai.service.js";
import { KnowledgeBaseService } from "./knowledge.service.js";
import { BillingService } from "../finance/billing/billing.service.js";
import { PRODUCT_CODES } from "../finance/billing/billing.types.js";
import { platformConfigService } from "../admin/platform-config.service.js";
import {
  createAgentSchema,
  topupBalanceSchema,
  updateAgentSchema,
} from "./ai.types.js";
import { AI_MODEL_CATALOG } from "./ai-pricing.js";
import { crawlWebsite } from "./site-crawler.js";
import { crawlMapReviews } from "./map-reviews-crawler.js";
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
  category: z.string().trim().optional(),
});

/**
 * Импорт веб-страницы или справочника по URL.
 */
const knowledgeUrlSchema = z.object({
  url: z.string().url("Укажите корректный URL (http:// или https://)"),
  title: z.string().trim().max(120).optional(),
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

export default async function aiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new AiService();
  const knowledge = new KnowledgeBaseService();

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
      activeProvider: defaultProvider,
      data: finalModels,
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

    // Если при создании передан URL сайта, запускаем сканирование страниц сайта в базу знаний
    if (body.website_url && body.website_url.trim()) {
      try {
        const pages = await crawlWebsite(body.website_url.trim(), { maxPages: 20 });
        for (const page of pages) {
          try {
            await knowledge.addDocument({
              tenantId: request.tenant_id,
              agentId: agent.id,
              filename: `Сайт [${page.path}]: ${page.title.slice(0, 50)}`,
              mimeType: "text/html",
              text: `# ${page.title}\nURL: ${page.url}\n\n${page.text}`,
            });
          } catch {
            // Продолжаем индексацию остальных страниц
          }
        }
      } catch (err) {
        request.log.warn({ err }, "Не удалось автоматически просканировать сайт при создании агента");
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
    const { url, title } = knowledgeUrlSchema.parse(request.body);

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

    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    if (cleanText.length < 50) {
      throw new AppError(400, "EMPTY_CONTENT", "На странице не найдено достаточного текстового содержимого");
    }

    const docTitle = title?.trim() || `${parsedUrl.hostname}${parsedUrl.pathname !== "/" ? parsedUrl.pathname : ""}`;

    const document = await knowledge.addDocument({
      tenantId: request.tenant_id,
      agentId: id,
      filename: `Сайт: ${docTitle}`,
      mimeType: "text/html",
      text: cleanText.slice(0, 100_000),
    });

    return reply.status(201).send({ data: document });
  });

  // Сканирование всех страниц сайта (Краулер / Паук по внутренним ссылкам и sitemap.xml)
  app.post("/agents/:id/knowledge/crawl-site", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = agentParams.parse(request.params);
    const { url, maxPages } = crawlSiteSchema.parse(request.body);

    let crawledPages;
    try {
      crawledPages = await crawlWebsite(url, { maxPages: maxPages ?? 25 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось просканировать сайт";
      throw new AppError(400, "CRAWL_FAILED", msg);
    }

    if (crawledPages.length === 0) {
      throw new AppError(400, "NO_PAGES_FOUND", "На сайте не найдено подходящих страниц с текстовым содержимым");
    }

    const createdDocs = [];
    for (const page of crawledPages) {
      try {
        const doc = await knowledge.addDocument({
          tenantId: request.tenant_id,
          agentId: id,
          filename: `Сайт [${page.path}]: ${page.title.slice(0, 50)}`,
          mimeType: "text/html",
          text: `# ${page.title}\nURL: ${page.url}\n\n${page.text}`,
        });
        createdDocs.push(doc);
      } catch {
        // Пропускаем страницу, если векторизация отдельного фрагмента вызвала ошибку
      }
    }

    return reply.status(201).send({
      data: {
        scannedCount: crawledPages.length,
        indexedCount: createdDocs.length,
        documents: createdDocs,
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
