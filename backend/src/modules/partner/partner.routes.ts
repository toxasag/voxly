import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { queryOne } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import {
  NotFoundError,
  PermissionDeniedError,
  UnauthorizedError,
} from "../../plugins/errorHandler.js";
import { AuthService } from "../auth/auth.service.js";
import {
  setAuthCookies,
  parseCookies,
  REFRESH_COOKIE_NAME,
} from "../auth/auth-cookie.js";
import { getRedisClient, isRedisAvailable } from "../../infrastructure/redis.js";
import { PartnerService } from "./partner.service.js";
import {
  createPartnerTenantSchema,
  updateAuthSettingsSchema,
} from "./partner.types.js";

const paramsWithIdSchema = z.object({
  id: z.string().uuid("Некорректный идентификатор тенанта"),
});

const switchTenantSchema = z
  .object({
    target_tenant_id: z.string().uuid("Некорректный идентификатор целевого тенанта").optional(),
    tenant_id: z.string().uuid("Некорректный идентификатор целевого тенанта").optional(),
    slug: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.target_tenant_id || data.tenant_id || data.slug), {
    message: "Необходимо указать target_tenant_id, tenant_id или slug",
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
    const parentTenantId = request.tenant_is_partner
      ? request.tenant_id
      : (request.impersonator_is_partner && request.impersonator_tenant_id ? request.impersonator_tenant_id : request.tenant_id);
    const result = await service.createChildTenant(parentTenantId, body);
    return reply.status(201).send({ data: result });
  });

  /**
   * GET /api/v1/partner/tenants
   * Список дочерних тенантов партнера
   */
  app.get("/tenants", async (request, reply) => {
    const parentTenantId = request.tenant_is_partner
      ? request.tenant_id
      : (request.impersonator_is_partner && request.impersonator_tenant_id ? request.impersonator_tenant_id : request.tenant_id);
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
    const parentTenantId = request.tenant_is_partner
      ? request.tenant_id
      : (request.impersonator_is_partner && request.impersonator_tenant_id ? request.impersonator_tenant_id : request.tenant_id);
    const result = await service.updateAuthSettings(
      parentTenantId,
      params.id,
      body,
      isPlatformOwner,
    );
    return reply.status(200).send({ data: result });
  });

  /**
   * POST /api/v1/partner/switch-tenant
   * Безопасное переключение партнера в пространство клиента/субпартнера
   */
  app.post("/switch-tenant", async (request, reply) => {
    const body = switchTenantSchema.parse(request.body);
    const targetTenantId = body.target_tenant_id || body.tenant_id;

    let targetTenant: {
      id: string;
      name: string;
      slug: string;
      parent_tenant_id: string | null;
      owner_partner_id: string | null;
    } | null = null;

    if (targetTenantId) {
      targetTenant = await queryOne(
        `SELECT id, name, slug, parent_tenant_id, owner_partner_id FROM tenants WHERE id = $1`,
        [targetTenantId],
      );
    } else if (body.slug) {
      targetTenant = await queryOne(
        `SELECT id, name, slug, parent_tenant_id, owner_partner_id FROM tenants WHERE lower(slug) = lower($1)`,
        [body.slug.trim()],
      );
    }

    if (!targetTenant) {
      throw new NotFoundError("Компания не найдена");
    }

    const callerUser = request.authUser;
    const isPlatformOwner =
      callerUser.platform_role === "platform_owner" ||
      request.impersonator_platform_role === "platform_owner";

    const partnerTenantId = request.tenant_is_partner
      ? request.tenant_id
      : (request.impersonator_tenant_id || request.tenant_id);

    // Проверка доступа по рекурсивному дереву потомков
    if (!isPlatformOwner) {
      const check = await queryOne<{ is_descendant: boolean }>(
        `SELECT is_tenant_descendant($1, $2) AS is_descendant`,
        [partnerTenantId, targetTenant.id],
      );
      if (!check?.is_descendant) {
        throw new PermissionDeniedError(
          "Недостаточно прав для переключения в этот тенант: тенант не входит в партнерскую иерархию",
        );
      }
    }

    const actorId = isPlatformOwner
      ? (callerUser.platform_role === "platform_owner"
          ? callerUser.id
          : request.impersonator_id || callerUser.id)
      : request.impersonator_id || callerUser.id;

    if (!actorId) {
      throw new UnauthorizedError("Не удалось определить идентификатор администратора или партнера");
    }

    const authService = new AuthService(app);
    const tokens = await authService.impersonateTenant(targetTenant.id, actorId);
    setAuthCookies(request, reply, tokens);

    // Фиксация сессии переключения в Redis для быстрого аудита и статуса
    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        const sessionKey = `partner:switch:${actorId}:${targetTenant.id}`;
        await redis.set(
          sessionKey,
          JSON.stringify({
            actor_id: actorId,
            original_tenant_id: partnerTenantId,
            acting_tenant_id: targetTenant.id,
            switched_at: new Date().toISOString(),
          }),
          "EX",
          86400,
        );
      } catch {
        // Ошибка Redis не должна ломать переключение
      }
    }

    const cookies = parseCookies(request.headers.cookie);
    const adminRefreshToken = cookies[REFRESH_COOKIE_NAME] || cookies["getvoxly_refresh_token"] || "";
    const adminAccessToken = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");

    return reply.send({
      success: true,
      data: {
        ...tokens,
        acting_tenant_id: targetTenant.id,
        original_tenant_id: partnerTenantId,
        admin_refresh_token: adminRefreshToken,
        admin_access_token: adminAccessToken,
        admin_user: {
          id: actorId,
          email: callerUser.email,
          name: callerUser.name,
        },
      },
    });
  });

  /**
   * POST /api/v1/partner/revert-tenant
   * Возврат из клиентского портала в исходный кабинет партнера
   */
  app.post("/revert-tenant", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, unknown>;
    const adminRefreshToken =
      (typeof body.admin_refresh_token === "string" ? body.admin_refresh_token : undefined) ||
      cookies[REFRESH_COOKIE_NAME] ||
      cookies["getvoxly_refresh_token"];
    const adminAccessToken =
      (typeof body.admin_access_token === "string" ? body.admin_access_token : undefined) ||
      (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    // Используем только криптографически проверенный impersonator_id из текущей сессии
    const impersonatorId = request.impersonator_id;

    const authService = new AuthService(app);
    const tokens = await authService.exitImpersonation(
      {
        adminRefreshToken,
        adminAccessToken,
        cookieRefreshToken: cookies[REFRESH_COOKIE_NAME] || cookies["getvoxly_refresh_token"],
        impersonatorId,
      },
      {
        userAgent: request.headers["user-agent"],
        ip: request.ip,
      },
    );

    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis && impersonatorId) {
      try {
        const keys = await redis.keys(`partner:switch:${impersonatorId}:*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch {
        // неблокирующий
      }
    }

    setAuthCookies(request, reply, tokens);
    return reply.send({
      success: true,
      data: tokens,
    });
  });
};

export default partnerRoutes;
