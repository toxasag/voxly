import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { errorHandler } from "./plugins/errorHandler.js";
import { authenticatePlugin } from "./plugins/authenticate.js";
import { authorizePlugin } from "./plugins/authorize.js";
import authRoutes from "./modules/auth/auth.routes.js";
import crmRoutes from "./modules/crm/crm.routes.js";
import repairsRoutes from "./modules/repairs/repairs.routes.js";
import financeRoutes from "./modules/finance/finance.routes.js";
import invoiceRoutes from "./modules/finance/invoices.routes.js";
import billingRoutes from "./modules/finance/billing/billing.routes.js";
import storiesRoutes from "./modules/stories/stories.routes.js";
import marketplaceRoutes from "./modules/marketplace/marketplace.routes.js";
import channelsRoutes from "./modules/channels/channels.routes.js";
import telegramIntegrationRoutes from "./modules/channels/telegram-integration.routes.js";
import whatsappIntegrationRoutes, { whatsappInternalRoutes } from "./modules/channels/whatsapp-integration.routes.js";
import maxIntegrationRoutes, { maxInternalRoutes } from "./modules/channels/max-integration.routes.js";
import { webchatRoutes } from "./modules/channels/webchat.routes.js";
import { chatStreamRoutes } from "./modules/crm/chat/chat-stream.routes.js";
import aiRoutes from "./modules/ai/ai.routes.js";
import botAliasRoutes from "./modules/ai/bot-alias.routes.js";
import adminTenantRoutes from "./modules/admin/admin-tenants.routes.js";
import adminMetricsRoutes from "./modules/admin/admin-metrics.routes.js";
import adminPlatformRoutes from "./modules/admin/admin-platform.routes.js";
import geminiIntegrationRoutes from "./modules/ai/gemini-integration.routes.js";
import tenantRoutes from "./modules/tenant/tenant.routes.js";
import profileRoutes from "./modules/profile/profile.routes.js";
import notificationChannelsRoutes from "./modules/notifications/notification-channels.routes.js";
import { analyticsRoutes } from "./modules/analytics/analytics.routes.js";
import { conversionDispatcher } from "./modules/analytics/conversion-dispatcher.service.js";
import { onDealWon, onDealStageChanged } from "./modules/crm/deals/deals.service.js";
import { SalesLearnService } from "./modules/ai/sales-learn.service.js";
import { StageRulesService } from "./modules/crm/deals/stage-rules.service.js";
import stageRulesRoutes from "./modules/crm/deals/stage-rules.routes.js";
import { leadsRoutes } from "./modules/crm/leads/leads.routes.js";
import { checkConnection, runWithRequestContext } from "./db/client.js";
import { corsOriginMatcher, getEnv } from "./config/env.js";
import { WIDGET_SCRIPT } from "./modules/channels/widget-script.js";
import fastify from "fastify";

/** Пути webhook-ов ботов и платёжных шлюзов — исключения из общего лимита, сверяются точно. */
const WEBHOOK_PATHS: ReadonlySet<string> = new Set([
  "/widget.js",
  "/auth/telegram/webhook",
  "/auth/max/webhook",
  "/api/v1/billing/robokassa/result",
  "/api/internal/whatsapp/webhook",
  "/api/v1/integrations/whatsapp/webhook",
  "/api/internal/max/inbound",
  "/api/internal/max/outbound",
]);

