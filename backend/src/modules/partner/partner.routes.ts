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

  // Проверка партнерских прав: роль partner, owner, admin, наличие права tenant:admin или платформенный владелец
  app.addHook("onRequest", async (request) => {
    const user = request.authUser;
    const isPartner =
      user.role === "partner" ||
      user.role === "owner" ||
      user.role === "admin" ||
      user.platform_role === "platform_owner" ||
      request.permissions.has("tenant:admin");

    if (!isPartner) {
      throw new PermissionDeniedError("Доступ к партнерскому модулю разрешен только партнерам и администраторам");
    }
  });

  /**
   * POST /api/v1/partner/tenants
   * Создание дочерней компании (портала)
   */
  app.post("/tenants", async (request, reply) => {
    const body = createPartnerTenantSchema.parse(request.body);
    const result = await service.createChildTenant(request.tenant_id, body);
    return reply.status(201).send({ data: result });
  });

  /**
   * GET /api/v1/partner/tenants
   * Список дочерних тенантов партнера
   */
  app.get("/tenants", async (request, reply) => {
    const list = await service.listChildTenants(request.tenant_id);
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
    const result = await service.updateAuthSettings(
      request.tenant_id,
      params.id,
      body,
      isPlatformOwner,
    );
    return reply.status(200).send({ data: result });
  });
};

export default partnerRoutes;
