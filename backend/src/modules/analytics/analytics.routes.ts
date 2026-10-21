import type { FastifyPluginAsync } from "fastify";
import { AnalyticsService } from "./analytics.service.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const service = new AnalyticsService();

  await app.register(authenticatePlugin);

  /**
   * Сводные показатели аналитики (KPI, PnL, воронка сделок, загрузка мастеров, топ ремонтов)
   */
  app.get("/overview", async (request, reply) => {
    const tenantId = request.tenant_id;
    const data = await service.getOverview(tenantId);
    return reply.send({ data });
  });
};
