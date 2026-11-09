import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { WebchatService } from "./webchat.service.js";
import { WidgetAnalyticsService } from "./widget-analytics.service.js";
import { ChatMediaService } from "../crm/chat/media.service.js";

// ---------------------------------------------------------------------------
// Публичные маршруты для виджета онлайн-чата на сайте клиента.
//
// Не требуют аутентификации пользователя CRM (JWT), так как вызываются из
// браузера анонимного посетителя сайта.
// Изоляция данных тенанта гарантируется привязкой к конкретному `channelAccountId`.
// ---------------------------------------------------------------------------

const messageBodySchema = z
  .object({
    visitorId: z.string().trim().min(1, "visitorId is required").max(100),
    sessionId: z.string().trim().max(100).optional(),
    text: z.string().trim().max(4000).default(""),
    senderName: z.string().trim().max(100).optional(),
    senderPhone: z.string().trim().max(30).optional(),
    senderEmail: z.string().trim().max(100).optional(),
    attachment: z.string().trim().max(1000).optional(),
    attachmentType: z.string().trim().max(100).optional(),
    pageUrl: z.string().trim().max(500).optional(),
    pageTitle: z.string().trim().max(300).optional(),
    referrer: z.string().trim().max(500).optional(),
    utmTags: z.record(z.string()).optional(),
    clickIds: z.record(z.string().nullable().optional()).optional(),
    analytics: z.record(z.string().nullable().optional()).optional(),
    deviceFingerprint: z.string().trim().max(100).optional(),
    deviceInfo: z.record(z.unknown()).optional(),
    ymUid: z.string().trim().max(100).optional(),
    gaId: z.string().trim().max(100).optional(),
    fbId: z.string().trim().max(100).optional(),
    visitCount: z.number().int().min(0).optional(),
    coords: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        accuracy: z.number().optional(),
      })
      .optional(),
    pageHistory: z
      .array(
        z.object({
          step: z.number(),
          time: z.string(),
          url: z.string(),
        }),
      )
      .optional(),
    isDraft: z.boolean().optional(),
  })
  .refine((data) => data.text.length > 0 || Boolean(data.attachment), {
    message: "Либо текст сообщения, либо файл должны быть указаны",
  });

const historyQuerySchema = z.object({
  visitorId: z.string().trim().min(1, "visitorId is required").max(100),
});

const trackBodySchema = z.object({
  widgetId: z.string().uuid("widgetId must be a UUID"),
  sessionId: z.string().trim().min(1, "sessionId is required").max(100),
  visitorId: z.string().trim().min(1, "visitorId is required").max(100),
  eventType: z.enum(["VISIT", "WIDGET_OPEN", "CHAT_START", "LEAD_CAPTURED"]),
  metadata: z.record(z.unknown()).optional(),
});

