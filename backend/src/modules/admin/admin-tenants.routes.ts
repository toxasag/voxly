import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../db/client.js";
import { updateTenantSchema } from "./admin.types.js";
import { NotFoundError } from "../../plugins/errorHandler.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";

const tenantParams = z.object({ id: z.string().uuid() });

/**
 * Platform admin route group, mounted at /api/v1/admin by app.ts.
 *
 * Гейт — глобальная платформенная роль (users.platform_role), а не тенантная
 * роль owner: иначе владелец каждого тенанта получал бы доступ ко всей
 * платформе. См. plugins/authorize.ts requirePlatformOwner.
 */
export default async function adminTenantRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const platformOwner = app.requirePlatformOwner();

  app.get("/tenants", { onRequest: platformOwner }, async (_request, reply) => {
    const rows = await query<{
      id: string;
      name: string;
      plan: string;
      status: string;
      ai_tokens_balance: string;
      ai_balance_kopecks: string;
      ai_markup_percent: string;
      ai_spent_month_kopecks: string;
      subscription_expires_at: Date | string | null;
      created_at: Date | string;
      users_count: string;
      modules_count: string;
    }>(
      `SELECT t.id, t.name, t.plan, t.status, t.ai_tokens_balance,
          t.ai_balance_kopecks::text AS ai_balance_kopecks,
          t.ai_markup_percent::text AS ai_markup_percent,
          COALESCE((
            SELECT SUM(charged_kopecks) FROM ai_usage_log l
            WHERE l.tenant_id = t.id AND l.created_at >= date_trunc('month', now())
          ), 0)::text AS ai_spent_month_kopecks,
          t.subscription_expires_at, t.created_at,
          (SELECT count(*) FROM users u WHERE u.tenant_id = t.id) AS users_count,
          (SELECT count(*) FROM installed_modules m WHERE m.tenant_id = t.id) AS modules_count
       FROM tenants t
       ORDER BY t.created_at DESC`,
    );

    return reply.send({
      data: rows.map((row) => ({
        ...row,
        ai_tokens_balance: Number(row.ai_tokens_balance),
        ai_balance_kopecks: Number(row.ai_balance_kopecks),
        ai_markup_percent: Number(row.ai_markup_percent),
        ai_spent_month_kopecks: Number(row.ai_spent_month_kopecks),
        users_count: Number(row.users_count),
        modules_count: Number(row.modules_count),
        subscription_expires_at:
          row.subscription_expires_at === null
            ? null
            : row.subscription_expires_at instanceof Date
              ? row.subscription_expires_at.toISOString()
              : row.subscription_expires_at,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      })),
    });
  });

  app.patch("/tenants/:id", { onRequest: platformOwner }, async (request, reply) => {
    const tenantId = tenantParams.parse(request.params).id;
    const body = updateTenantSchema.parse(request.body);
    const sets: string[] = [];
    const params: (string | number | null)[] = [tenantId];

    if (body.status !== undefined) {
      params.push(body.status);
      sets.push(`status = $${params.length}`);
    }
    if (body.plan !== undefined) {
      params.push(body.plan);
      sets.push(`plan = $${params.length}`);
    }
    if (body.subscription_expires_at !== undefined) {
      params.push(body.subscription_expires_at);
      sets.push(`subscription_expires_at = $${params.length}`);
    }
    if (body.ai_tokens_balance !== undefined) {
      params.push(body.ai_tokens_balance);
      sets.push(`ai_tokens_balance = $${params.length}`);
    }
    if (body.ai_markup_percent !== undefined) {
      params.push(body.ai_markup_percent);
      sets.push(`ai_markup_percent = $${params.length}`);
    }
    if (body.ai_balance_rubles !== undefined) {
      // Рубли переводятся в копейки здесь: наружу денежные суммы отдаются и
      // принимаются в рублях, внутри хранятся целыми копейками.
      params.push(Math.round(body.ai_balance_rubles * 100));
      sets.push(`ai_balance_kopecks = $${params.length}`);
    }

    const RETURN_COLUMNS = `id, name, plan, status, ai_tokens_balance,
         ai_balance_kopecks::text AS ai_balance_kopecks,
         ai_markup_percent::text AS ai_markup_percent,
         subscription_expires_at`;

    if (sets.length === 0) {
      const existing = await queryOne(
        `SELECT ${RETURN_COLUMNS} FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if (existing === null) throw new NotFoundError("Tenant not found");
      return reply.send({ data: existing });
    }

    const row = await queryOne(
      `UPDATE tenants SET ${sets.join(", ")}
       WHERE id = $1
       RETURNING ${RETURN_COLUMNS}`,
      params,
    );
    if (row === null) throw new NotFoundError("Tenant not found");

    await query(
      `INSERT INTO tenant_audit_log
         (tenant_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'tenant.update', 'tenant', $3, $4::jsonb)`,
      [tenantId, request.authUser.id, tenantId, JSON.stringify(body)],
    );

    return reply.send({ data: row });
  });
}
