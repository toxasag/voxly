import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ALL_PERMISSIONS } from "../../config/permissions.js";
import type { Permission } from "../../types/index.js";
import { query, queryOne, type SqlParam } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { TenantService } from "./tenant.service.js";
import { TeamService } from "./team.service.js";
import { ensureTenantDefaults } from "./tenant-defaults.js";
import { quotaService } from "../quotas/quota.service.js";
import { recordClientErrorAction } from "../../lib/audit-log.service.js";

/**
 * Tenant utility routes, mounted at /api/v1/tenant by app.ts.
 *
 * authenticatePlugin is registered first so the permission-free handlers below
 * still get request.tenant_id from the verified token.
 */

const roleSchema = z.enum(["admin", "manager", "technician", "viewer"]);

const inviteBody = z
  .object({
    name: z.string().trim().min(2, "Укажите имя сотрудника").max(120),
    email: z.string().trim().toLowerCase().email("Некорректный e-mail").optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    role: roleSchema,
    /**
     * Согласие на платное место. Проверяется на сервере, а не только в модальном
     * окне: запрос можно отправить и минуя интерфейс, и тогда счёт вырос бы без
     * ведома владельца.
     */
    confirm_extra_seat: z.boolean().default(false),
  })
  .refine(
    (data) => Boolean((data.email && data.email.length > 0) || (data.phone && data.phone.replace(/\D/g, "").length >= 10)),
    {
      message: "Укажите e-mail или номер телефона сотрудника (от 10 цифр)",
      path: ["email"],
    },
  );

const permissionSchema = z.enum([...ALL_PERMISSIONS] as [Permission, ...Permission[]]);

const changeRoleBody = z.object({
  role: roleSchema,
  permissions: z.array(permissionSchema).optional(),
});
const userParams = z.object({ id: z.string().uuid() });

const updateInfoBody = z.object({
  name: z.string().trim().min(1, "Название компании не может быть пустым").max(100).optional(),
  business_niche: z.string().trim().max(255).optional().nullable(),
});

