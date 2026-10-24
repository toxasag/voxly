import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { WebchatService } from "./webchat.service.js";

// ---------------------------------------------------------------------------
// Публичные маршруты для виджета онлайн-чата на сайте клиента.
//
// Не требуют аутентификации пользователя CRM (JWT), так как вызываются из
// браузера анонимного посетителя сайта.
// Изоляция данных тенанта гарантируется привязкой к конкретному `channelAccountId`.
// ---------------------------------------------------------------------------

const messageBodySchema = z.object({
  visitorId: z.string().trim().min(1, "visitorId is required").max(100),
  text: z.string().trim().min(1, "text is required").max(4000),
  senderName: z.string().trim().max(100).optional(),
  senderPhone: z.string().trim().max(30).optional(),
  pageUrl: z.string().trim().max(500).optional(),
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
});

const historyQuerySchema = z.object({
  visitorId: z.string().trim().min(1, "visitorId is required").max(100),
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

  // Отправка сообщения посетителем сайта
  app.post<{ Params: { channelAccountId: string } }>(
    "/message/:channelAccountId",
    async (request, reply) => {
      const { channelAccountId } = request.params;
      const body = messageBodySchema.parse(request.body);

      const forwarded = request.headers["x-forwarded-for"];
      const clientIp =
        (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : Array.isArray(forwarded) ? forwarded[0] : null) ||
        (request.headers["x-real-ip"] as string) ||
        request.ip;
      const userAgent = (request.headers["user-agent"] as string) || "";

      const result = await service.processIncomingMessage({
        channelAccountId,
        visitorId: body.visitorId,
        text: body.text,
        senderName: body.senderName,
        senderPhone: body.senderPhone,
        pageUrl: body.pageUrl,
        referrer: body.referrer,
        utmTags: body.utmTags,
        clickIds: body.clickIds as Record<string, string> | undefined,
        analytics: body.analytics as Record<string, string | null> | undefined,
        deviceFingerprint: body.deviceFingerprint,
        deviceInfo: body.deviceInfo,
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
