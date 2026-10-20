import type { FastifyPluginAsync } from "fastify";
import { AnalyticsService } from "./analytics.service.js";
import { requireTenantId } from "../../plugins/request-context.js";

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const service = new AnalyticsService();

  app.addHook("onRequest", app.authenticate);

  /**
   * Сводные показатели аналитики (KPI, PnL, воронка сделок, загрузка мастеров, топ ремонтов)
   */
  app.get("/overview", async (request, reply) => {
    const tenantId = requireTenantId();
    const data = await service.getOverview(tenantId);
    return reply.send({ data });
  });
};
