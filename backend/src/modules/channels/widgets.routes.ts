import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { ChannelsService } from "./channels.service.js";
import { WebchatService } from "./webchat.service.js";
import { WidgetAnalyticsService, type WidgetEventType } from "./widget-analytics.service.js";
import { GeoEnrichmentService } from "../../services/geo-enrichment.service.js";
import { channelStatusSchema, updateChannelAccountSchema } from "./channels.types.js";

const widgetParams = z.object({
  id: z.string().uuid("ID виджета должен быть валидным UUID"),
});

const widgetStatusBody = z
  .object({
    status: channelStatusSchema.optional(),
    is_enabled: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((v) => v.status !== undefined || v.is_enabled !== undefined || v.isEnabled !== undefined, {
    message: "Укажите status или is_enabled",
  });

/**
 * Выделенные эндпоинты для управления онлайн-виджетами чата.
 * Поддерживают аутентификацию CRM и tenant isolation (RLS), а также публичный bootstrap.
 */
export const widgetsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(authenticatePlugin);

  const channelsService = new ChannelsService();
  const webchatService = new WebchatService(app.log);

  // Публичный Bootstrap виджета для клиентских сайтов
  app.get("/bootstrap/:id", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");

    const parsed = widgetParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(404).send({
        enabled: false,
        is_enabled: false,
        error: "Аккаунт веб-чата не найден",
      });
    }

    try {
      const info = await webchatService.resolveAccount(parsed.data.id);
      return reply.send({
        enabled: true,
        is_enabled: true,
        status: "connected",
        data: info,
      });
    } catch {
      return reply.status(200).send({
        enabled: false,
        is_enabled: false,
        status: "disabled",
      });
    }
  });

  // Публичный приём событий телеметрии и конверсионной воронки виджета (VISIT, WIDGET_OPEN и т.д.)
  app.route({
    method: ["POST", "OPTIONS"],
    url: "/:id/events",
    handler: async (request, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "*");

      if (request.method === "OPTIONS") {
        return reply.status(204).send();
      }

      const params = request.params as { id: string };
      const rawKey = params.id?.trim();
      if (!rawKey) {
        return reply.status(400).send({ error: "widget key is required" });
      }

      const body = (request.body as Record<string, unknown> | undefined) || {};
      const eventRaw = (body.event || body.eventType || "VISIT") as string;
      const validEvents: ReadonlySet<string> = new Set(["VISIT", "WIDGET_OPEN", "CHAT_START", "LEAD_CAPTURED"]);
      if (!validEvents.has(eventRaw)) {
        return reply.status(400).send({ error: "Invalid event type" });
      }

      const sessionId =
        (typeof body.sessionId === "string" && body.sessionId.trim()) ||
        (typeof body.visitorId === "string" && body.visitorId.trim()) ||
        `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const visitorId =
        (typeof body.visitorId === "string" && body.visitorId.trim()) ||
        sessionId;

      const metadata =
        typeof body.metadata === "object" && body.metadata !== null
          ? (body.metadata as Record<string, unknown>)
          : {};

      const cfConnectingIp = request.headers["cf-connecting-ip"];
      const forwarded = request.headers["x-forwarded-for"];
      const xRealIp = request.headers["x-real-ip"];
      const clientIp =
        (typeof cfConnectingIp === "string" ? cfConnectingIp.trim() : null) ||
        (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : Array.isArray(forwarded) ? forwarded[0] : null) ||
        (typeof xRealIp === "string" ? xRealIp.trim() : null) ||
        request.ip;

      if (!metadata.geo && clientIp) {
        const geoService = new GeoEnrichmentService(app.log);
        const geoData = await geoService.lookupIp(clientIp);
        if (geoData) {
          metadata.geo = geoData;
        }
      }

      const analyticsService = new WidgetAnalyticsService(app.log);
      const result = await analyticsService.trackPublicEvent({
        widgetId: rawKey,
        sessionId,
        visitorId,
        eventType: eventRaw as WidgetEventType,
        metadata,
      });

      if (!result.success) {
        return reply.status(404).send({ error: "Widget not found or inactive" });
      }

      return reply.status(200).send({ success: true, id: result.id });
    },
  });

  // Авторизованные маршруты управления виджетом в CRM
  const authGuards = [app.requirePermission("tenant:admin")];

  app.get("/:id", { onRequest: authGuards }, async (request, reply) => {
    const { id } = widgetParams.parse(request.params);
    const account = await channelsService.get(request.tenant_id, "webchat", id);
    return reply.send({ data: account });
  });

  app.patch("/:id", { onRequest: authGuards }, async (request, reply) => {
    const { id } = widgetParams.parse(request.params);
    const body = updateChannelAccountSchema.parse(request.body);
    const account = await channelsService.update(request.tenant_id, "webchat", id, body);
    return reply.send({ data: account });
  });

  app.patch("/:id/toggle", { onRequest: authGuards }, async (request, reply) => {
    const { id } = widgetParams.parse(request.params);
    const account = await channelsService.toggleStatus(request.tenant_id, "webchat", id);
    return reply.send({ data: account });
  });

  app.patch("/:id/status", { onRequest: authGuards }, async (request, reply) => {
    const { id } = widgetParams.parse(request.params);
    const body = widgetStatusBody.parse(request.body);

    const isEnabled = body.is_enabled ?? body.isEnabled;
    const nextStatus =
      body.status ?? (isEnabled !== undefined ? (isEnabled ? "connected" : "disabled") : undefined);

    const account = await channelsService.update(request.tenant_id, "webchat", id, {
      status: nextStatus,
      is_enabled: isEnabled,
    });

    return reply.send({ data: account });
  });
};
