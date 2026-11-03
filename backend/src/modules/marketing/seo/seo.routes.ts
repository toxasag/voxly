import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../../plugins/authenticate.js";
import { SeoService } from "./seo.service.js";

const searchKeywordsSchema = z.object({
  query: z.string().min(1, "Укажите поисковую фразу").max(300),
  country: z.string().max(100).optional(),
  location: z.string().max(150).optional(),
  currency: z.string().max(10).optional(),
});

export default async function seoRoutes(app: FastifyInstance): Promise<void> {
  // Все эндпоинты требуют авторизации и контекста тенанта
  await app.register(authenticatePlugin);

  const service = new SeoService();

  /**
   * POST /keywords/search
   * Выполнение поиска ключевых слов, кластера, трендов и SERP.
   */
  app.post(
    "/keywords/search",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenant_id } = request;
      const parsed = searchKeywordsSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.errors[0]?.message || "Неверные параметры запроса",
          },
        });
      }

      const result = await service.searchKeywords(tenant_id, parsed.data);
      return reply.send({ data: result });
    },
  );

  /**
   * GET /keywords/trends
   * Тренды спроса за 12 месяцев.
   */
  app.get(
    "/keywords/trends",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenant_id } = request;
      const query = request.query as { q?: string; query?: string; country?: string; location?: string };
      const searchQuery = (query.q || query.query || "soundspeaker rent").trim();

      const trends = await service.getTrends(tenant_id, searchQuery, query.country, query.location);
      return reply.send({ data: trends });
    },
  );

  /**
   * GET /keywords/serp
   * Топ-10 органических результатов выдачи.
   */
  app.get(
    "/keywords/serp",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenant_id } = request;
      const query = request.query as { q?: string; query?: string; country?: string; location?: string };
      const searchQuery = (query.q || query.query || "soundspeaker rent").trim();

      const serp = await service.getSerp(tenant_id, searchQuery, query.country, query.location);
      return reply.send({ data: serp });
    },
  );

  /**
   * GET /recent-searches
   * История недавних поисков текущего тенанта.
   */
  app.get(
    "/recent-searches",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenant_id } = request;
      const items = await service.getRecentSearches(tenant_id);
      return reply.send({ data: items });
    },
  );

  /**
   * DELETE /recent-searches/:id
   * Удаление поискового запроса из истории тенанта.
   */
  app.delete<{ Params: { id: string } }>(
    "/recent-searches/:id",
    async (request, reply) => {
      const { tenant_id } = request;
      const { id } = request.params;
      const ok = await service.deleteRecentSearch(tenant_id, id);
      return reply.send({ data: { success: ok } });
    },
  );
}