export const webchatRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new WebchatService(app.log);

  // Разрешаем кросс-доменное обращение к публичному чату с любых клиентских сайтов
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");
  });

  // Телеметрия и диагностика подключения виджета (поддерживаем GET и POST для sendBeacon)
  app.route({
    method: ["GET", "POST"],
    url: "/debug",
    handler: async (request, reply) => {
      app.log.info(
        {
          query: request.query,
          ip: request.ip,
          ua: request.headers["user-agent"],
        },
        "[WIDGET_TELEMETRY]",
      );
      return reply
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header("Cache-Control", "no-cache, no-store")
        .type("image/gif")
        .send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
    },
  });

  // Публичный сбор событий конверсионной воронки виджета (с сайта клиента)
  app.route({
    method: ["POST", "OPTIONS"],
    url: "/track",
    handler: async (request, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "*");

      if (request.method === "OPTIONS") {
        return reply.status(204).send();
      }

      const body = trackBodySchema.parse(request.body);
      const analyticsService = new WidgetAnalyticsService(app.log);
      const result = await analyticsService.trackPublicEvent(body);

      return reply.status(200).send({ data: result });
    },
  });

  // Получение настроек чата для виджета (название компании, имя агента)
  app.get<{ Params: { channelAccountId: string } }>(
    "/info/:channelAccountId",
    async (request, reply) => {
      const { channelAccountId } = request.params;
      const info = await service.resolveAccount(channelAccountId);
      return reply.send({ data: info });
    },
  );

  // Инициализация диалога (проверка доступности и сессии)
  app.post<{ Params: { channelAccountId: string }; Body: { visitorId?: string } }>(
    "/init/:channelAccountId",
    async (request, reply) => {
      const { channelAccountId } = request.params;
      const info = await service.resolveAccount(channelAccountId);
      const visitorId = request.body?.visitorId?.trim() || `visitor_${Math.random().toString(36).substring(2, 11)}`;

      return reply.send({
        data: {
          ...info,
          visitorId,
        },
      });
    },
  );

  // Загрузка вложения (фото, видео, документ) от посетителя сайта
  app.post<{ Params: { channelAccountId: string } }>(
    "/upload/:channelAccountId",
    async (request, reply) => {
      const { channelAccountId } = request.params;
      const account = await service.resolveAccount(channelAccountId);
      if (!account) {
        return reply.status(404).send({ error: "Канал веб-чата не найден" });
      }

      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "Файл не прикреплен" });
      }

      const buffer = await file.toBuffer();
      if (buffer.length === 0) {
        return reply.status(400).send({ error: "Пустой файл" });
      }

      const mediaService = new ChatMediaService();
      const stored = await mediaService.storeBuffer({
        buffer,
        originalName: file.filename || `upload_${Date.now()}`,
        mimeType: file.mimetype || "application/octet-stream",
        tenantId: account.tenantId,
      });

      return reply.send({
        data: {
          url: stored.url,
          filename: stored.filename,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
        },
      });
    },
  );

  // Отправка сообщения посетителем сайта
  app.post<{ Params: { channelAccountId: string } }>(
    "/message/:channelAccountId",
    async (request, reply) => {
      const { channelAccountId } = request.params;
      const body = messageBodySchema.parse(request.body);

      const cfConnectingIp = request.headers["cf-connecting-ip"];
      const forwarded = request.headers["x-forwarded-for"];
      const xRealIp = request.headers["x-real-ip"];
      const clientIp =
        (typeof cfConnectingIp === "string" ? cfConnectingIp.trim() : null) ||
        (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : Array.isArray(forwarded) ? forwarded[0] : null) ||
        (typeof xRealIp === "string" ? xRealIp.trim() : null) ||
        request.ip;
      const userAgent = (request.headers["user-agent"] as string) || "";

      const result = await service.processIncomingMessage({
        channelAccountId,
        visitorId: body.visitorId,
        sessionId: body.sessionId,
        text: body.text,
        senderName: body.senderName,
        senderPhone: body.senderPhone,
        senderEmail: body.senderEmail,
        attachment: body.attachment,
        attachmentType: body.attachmentType,
        pageUrl: body.pageUrl,
        referrer: body.referrer,
        utmTags: body.utmTags,
        clickIds: body.clickIds as Record<string, string> | undefined,
        analytics: body.analytics as Record<string, string | null> | undefined,
        deviceFingerprint: body.deviceFingerprint,
        deviceInfo: body.deviceInfo,
        coords: body.coords,
        clientIp,
        userAgent,
        ymUid: body.ymUid,
        gaId: body.gaId,
        fbId: body.fbId,
        visitCount: body.visitCount,
        pageHistory: body.pageHistory,
        isDraft: body.isDraft,
      });

      return reply.status(200).send({ data: result });
    },
  );

  // Загрузка истории переписки для посетителя
  app.get<{ Params: { channelAccountId: string } }>(
    "/history/:channelAccountId",
    async (request, reply) => {
      const { channelAccountId } = request.params;
      const query = historyQuerySchema.parse(request.query);

      const history = await service.getHistory(channelAccountId, query.visitorId);
      return reply.send({ data: history });
    },
  );
};