export default async function tenantRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new TenantService();
  const team = new TeamService();

  // GET /tenant/users — catalog for assignee/manager pickers.
  // Any authenticated tenant member may read it; no extra permission gate,
  // consistent with needing it to render CRM pickers.
  app.get("/users", async (request, reply) => {
    const users = await service.listUsers(request.tenant_id);
    return reply.send({ data: users, meta: { total: users.length } });
  });

  // GET /tenant/modules — источник истины для Sidebar и клиентских Guard.
  // Любой аутентифицированный член арендатора может увидеть доступные ему
  // разделы; изменение состава остаётся под tenant:admin в marketplace routes.
  app.get("/modules", async (request, reply) => {
    const modules = await service.listModules(request.tenant_id);
    return reply.send({ data: modules, meta: { total: modules.length } });
  });

  /**
   * GET /tenant/info — план, статус и остаток пробного периода аккаунта.
   *
   * Нужен странице биллинга: `tenants.trial_ends_at` прежде не был доступен
   * арендатору вообще — его отдавал только платформенный `/admin/tenants` под
   * `requirePlatformOwner`, поэтому «осталось X дней» показать было нечем.
   * Доступен любому члену арендатора: это его собственная подписка, а не
   * чужие данные.
   */
  app.get("/info", async (request, reply) => {
    const row = await queryOne<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      status: string;
      custom_price_rubles: number | null;
      custom_plan_name: string | null;
      trial_ends_at: Date | string | null;
      is_partner: boolean;
      created_at: Date | string;
    }>(
      `SELECT id, name, slug, plan, status, custom_price_rubles, custom_plan_name, trial_ends_at, is_partner, created_at
       FROM tenants WHERE id = $1`,
      [request.tenant_id],
    );

    if (row === null) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Арендатор не найден" } });

    const toIso = (value: Date | string | null): string | null =>
      value === null ? null : value instanceof Date ? value.toISOString() : value;

    const hasCustomPrice = row.custom_price_rubles !== null && row.custom_price_rubles !== undefined;
    const isFreeCustomPlan = (hasCustomPrice && Number(row.custom_price_rubles) === 0) || row.plan === "custom_free";
    const isPartner = Boolean(row.is_partner || row.plan === "partner" || request.authUser?.is_partner);
    const isTrialAccount = (row.plan === "trial" || row.status === "trial") && !isFreeCustomPlan && !isPartner;

    const rawTrialEndsAt = toIso(row.trial_ends_at);
    const rawTrialDaysLeft =
      rawTrialEndsAt === null
        ? 0
        : Math.max(0, Math.ceil((new Date(rawTrialEndsAt).getTime() - Date.now()) / 86_400_000));

    // Считается на сервере: для активных, партнёрских и кастомных бесплатных аккаунтов
    // триал не действует, даже если в БД сохранилась старая дата триала от регистрации.
    const trialActive = isTrialAccount && rawTrialDaysLeft > 0;
    const trialDaysLeft = trialActive ? rawTrialDaysLeft : 0;
    const trialEndsAt = trialActive ? rawTrialEndsAt : null;

    let customPlanName: string | null = null;
    if (hasCustomPrice || isPartner) {
      if (row.custom_plan_name && row.custom_plan_name !== "Индивидуальный") {
        customPlanName = row.custom_plan_name;
      } else {
        customPlanName = isPartner ? "Партнёрский тариф" : "Индивидуальный";
      }
    }
    const customPriceRubles = hasCustomPrice ? Number(row.custom_price_rubles) : null;

    return reply.send({
      data: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        plan: row.plan,
        status: row.status,
        trialEndsAt,
        trialDaysLeft,
        trialActive,
        createdAt: toIso(row.created_at),
        customPriceRubles,
        customPlanName: (hasCustomPrice || isPartner) ? customPlanName : null,
        isCustomPlan: hasCustomPrice || isPartner,
        isFreeCustomPlan,
        isPartner,
      },
    });
  });

  /**
   * PATCH /tenant/info — обновление названия компании и бизнес-ниши арендатора.
   * Доступно администраторам арендатора (tenant:admin).
   */
  app.patch("/info", { onRequest: app.requirePermission("tenant:admin") }, async (request, reply) => {
    const body = updateInfoBody.parse(request.body);
    const updates: string[] = [];
    const values: SqlParam[] = [];
    let idx = 1;

    if (body.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(body.name);
    }
    if (body.business_niche !== undefined) {
      updates.push(`business_niche = $${idx++}`);
      values.push(body.business_niche);
    }

    if (updates.length === 0) {
      return reply.send({ message: "Нет данных для обновления" });
    }

    updates.push(`updated_at = now()`);
    values.push(request.tenant_id);

    const updated = await queryOne<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      status: string;
      business_niche: string | null;
    }>(
      `UPDATE tenants SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id, name, slug, plan, status, business_niche`,
      values,
    );

    return reply.send({ data: updated });
  });

  /**
   * GET /tenant/workspaces — список доступных рабочих пространств для переключения.
   * Возвращает текущее пространство, родительскую организацию (если портал дочерний)
   * и все дочерние компании (для партнеров и суперадминов платформы).
   */
  app.get("/workspaces", async (request, reply) => {
    const currentTenantId = request.tenant_id;
    const user = request.authUser;
    const isPlatformOwner = user.platform_role === "platform_owner";
    const isPartner =
      isPlatformOwner ||
      user.is_partner === true ||
      user.role === "partner" ||
      request.tenant_is_partner === true ||
      request.impersonator_is_partner === true;

    const currentTenant = await queryOne<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      status: string;
      parent_tenant_id: string | null;
      owner_partner_id: string | null;
      is_partner: boolean;
    }>(
      "SELECT id, name, slug, plan, status, parent_tenant_id, owner_partner_id, is_partner FROM tenants WHERE id = $1",
      [currentTenantId],
    );

    if (!currentTenant) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Арендатор не найден" } });
    }

    const workspaces: Array<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      status: string;
      is_current: boolean;
      is_parent: boolean;
      role: string;
      is_partner: boolean;
    }> = [];

    workspaces.push({
      id: currentTenant.id,
      name: currentTenant.name,
      slug: currentTenant.slug,
      plan: currentTenant.plan,
      status: currentTenant.status,
      is_current: true,
      is_parent: false,
      role: user.role,
      is_partner: Boolean(currentTenant.is_partner),
    });

    const parentTenantRef = currentTenant.owner_partner_id ?? currentTenant.parent_tenant_id;
    if (parentTenantRef) {
      const parentTenant = await queryOne<{
        id: string;
        name: string;
        slug: string;
        plan: string;
        status: string;
        is_partner: boolean;
      }>(
        "SELECT id, name, slug, plan, status, is_partner FROM tenants WHERE id = $1",
        [parentTenantRef],
      );
      if (parentTenant) {
        workspaces.push({
          id: parentTenant.id,
          name: parentTenant.name,
          slug: parentTenant.slug,
          plan: parentTenant.plan,
          status: parentTenant.status,
          is_current: false,
          is_parent: true,
          role: "owner",
          is_partner: Boolean(parentTenant.is_partner),
        });
      }
    }

    if (isPartner) {
      const parentIdForChildren = currentTenant.is_partner
        ? currentTenant.id
        : (currentTenant.owner_partner_id ??
           currentTenant.parent_tenant_id ??
           ((request.impersonator_is_partner && request.impersonator_tenant_id) || currentTenant.id));
      interface ChildTenantRow {
        id: string;
        name: string;
        slug: string;
        plan: string;
        status: string;
        parent_tenant_id: string | null;
        owner_partner_id: string | null;
        is_partner: boolean;
      }
      const childRows = await query<ChildTenantRow>(
        `SELECT id, name, slug, plan, status, parent_tenant_id, owner_partner_id, is_partner
         FROM tenants
         WHERE (parent_tenant_id = $1 OR owner_partner_id = $1) AND id != $2
         ORDER BY name ASC`,
        [parentIdForChildren, currentTenant.id],
      );

      for (const child of childRows) {
        workspaces.push({
          id: child.id,
          name: child.name,
          slug: child.slug,
          plan: child.plan,
          status: child.status,
          is_current: false,
          is_parent: false,
          role: "partner",
          is_partner: Boolean(child.is_partner),
        });
      }
    }

    return reply.send({ data: workspaces, meta: { total: workspaces.length } });
  });

  /**
   * GET /api/v1/tenant/quotas/current
   * Получение лимитов и квот текущего тенанта
   */
  app.get("/quotas/current", async (request, reply) => {
    const quotas = await quotaService.getTenantQuotas(request.tenant_id);
    return reply.send({ data: quotas });
  });

  // -------------------------------------------------------------------------
  // Управление сотрудниками. tenant:admin: состав команды и стоимость мест —
  // тарифное решение арендатора, а не рядового пользователя.
  // -------------------------------------------------------------------------
  const admin = app.requirePermission("tenant:admin");

  app.get("/team", { onRequest: admin }, async (request, reply) => {
    const data = await team.list(request.tenant_id, request.authUser.id);
    return reply.send({ data });
  });

  app.get("/team/invites", { onRequest: admin }, async (request, reply) => {
    const data = await team.listPendingInvites(request.tenant_id);
    return reply.send({ data });
  });

  app.get("/invites", { onRequest: admin }, async (request, reply) => {
    const data = await team.listPendingInvites(request.tenant_id);
    return reply.send({ data });
  });

  const handleInvite = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = inviteBody.parse(request.body);

    const result = await team.invite({
      tenantId: request.tenant_id,
      actorId: request.authUser.id,
      name: body.name,
      email: body.email,
      phone: body.phone,
      role: body.role,
      confirmExtraSeat: body.confirm_extra_seat,
    });

    return reply.status(201).send({ data: result });
  };

  app.post("/team/invite", { onRequest: admin }, handleInvite);
  app.post("/team/invites", { onRequest: admin }, handleInvite);

  app.delete("/team/invites/:id", { onRequest: admin }, async (request, reply) => {
    const { id } = userParams.parse(request.params);
    const result = await team.revokeInvite({ tenantId: request.tenant_id, userId: id });
    return reply.send({ data: result });
  });

  app.post("/team/invites/:id/resend", { onRequest: admin }, async (request, reply) => {
    const { id } = userParams.parse(request.params);
    const result = await team.resendInvite({ tenantId: request.tenant_id, userId: id });
    return reply.send({ data: result });
  });

  app.post("/team/:id/resend", { onRequest: admin }, async (request, reply) => {
    const { id } = userParams.parse(request.params);
    const result = await team.resendInvite({ tenantId: request.tenant_id, userId: id });
    return reply.send({ data: result });
  });

  app.patch("/team/:id", { onRequest: admin }, async (request, reply) => {
    const { id } = userParams.parse(request.params);
    const body = changeRoleBody.parse(request.body);

    const member = await team.changeRole({
      tenantId: request.tenant_id,
      actorId: request.authUser.id,
      userId: id,
      role: body.role,
      permissions: body.permissions,
    });

    return reply.send({ data: member });
  });

  app.delete("/team/:id", { onRequest: admin }, async (request, reply) => {
    const { id } = userParams.parse(request.params);

    const result = await team.remove({
      tenantId: request.tenant_id,
      actorId: request.authUser.id,
      userId: id,
    });

    return reply.send({ data: result });
  });

  // POST /tenant/defaults — idempotently provision the default pipeline, cash
  // account and finance categories. Lets the frontend bootstrap an empty tenant
  // (e.g. after onboarding) without a manual DB step. tenant:admin only: it
  // writes tenant-wide structural data.
  app.post("/defaults", { onRequest: app.requirePermission("tenant:admin") }, async (request, reply) => {
    const result = await ensureTenantDefaults(request.tenant_id);
    return reply.send({ data: result });
  });

  // GET /tenant/audit-log — журнал действий пользователей и ошибок текущего тенанта
  app.get("/audit-log", { onRequest: admin }, async (request, reply) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        action: z.string().max(100).optional(),
        errors_only: z.coerce.boolean().optional().default(false),
        user_id: z.string().uuid().optional(),
      })
      .parse(request.query);

    const conditions: string[] = ["l.tenant_id = $1"];
    const params: (string | number)[] = [request.tenant_id];

    if (q.action && q.action.trim()) {
      params.push(`%${q.action.trim()}%`);
      conditions.push(`l.action ILIKE $${params.length}`);
    }
    if (q.errors_only) {
      conditions.push(`(l.action LIKE '%.error' OR l.action = 'client.api_error' OR COALESCE((l.details->>'statusCode')::int, 200) >= 400)`);
    }
    if (q.user_id) {
      params.push(q.user_id);
      conditions.push(`l.actor_user_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const totalRow = await queryOne<{ total: string }>(
      `SELECT count(*)::text AS total FROM tenant_audit_log l ${where}`,
      params,
    );

    params.push(q.limit, q.offset);

    const rows = await query<{
      id: string;
      actor_user_id: string | null;
      actor_name: string | null;
      actor_email: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      details: Record<string, unknown>;
      created_at: Date | string;
    }>(
      `SELECT l.id, l.actor_user_id, u.name AS actor_name, u.email AS actor_email,
              l.action, l.entity_type, l.entity_id, l.details, l.created_at
       FROM tenant_audit_log l
       LEFT JOIN users u ON u.id = l.actor_user_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name,
        actorEmail: r.actor_email,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details: r.details,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      })),
      meta: { limit: q.limit, offset: q.offset, total: Number(totalRow?.total ?? 0) },
    });
  });

  // POST /tenant/audit-log/client-error — фиксация клиентских ошибок API/парсинга в журнале тенанта
  app.post("/audit-log/client-error", async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(100),
        message: z.string().min(1).max(1000),
        method: z.string().max(16).optional(),
        url: z.string().max(500).optional(),
        statusCode: z.number().int().optional(),
        page: z.string().max(500).optional(),
      })
      .parse(request.body);

    await recordClientErrorAction({
      tenantId: request.tenant_id,
      actorUserId: request.authUser?.id ?? null,
      code: body.code,
      message: body.message,
      method: body.method,
      url: body.url,
      statusCode: body.statusCode,
      page: body.page,
      ip: request.ip,
    });

    return reply.status(201).send({ data: { logged: true } });
  });
}
