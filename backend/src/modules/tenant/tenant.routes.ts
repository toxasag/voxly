import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { queryOne } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { TenantService } from "./tenant.service.js";
import { TeamService } from "./team.service.js";
import { ensureTenantDefaults } from "./tenant-defaults.js";

/**
 * Tenant utility routes, mounted at /api/v1/tenant by app.ts.
 *
 * authenticatePlugin is registered first so the permission-free handlers below
 * still get request.tenant_id from the verified token.
 */

const roleSchema = z.enum(["admin", "manager", "technician", "viewer"]);

const inviteBody = z.object({
  name: z.string().trim().min(2, "Укажите имя сотрудника").max(120),
  email: z.string().trim().toLowerCase().email("Некорректный e-mail"),
  role: roleSchema,
  /**
   * Согласие на платное место. Проверяется на сервере, а не только в модальном
   * окне: запрос можно отправить и минуя интерфейс, и тогда счёт вырос бы без
   * ведома владельца.
   */
  confirm_extra_seat: z.boolean().default(false),
});

const changeRoleBody = z.object({ role: roleSchema });
const userParams = z.object({ id: z.string().uuid() });

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
      trial_ends_at: Date | string | null;
      created_at: Date | string;
    }>(
      `SELECT id, name, slug, plan, status, trial_ends_at, created_at
       FROM tenants WHERE id = $1`,
      [request.tenant_id],
    );

    if (row === null) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Арендатор не найден" } });

    const toIso = (value: Date | string | null): string | null =>
      value === null ? null : value instanceof Date ? value.toISOString() : value;

    const trialEndsAt = toIso(row.trial_ends_at);
    const trialDaysLeft =
      trialEndsAt === null
        ? 0
        : Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000));

    return reply.send({
      data: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        plan: row.plan,
        status: row.status,
        trialEndsAt,
        // Считается на сервере: браузерные часы можно перевести, и клиент
        // показал бы работающий триал после его окончания.
        trialDaysLeft,
        trialActive: trialDaysLeft > 0,
        createdAt: toIso(row.created_at),
      },
    });
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

  app.post("/team/invite", { onRequest: admin }, async (request, reply) => {
    const body = inviteBody.parse(request.body);

    const result = await team.invite({
      tenantId: request.tenant_id,
      actorId: request.authUser.id,
      name: body.name,
      email: body.email,
      role: body.role,
      confirmExtraSeat: body.confirm_extra_seat,
    });

    return reply.status(201).send({ data: result });
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
}
