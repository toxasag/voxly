import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { query, queryOne, transaction } from "../../db/client.js";
import { updateTenantSchema } from "./admin.types.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { WhatsappEvolutionService } from "../channels/whatsapp-evolution.service.js";
import { getEnv } from "../../config/env.js";
import { AuthService } from "../auth/auth.service.js";
import { setAuthCookies } from "../auth/auth-cookie.js";

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
      slug: string;
      plan: string;
      status: string;
      custom_price_rubles: number | null;
      custom_plan_name: string | null;
      business_niche: string | null;
      custom_notes: string | null;
      ai_tokens_balance: string;
      ai_balance_kopecks: string;
      ai_markup_percent: string;
      ai_spent_month_kopecks: string;
      subscription_expires_at: Date | string | null;
      created_at: Date | string;
      users_count: string;
      modules_count: string;
      channels_count: string;
      ai_agents_count: string;
      ai_active_agents_count: string;
      knowledge_docs_count: string;
      deals_count: string;
      messages_count: string;
      owner_email: string | null;
      owner_name: string | null;
      owner_phone: string | null;
    }>(
      `SELECT t.id, t.name, t.slug, t.plan, t.status,
          t.custom_price_rubles, t.custom_plan_name, t.business_niche, t.custom_notes,
          t.ai_tokens_balance,
          t.ai_balance_kopecks::text AS ai_balance_kopecks,
          t.ai_markup_percent::text AS ai_markup_percent,
          COALESCE((
            SELECT SUM(charged_kopecks) FROM ai_usage_log l
            WHERE l.tenant_id = t.id AND l.created_at >= date_trunc('month', now())
          ), 0)::text AS ai_spent_month_kopecks,
          t.subscription_expires_at, t.created_at,
          (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS users_count,
          (SELECT count(*) FROM installed_modules m WHERE m.tenant_id = t.id) AS modules_count,
          (SELECT count(*) FROM channel_accounts ca WHERE ca.tenant_id = t.id AND ca.status = 'active') AS channels_count,
          (SELECT count(*) FROM ai_agents a WHERE a.tenant_id = t.id AND a.deleted_at IS NULL) AS ai_agents_count,
          (SELECT count(*) FROM ai_agents a WHERE a.tenant_id = t.id AND a.status = 'active' AND a.deleted_at IS NULL) AS ai_active_agents_count,
          (SELECT count(*) FROM knowledge_base_documents k WHERE k.tenant_id = t.id) AS knowledge_docs_count,
          (SELECT count(*) FROM deals d WHERE d.tenant_id = t.id) AS deals_count,
          (SELECT count(*) FROM deal_messages dm WHERE dm.tenant_id = t.id) AS messages_count,
          (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL ORDER BY (CASE WHEN u.role = 'owner' THEN 0 ELSE 1 END), u.created_at ASC LIMIT 1) AS owner_email,
          (SELECT u.name FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL ORDER BY (CASE WHEN u.role = 'owner' THEN 0 ELSE 1 END), u.created_at ASC LIMIT 1) AS owner_name,
          (SELECT u.phone FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL ORDER BY (CASE WHEN u.role = 'owner' THEN 0 ELSE 1 END), u.created_at ASC LIMIT 1) AS owner_phone
       FROM tenants t
       ORDER BY t.created_at DESC`,
    );

    return reply.send({
      data: rows.map((row) => {
        const channelsCount = Number(row.channels_count || 0);
        const dealsCount = Number(row.deals_count || 0);
        const aiAgentsCount = Number(row.ai_agents_count || 0);
        const aiActiveAgentsCount = Number(row.ai_active_agents_count || 0);
        const knowledgeDocsCount = Number(row.knowledge_docs_count || 0);
        const usersCount = Number(row.users_count || 0);
        const modulesCount = Number(row.modules_count || 0);
        const messagesCount = Number(row.messages_count || 0);

        const adoptionChecklist = {
          has_channels: channelsCount > 0,
          has_deals: dealsCount > 0,
          has_ai: aiAgentsCount > 0,
          has_knowledge: knowledgeDocsCount > 0,
          has_team: usersCount > 1 || modulesCount > 0,
        };

        let passedChecks = 0;
        if (adoptionChecklist.has_channels) passedChecks++;
        if (adoptionChecklist.has_deals) passedChecks++;
        if (adoptionChecklist.has_ai) passedChecks++;
        if (adoptionChecklist.has_knowledge) passedChecks++;
        if (adoptionChecklist.has_team) passedChecks++;

        const adoptionScore = Math.round((passedChecks / 5) * 100);

        let aiStatus: "not_configured" | "paused" | "active" = "not_configured";
        if (aiAgentsCount > 0) {
          aiStatus = aiActiveAgentsCount > 0 ? "active" : "paused";
        }

        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          plan: row.plan,
          status: row.status,
          custom_price_rubles: row.custom_price_rubles !== null ? Number(row.custom_price_rubles) : null,
          custom_plan_name: row.custom_plan_name ?? null,
          business_niche: row.business_niche ?? null,
          custom_notes: row.custom_notes ?? null,
          ai_tokens_balance: Number(row.ai_tokens_balance || 0),
          ai_balance_kopecks: Number(row.ai_balance_kopecks || 0),
          ai_markup_percent: Number(row.ai_markup_percent || 0),
          ai_spent_month_kopecks: Number(row.ai_spent_month_kopecks || 0),
          users_count: usersCount,
          modules_count: modulesCount,
          channels_count: channelsCount,
          ai_agents_count: aiAgentsCount,
          ai_active_agents_count: aiActiveAgentsCount,
          knowledge_docs_count: knowledgeDocsCount,
          deals_count: dealsCount,
          messages_count: messagesCount,
          owner_email: row.owner_email,
          owner_name: row.owner_name,
          owner_phone: row.owner_phone,
          adoption_score: adoptionScore,
          adoption_checklist: adoptionChecklist,
          ai_status: aiStatus,
          subscription_expires_at:
            row.subscription_expires_at === null
              ? null
              : row.subscription_expires_at instanceof Date
                ? row.subscription_expires_at.toISOString()
                : row.subscription_expires_at,
          created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        };
      }),
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
    if (body.custom_price_rubles !== undefined) {
      params.push(body.custom_price_rubles);
      sets.push(`custom_price_rubles = $${params.length}`);
    }
    if (body.custom_plan_name !== undefined) {
      params.push(body.custom_plan_name);
      sets.push(`custom_plan_name = $${params.length}`);
    }
    if (body.business_niche !== undefined) {
      params.push(body.business_niche);
      sets.push(`business_niche = $${params.length}`);
    }
    if (body.custom_notes !== undefined) {
      params.push(body.custom_notes);
      sets.push(`custom_notes = $${params.length}`);
    }

    const RETURN_COLUMNS = `id, name, slug, plan, status, custom_price_rubles,
         custom_plan_name, business_niche, custom_notes, ai_tokens_balance,
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

  app.post("/tenants/:id/impersonate", { onRequest: platformOwner }, async (request, reply) => {
    const tenantId = tenantParams.parse(request.params).id;
    const authService = new AuthService(app);
    const tokens = await authService.impersonateTenant(tenantId, request.authUser.id);
    setAuthCookies(request, reply, tokens);
    return reply.send({ success: true, data: tokens });
  });

  app.delete("/tenants/:id", { onRequest: platformOwner }, async (request, reply) => {
    const tenantId = tenantParams.parse(request.params).id;

    // 1. Проверяем существование тенанта
    const tenant = await queryOne<{ id: string; name: string; slug: string }>(
      "SELECT id, name, slug FROM tenants WHERE id = $1",
      [tenantId],
    );
    if (tenant === null) {
      throw new NotFoundError("Компания не найдена");
    }

    // 2. Защита платформенного арендатора от удаления
    if (tenant.slug === "voxly" || tenant.slug === "platform") {
      throw new AppError(400, "CANNOT_DELETE_PLATFORM_TENANT", "Нельзя удалить платформенную организацию (Voxly Platform)");
    }

    // 3. Защита от удаления компании, под которой авторизован текущий пользователь
    if (request.authUser.tenant_id === tenantId) {
      throw new AppError(400, "CANNOT_DELETE_OWN_TENANT", "Нельзя удалить компанию, в которой вы сейчас авторизованы");
    }

    // 4. Очистка внешних инстансов WhatsApp Evolution API
    try {
      const evoService = new WhatsappEvolutionService();
      if (evoService.isConfigured) {
        const prefix = `wa_${tenantId.replace(/-/g, "").slice(0, 8)}_`;
        const evoHeaders: Record<string, string> = {};
        if (getEnv().EVOLUTION_API_KEY) {
          evoHeaders.apikey = getEnv().EVOLUTION_API_KEY!;
        }
        const evoRes = await fetch(`${getEnv().EVOLUTION_API_URL.replace(/\/$/, "")}/instance/fetchInstances`, {
          headers: evoHeaders,
        });
        if (evoRes.ok) {
          const instances = await evoRes.json();
          const list = Array.isArray(instances) ? instances : [];
          for (const item of list) {
            const name = (item as { name?: string; instanceName?: string })?.name ||
              (item as { name?: string; instanceName?: string })?.instanceName;
            if (typeof name === "string" && name.startsWith(prefix)) {
              await evoService.deleteInstance(name);
            }
          }
        }
      }
    } catch (evoErr) {
      request.log.warn({ err: evoErr, tenantId }, "Failed to clean up Evolution API instances for tenant");
    }

    // 5. Очистка загруженных файлов с диска (uploads)
    try {
      const uploadsDir = path.resolve(process.cwd(), "uploads");
      const files = await fs.readdir(uploadsDir).catch(() => []);
      const tenantPrefix = `${tenantId}_`;
      for (const file of files) {
        if (file.startsWith(tenantPrefix)) {
          await fs.unlink(path.join(uploadsDir, file)).catch(() => {});
        }
      }
    } catch (fsErr) {
      request.log.warn({ err: fsErr, tenantId }, "Failed to clean up uploads for tenant");
    }

    // 6. Полное удаление данных из PostgreSQL в рамках единой транзакции
    await transaction(async (tx) => {
      // Таблицы без внешних ключей, созданные миграциями
      await tx.query("DELETE FROM contacts_company_backfill_0020 WHERE tenant_id = $1", [tenantId]).catch(() => {});

      // Очистка связующих таблиц, задач, заметок, сообщений
      await tx.query("DELETE FROM note_targets WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM task_targets WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM deal_messages WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM deal_stage_history WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM story_posts WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM mailing_stage_rules WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM notes WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM crm_tasks WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM deals WHERE tenant_id = $1", [tenantId]);
      await tx.query(
        "DELETE FROM stages WHERE pipeline_id IN (SELECT id FROM pipelines WHERE tenant_id = $1)",
        [tenantId],
      );
      await tx.query("DELETE FROM pipelines WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM contacts WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM companies WHERE tenant_id = $1", [tenantId]);

      // Сервисный центр
      await tx.query("DELETE FROM repair_photos WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM repair_notes WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM repair_parts WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM repair_works WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM repair_counters WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM device_models WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM repair_orders WHERE tenant_id = $1", [tenantId]);

      // Финансы и биллинг
      await tx.query(
        "DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = $1)",
        [tenantId],
      );
      await tx.query("DELETE FROM invoices WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM transactions WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM cash_accounts WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM finance_categories WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM billing_payments WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM subscriptions WHERE tenant_id = $1", [tenantId]);

      // AI и база знаний
      await tx.query("DELETE FROM knowledge_base_chunks WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM knowledge_base_documents WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM ai_sales_examples WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM ai_agent_channel_bindings WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM ai_usage_log WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM ai_agents WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM ai_balance_topups WHERE tenant_id = $1", [tenantId]);

      // Каналы, авторизация и метаданные
      await tx.query("DELETE FROM telegram_auth_sessions WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM channel_accounts WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM password_reset_tokens WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM refresh_tokens WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM tenant_audit_log WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM module_data_purges WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM installed_modules WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM record_table_layouts WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM page_layout_tabs WHERE tenant_id = $1", [tenantId]);

      // Пользователи и сам арендатор
      await tx.query("DELETE FROM users WHERE tenant_id = $1", [tenantId]);
      await tx.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    });

    request.log.info({ tenantId, tenantName: tenant.name }, "Tenant completely deleted by platform owner");

    return reply.send({
      success: true,
      data: { id: tenant.id, name: tenant.name },
      message: `Компания «${tenant.name}» успешно и полностью удалена`,
    });
  });
}
