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
  utmTags: z.record(z.string()).optional(),
  ymUid: z.string().trim().max(100).optional(),
  gaId: z.string().trim().max(100).optional(),
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

  // Телеметрия и диагностика подключения виджета
  app.get("/debug", async (request, reply) => {
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
      .header("Cache-Control", "no-cache, no-store")
      .type("image/gif")
      .send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
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

      const result = await service.processIncomingMessage({
        channelAccountId,
        visitorId: body.visitorId,
        text: body.text,
        senderName: body.senderName,
        senderPhone: body.senderPhone,
        pageUrl: body.pageUrl,
        utmTags: body.utmTags,
        ymUid: body.ymUid,
        gaId: body.gaId,
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