export async function buildApp(): Promise<FastifyInstance> {
  // Validated up front: a bad JWT_SECRET or missing DATABASE_URL must stop the
  // boot rather than degrade into a runtime failure later.
  const env = getEnv();

  const app = fastify({
    trustProxy: true,
    bodyLimit: 15 * 1024 * 1024,
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
  }) as FastifyInstance;

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
  });

  // Function form, not a static list: each tenant has its own subdomain
  // ({slug}.getvoxly.ru), and enumerating them is impossible. The matcher
  // accepts a `*.` pattern for exactly one label.
  const isAllowedOrigin = corsOriginMatcher();

  await app.register(cors, {
    delegator: (req: FastifyRequest) => {
      const url = (req.url ?? "").split("?")[0] ?? "";
      // Публичный виджет и чат для внешних сайтов клиентов (WordPress, Tilda и др.)
      const isPublicRoute =
        url === "/widget.js" ||
        url.startsWith("/api/v1/public/chat/") ||
        url.startsWith("/mascots/");

      if (isPublicRoute) {
        return Promise.resolve({
          origin: true,
          credentials: true,
          methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
        });
      }

      const origin = req.headers.origin;
      if (isAllowedOrigin(origin)) {
        return Promise.resolve({
          origin: true,
          credentials: true,
        });
      }

      // Rejected without throwing: the browser then blocks the response, which
      // is the intended outcome, and the server logs stay clean.
      return Promise.resolve({
        origin: false,
      });
    },
  });

  await app.register(sensible);

  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
    /**
     * Bot webhooks are exempt from the shared per-IP limit: both platforms retry
     * a throttled delivery, and a burst of updates would otherwise be dropped,
     * silently breaking chat binding. MAX additionally unsubscribes the bot after
     * 8 hours of failed deliveries, so throttling it would disable the channel.
     *
     * Matched on the exact path, not by prefix: `startsWith` also exempted
     * arbitrary suffixes such as `/auth/max/webhookX`, widening the exemption
     * beyond the two real routes. Each endpoint still enforces its secret token,
     * and both carry their own higher route-level limit (see auth.routes.ts), so
     * an unauthenticated caller cannot use them as an unbounded write path.
     */
    allowList: (request) => WEBHOOK_PATHS.has((request.url ?? "").split("?")[0] ?? ""),
  });

  // Secret comes from validated env — no inline fallback, so production can
  // never boot with a publicly known signing key.
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.ACCESS_TOKEN_TTL,
    },
  });

  // Загрузка документов базы знаний агентов. Регистрируется глобально, потому что
  // `request.isMultipart()` и `request.file()` — декораторы инстанса, а не
  // отдельного роут-контекста.
  //
  // Лимиты заданы здесь, а не только в маршруте: без них ограничение опиралось бы
  // на честность вызывающего, а `files: 1` не даёт отправить сотню файлов одним
  // запросом. Значение совпадает с `MAX_FILE_SIZE_BYTES` в knowledge-text.ts —
  // 10 МБ; docx такого размера даёт сотни страниц, то есть тысячи оплачиваемых
  // фрагментов.
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      // Поля формы: только название документа, поэтому предел низкий.
      fields: 5,
      fieldSize: 1024 * 100,
    },
  });

  app.setErrorHandler(errorHandler);

  // Opens an AsyncLocalStorage scope for the whole request, which the
  // authenticate hook later fills with the tenant id. Registered here, before
  // any route group, so the store exists by the time authentication runs.
  //
  // `onRequest` with `done` (not async): the callback form lets the rest of the
  // request run *inside* the storage scope. An async hook would return first,
  // and the context would be gone before any query executed.
  app.addHook("onRequest", (_request, _reply, done) => {
    runWithRequestContext(done);
  });

  await app.register(authorizePlugin);

  await app.register(authRoutes, { prefix: "/auth" });

  // Core CRM — authenticate + authorize are registered inside the group.
  await app.register(crmRoutes, { prefix: "/api/v1/crm" });
  await app.register(crmRoutes, { prefix: "/api/crm" });
  await app.register(crmRoutes, { prefix: "/api" });
  await app.register(leadsRoutes, { prefix: "/api/v1/leads" });
  await app.register(stageRulesRoutes, { prefix: "/api/v1/crm/stage-rules" });

  // Service Center — additionally gated on the `service_center` module being
  // installed for the tenant (403 MODULE_NOT_INSTALLED otherwise).
  await app.register(repairsRoutes, { prefix: "/api/v1/repairs" });
  await app.register(financeRoutes, { prefix: "/api/v1/finance" });
  await app.register(invoiceRoutes, { prefix: "/api/v1/invoices" });
  await app.register(billingRoutes, { prefix: "/api/v1/billing" });
  await app.register(storiesRoutes, { prefix: "/api/v1/stories" });
  await app.register(marketplaceRoutes, { prefix: "/api/v1/marketplace" });
  await app.register(analyticsRoutes, { prefix: "/api/v1/analytics" });
  await app.register(analyticsRoutes, { prefix: "/api/analytics" });

  // Каналы связи. Модуль определяется параметром `:channel`, поэтому гейт
  // установки применяется на каждом запросе, а не при регистрации группы.
  await app.register(channelsRoutes, { prefix: "/api/v1/channels" });

  // Авторизация аккаунтов Telegram через MTProto. Отдельная группа: у остальных
  // каналов нет двухшагового входа с кодом и облачным паролем.
  await app.register(telegramIntegrationRoutes, { prefix: "/api/v1/integrations/telegram" });

  // Авторизация WhatsApp через Evolution API (QR-код)
  await app.register(whatsappIntegrationRoutes, { prefix: "/api/v1/integrations/whatsapp" });

  // Внутренний эндпоинт для webhook от Evolution API (WhatsApp incoming/outgoing)
  await app.register(whatsappInternalRoutes, { prefix: "/api/internal/whatsapp" });

  // Авторизация личных аккаунтов MAX через max-bridge (QR-код)
  await app.register(maxIntegrationRoutes, { prefix: "/api/v1/integrations/max" });

  // Внутренние эндпоинты для сервиса max-bridge (upsert, active bots, delete, inbound/outbound)
  await app.register(maxInternalRoutes, { prefix: "/api/internal/max" });

  // Верификация и диагностика провайдера Google Gemini
  await app.register(geminiIntegrationRoutes, { prefix: "/api/integrations/gemini" });
  await app.register(geminiIntegrationRoutes, { prefix: "/api/v1/integrations/gemini" });

  // Раздача клиентского JS-виджета для внешних сайтов (WordPress, Tilda и др.)
  app.get("/widget.js", async (request, reply) => {
    app.log.info(
      { ip: request.ip, ua: request.headers["user-agent"], referer: request.headers.referer },
      "[WIDGET_JS_REQUEST]",
    );
    return reply
      .type("application/javascript; charset=utf-8")
      .header("Cache-Control", "no-cache, no-store, must-revalidate")
      .header("Access-Control-Allow-Origin", "*")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .header("Cross-Origin-Embedder-Policy", "unsafe-none")
      .send(WIDGET_SCRIPT);
  });

  // Медиа CRM доступны только авторизованному пользователю своего арендатора.
  // Имя файла содержит tenant UUID, поэтому проверяем принадлежность до открытия
  // потока; публичная кэшируемость отключена, чтобы URL не превращался в
  // бессрочную ссылку на вложение.
  await app.register(async (mediaApp) => {
    await mediaApp.register(authenticatePlugin);
    mediaApp.get("/uploads/:filename", async (request, reply) => {
      const { filename } = request.params as { filename: string };
      const safeFilename = path.basename(filename);
      const tenantPrefix = `${request.tenant_id}_`;
      if (!safeFilename.startsWith(tenantPrefix)) {
        return reply.status(404).send({ error: "File not found" });
      }
      const filePath = path.join(process.cwd(), "uploads", safeFilename);

      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          return reply.status(404).send({ error: "File not found" });
        }

        const ext = path.extname(safeFilename).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".webp": "image/webp",
          ".gif": "image/gif",
          ".svg": "image/svg+xml",
          ".mp3": "audio/mpeg",
          ".ogg": "audio/ogg",
          ".pdf": "application/pdf",
          ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ".doc": "application/msword",
          ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ".xls": "application/vnd.ms-excel",
          ".txt": "text/plain",
          ".zip": "application/zip",
        };
        const contentType = mimeMap[ext] ?? "application/octet-stream";

        return reply
          .type(contentType)
          .header("Cache-Control", "private, no-store")
          .header("Cross-Origin-Resource-Policy", "same-site")
          .send(createReadStream(filePath));
      } catch {
        return reply.status(404).send({ error: "File not found" });
      }
    });
  });

  // Публичный онлайн-чат на сайте (виджет для клиентов)
  await app.register(webchatRoutes, { prefix: "/api/v1/public/chat" });

  // Внутренний чат CRM в реальном времени (SSE стрим и дельта-поллинг)
  await app.register(chatStreamRoutes, { prefix: "/api/v1" });

  // AI-агенты и баланс ИИ.
  await app.register(aiRoutes, { prefix: "/api/v1/ai" });
  await app.register(aiRoutes, { prefix: "/api/ai" });
  await app.register(botAliasRoutes, { prefix: "/api/bots" });
  await app.register(botAliasRoutes, { prefix: "/api/v1/bots" });
  await app.register(adminTenantRoutes, { prefix: "/api/v1/admin" });
  await app.register(adminMetricsRoutes, { prefix: "/api/v1/admin" });
  await app.register(adminPlatformRoutes, { prefix: "/api/v1/admin" });
  await app.register(tenantRoutes, { prefix: "/api/v1/tenant" });
  await app.register(profileRoutes, { prefix: "/api/v1/profile" });
  await app.register(notificationChannelsRoutes, { prefix: "/api/v1/settings/notifications" });
  await app.register(notificationChannelsRoutes, { prefix: "/api/settings/notifications" });

  // Автоматический сбор опыта в базу знаний AI при успешном закрытии сделок
  const salesLearnService = new SalesLearnService();
  onDealWon((payload) => void salesLearnService.harvestWonDeal(payload));

  // Автоворонки по этапам сделок
  const stageRulesService = new StageRulesService();
  onDealStageChanged((payload) => void stageRulesService.fireStageRules(payload));

  // Серверные конверсии и трекеры аналитики (Server-Side Conversion Tracking)
  onDealStageChanged((payload) => void conversionDispatcher.handleDealStageChanged(payload));

  app.get("/health", async (_request, reply) => {
    const dbReachable = await checkConnection();

    return reply.status(dbReachable ? 200 : 503).send({
      status: dbReachable ? "ok" : "degraded",
      database: dbReachable ? "up" : "down",
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
