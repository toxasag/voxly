import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { PermissionDeniedError } from "../../plugins/errorHandler.js";
import { PartnerService } from "./partner.service.js";
import {
  createPartnerTenantSchema,
  updateAuthSettingsSchema,
} from "./partner.types.js";

const paramsWithIdSchema = z.object({
  id: z.string().uuid("Некорректный идентификатор тенанта"),
});

export const partnerRoutes: FastifyPluginAsync = async (app) => {
  const service = new PartnerService();

  // Все маршруты партнерского модуля требуют авторизации
  await app.register(authenticatePlugin);

  // Проверка партнерских прав: роль partner, флаг is_partner, tenant_is_partner или платформенный владелец
  app.addHook("onRequest", async (request) => {
    const user = request.authUser;
    const isPartner =
      user.platform_role === "platform_owner" ||
      user.is_partner === true ||
      user.role === "partner" ||
      request.tenant_is_partner === true ||
      request.impersonator_is_partner === true;

    if (!isPartner) {
      throw new PermissionDeniedError("Доступ к партнерскому модулю разрешен только партнерам и администраторам платформы");
    }
  });

  /**
   * POST /api/v1/partner/tenants
   * Создание дочерней компании (портала)
   */
  app.post("/tenants", async (request, reply) => {
    const body = createPartnerTenantSchema.parse(request.body);
    const parentTenantId = request.impersonator_tenant_id || request.tenant_id;
    const result = await service.createChildTenant(parentTenantId, body);
    return reply.status(201).send({ data: result });
  });

  /**
   * GET /api/v1/partner/tenants
   * Список дочерних тенантов партнера
   */
  app.get("/tenants", async (request, reply) => {
    const parentTenantId = request.impersonator_tenant_id || request.tenant_id;
    const list = await service.listChildTenants(parentTenantId);
    return reply.status(200).send({ data: list });
  });

  /**
   * PATCH /api/v1/partner/tenants/:id/auth-settings
   * Переключение политик аутентификации дочернего портала (вкл/выкл обязательный Telegram)
   */
  app.patch("/tenants/:id/auth-settings", async (request, reply) => {
    const params = paramsWithIdSchema.parse(request.params);
    const body = updateAuthSettingsSchema.parse(request.body);
    const isPlatformOwner = request.authUser.platform_role === "platform_owner";
    const parentTenantId = request.impersonator_tenant_id || request.tenant_id;
    const result = await service.updateAuthSettings(
      parentTenantId,
      params.id,
      body,
      isPlatformOwner,
    );
    return reply.status(200).send({ data: result });
  });
};

export default partnerRoutes;
