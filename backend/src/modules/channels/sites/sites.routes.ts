import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { authenticatePlugin } from "../../../plugins/authenticate.js";
import { SitesService } from "./sites.service.js";
import {
  createSiteSchema,
  updateSiteSchema,
  siteParamsSchema,
  siteWebhookParamsSchema,
} from "./sites.types.js";

function getApiBase(request: FastifyRequest): string {
  const forwardedProto = (request.headers["x-forwarded-proto"] as string) || "https";
  const host = request.headers.host || "api.getvoxly.ru";
  return `${forwardedProto}://${host}`;
}

/**
 * Маршруты управления интеграциями сайтов (требуют авторизации в CRM).
 */
export const siteManagementRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(authenticatePlugin);

  const sitesService = new SitesService();

  // GET /api/v1/channels/sites — список сайтов арендатора
  app.get("", async (request: FastifyRequest, reply: FastifyReply) => {
    const apiBase = getApiBase(request);
    const sites = await sitesService.listSites(request.tenant_id, apiBase);
    return reply.send({ data: sites });
  });

  // POST /api/v1/channels/sites — подключение нового сайта
  app.post("", async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = createSiteSchema.parse(request.body);
    const apiBase = getApiBase(request);
    const created = await sitesService.createSite(request.tenant_id, payload, apiBase);
    return reply.status(201).send({ data: created });
  });

  // GET /api/v1/channels/sites/:id — получение данных конкретного сайта
  app.get("/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = siteParamsSchema.parse(request.params);
    const apiBase = getApiBase(request);
    const site = await sitesService.getSite(request.tenant_id, id, apiBase);
    return reply.send({ data: site });
  });

  // PATCH /api/v1/channels/sites/:id — обновление настроек сайта
  app.patch("/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = siteParamsSchema.parse(request.params);
    const payload = updateSiteSchema.parse(request.body);
    const apiBase = getApiBase(request);
    const updated = await sitesService.updateSite(request.tenant_id, id, payload, apiBase);
    return reply.send({ data: updated });
  });

  // DELETE /api/v1/channels/sites/:id — удаление сайта
  app.delete("/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = siteParamsSchema.parse(request.params);
    await sitesService.deleteSite(request.tenant_id, id);
    return reply.status(204).send();
  });

  // POST /api/v1/channels/sites/:id/regenerate-token — перегенерация токена вебхука
  app.post("/:id/regenerate-token", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = siteParamsSchema.parse(request.params);
    const apiBase = getApiBase(request);
    const updated = await sitesService.regenerateToken(request.tenant_id, id, apiBase);
    return reply.send({ data: updated });
  });
};

/**
 * Публичные Webhook-маршруты приёма лидов с внешних сайтов (Tilda, WordPress, Webflow, HTML).
 * Доступны без сессии CRM по уникальному токену.
 */
export const siteWebhookRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const sitesService = new SitesService();

  // POST & OPTIONS /api/v1/webhooks/sites/:token
  app.route({
    method: ["POST", "OPTIONS"],
    url: "/:token",
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "*");

      if (request.method === "OPTIONS") {
        return reply.status(204).send();
      }

      const { token } = siteWebhookParamsSchema.parse(request.params);

      let payload: Record<string, unknown> = {};

      if (request.isMultipart()) {
        const parts = request.parts({ limits: { fields: 100 } });
        for await (const part of parts) {
          if (part.type === "field") {
            payload[part.fieldname] = part.value;
          }
        }
      } else if (typeof request.body === "object" && request.body !== null) {
        payload = request.body as Record<string, unknown>;
      } else if (typeof request.body === "string") {
        try {
          payload = JSON.parse(request.body) as Record<string, unknown>;
        } catch {
          payload = Object.fromEntries(new URLSearchParams(request.body));
        }
      }

      // Если в query параметрах передали данные (некоторые webhook-инструменты шлют в GET/POST query)
      if (request.query && typeof request.query === "object") {
        const queryObj = request.query as Record<string, unknown>;
        for (const [k, v] of Object.entries(queryObj)) {
          if (payload[k] === undefined) {
            payload[k] = v;
          }
        }
      }

      const result = await sitesService.processWebhook(token, payload);
      return reply.status(200).send(result);
    },
  });
};

export default siteManagementRoutes;
