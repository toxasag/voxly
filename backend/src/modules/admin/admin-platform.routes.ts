import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { EmailService } from "../../services/email.service.js";

// ---------------------------------------------------------------------------
// Платформенные разделы: тарифы/биллинг и системные логи.
//
// Все маршруты закрыты гейтом requirePlatformOwner (users.platform_role), а не
// тенантной ролью owner: иначе владелец любого арендатора видел бы данные всей
// платформы. Гейт дополнительно переводит запрос в platform_scope, поэтому
// RLS-политики разрешают чтение по всем арендаторам.
// ---------------------------------------------------------------------------

interface PlanRow {
  plan: string;
  tenants: string;
  active: string;
  trial: string;
  past_due: string;
  suspended: string;
  ai_tokens: string;
}

interface AuditRow {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: Date | string;
}

/**
 * Прайс-лист планов.
 *
 * Держится в коде, а не в БД: таблицы `plans`/`subscriptions` ещё не созданы
 * (задача M5.2.7), и выдумывать под них схему на ходу означало бы расхождение
 * с документацией. Здесь только суммы для отображения — источником правды о
 * плане арендатора остаётся `tenants.plan`.
 */
const PLAN_PRICES: Record<string, number> = {
  trial: 0,
  starter: 2990,
  business: 6990,
  enterprise: 14990,
};

const logsQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  tenant_id: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
});

/**
 * Тело проверки почты. Адрес необязателен: по умолчанию письмо уходит на
 * e-mail самого владельца платформы, чтобы диагностический эндпоинт нельзя
 * было использовать как отправщик писем на произвольные адреса.
 */
const testEmailBody = z
  .object({ to: z.string().trim().toLowerCase().email("Некорректный e-mail").optional() })
  .default({});

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export default async function adminPlatformRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const platformOwner = app.requirePlatformOwner();

  /**
   * Health-check почтового сервиса: сначала проверка соединения и авторизации,
   * затем реальное письмо.
   *
   * Возвращает ошибку при отказе SMTP, в отличие от приветственного письма при
   * регистрации: цель эндпоинта — узнать фактическое состояние транспорта, а
   * не выполнить операцию несмотря на сбой.
   */
  app.post("/test-email", { onRequest: platformOwner }, async (request, reply) => {
    const body = testEmailBody.parse(request.body ?? {});
    const recipient = body.to ?? request.authUser.email;

    const connection = await EmailService.verifyConnection();

    if (!connection.sent) {
      return reply.status(502).send({
        status: "error",
        error: {
          code: "SMTP_UNAVAILABLE",
          message: `SMTP недоступен: ${connection.error ?? "неизвестная ошибка"}`,
        },
      });
    }

    const result = await EmailService.sendTestEmail(recipient);

    if (!result.sent) {
      return reply.status(502).send({
        status: "error",
        error: {
          code: "SMTP_SEND_FAILED",
          message: `Не удалось отправить письмо: ${result.error ?? "неизвестная ошибка"}`,
        },
      });
    }

    return reply.send({
      data: {
        sent: true,
        to: recipient,
        messageId: result.messageId ?? null,
        connectionVerified: true,
      },
    });
  });

  /**
   * Сводка по тарифам: сколько арендаторов на каждом плане и оценка выручки.
   *
   * MRR считается как сумма прайса по активным арендаторам. Это оценка, а не
   * биллинговая правда: реальных платежей в системе ещё нет, поэтому поле
   * помечено `estimated`, чтобы цифру не приняли за факт.
   */
  app.get("/billing", { onRequest: platformOwner }, async (_request, reply) => {
    const rows = await query<PlanRow>(
      `SELECT plan,
              count(*)::text AS tenants,
              count(*) FILTER (WHERE status = 'active')::text AS active,
              count(*) FILTER (WHERE status = 'trial')::text AS trial,
              count(*) FILTER (WHERE status = 'past_due')::text AS past_due,
              count(*) FILTER (WHERE status = 'suspended')::text AS suspended,
              COALESCE(SUM(ai_tokens_balance), 0)::text AS ai_tokens
       FROM tenants
       GROUP BY plan
       ORDER BY plan`,
    );

    const plans = rows.map((row) => {
      const price = PLAN_PRICES[row.plan] ?? 0;
      const active = Number(row.active);

      return {
        plan: row.plan,
        priceMonthly: price,
        tenants: Number(row.tenants),
        active,
        trial: Number(row.trial),
        pastDue: Number(row.past_due),
        suspended: Number(row.suspended),
        aiTokensBalance: Number(row.ai_tokens),
        estimatedMonthly: price * active,
      };
    });

    return reply.send({
      data: {
        plans,
        totals: {
          tenants: plans.reduce((sum, p) => sum + p.tenants, 0),
          active: plans.reduce((sum, p) => sum + p.active, 0),
          estimatedMrr: plans.reduce((sum, p) => sum + p.estimatedMonthly, 0),
        },
        // Явный признак: платёжный провайдер не подключён (M5.2.6/M5.2.10).
        billingProvider: { connected: false, provider: null },
      },
    });
  });

  /**
   * Системные логи — записи `tenant_audit_log` по всем арендаторам.
   *
   * Логи приложения (pino) пишутся в stdout контейнера и здесь недоступны:
   * агрегатора нет, а читать файлы контейнера из HTTP-обработчика небезопасно.
   * Поэтому раздел показывает аудит действий, а не поток stdout.
   */
  app.get("/logs", { onRequest: platformOwner }, async (request, reply) => {
    const { limit, offset, tenant_id, action } = logsQuery.parse(request.query);

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (tenant_id !== undefined) {
      params.push(tenant_id);
      conditions.push(`l.tenant_id = $${params.length}`);
    }

    if (action !== undefined && action.length > 0) {
      params.push(`%${action}%`);
      conditions.push(`l.action ILIKE $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = await queryOne<{ total: string }>(
      `SELECT count(*)::text AS total FROM tenant_audit_log l ${where}`,
      params,
    );

    params.push(limit, offset);

    const rows = await query<AuditRow>(
      `SELECT l.id, l.tenant_id, t.name AS tenant_name, l.actor_user_id,
              u.email AS actor_email, l.action, l.entity_type, l.entity_id,
              l.details, l.created_at
       FROM tenant_audit_log l
       LEFT JOIN tenants t ON t.id = l.tenant_id
       LEFT JOIN users u ON u.id = l.actor_user_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return reply.send({
      data: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        actorUserId: row.actor_user_id,
        actorEmail: row.actor_email,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        details: row.details,
        createdAt: toIso(row.created_at),
      })),
      meta: { limit, offset, total: Number(totalRow?.total ?? 0) },
    });
  });

  /**
   * Каталог модулей маркетплейса с ценами для настройки супер-админом.
   */
  app.get("/marketplace/modules", { onRequest: platformOwner }, async (_request, reply) => {
    const rows = await query<{
      slug: string;
      name: string;
      description: string;
      price_monthly: string;
      billing_kind: string;
      base_price: string;
      unit_price: string;
      included_units: number;
      unit_label: string;
      is_multi: boolean;
      category: string;
      icon: string;
      trial_days: number;
      is_available: boolean;
      sort_order: number;
      pending_unit_price: string | null;
      pending_effective_at: Date | string | null;
    }>(
      `SELECT slug, name, description, price_monthly, billing_kind,
              base_price, unit_price, included_units, unit_label,
              is_multi, category, icon, trial_days, is_available, sort_order,
              pending_unit_price, pending_effective_at
       FROM marketplace_modules
       ORDER BY sort_order ASC, name ASC`,
    );

    return reply.send({
      data: rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        description: r.description,
        priceMonthly: Number(r.price_monthly),
        billingKind: r.billing_kind,
        basePrice: Number(r.base_price),
        unitPrice: Number(r.unit_price),
        includedUnits: r.included_units,
        unitLabel: r.unit_label,
        isMulti: r.is_multi,
        category: r.category,
        icon: r.icon,
        trialDays: r.trial_days,
        isAvailable: r.is_available,
        sortOrder: r.sort_order,
        pendingUnitPrice: r.pending_unit_price ? Number(r.pending_unit_price) : null,
        pendingEffectiveAt: r.pending_effective_at ? toIso(r.pending_effective_at) : null,
      })),
    });
  });

  /**
   * Обновление цен и квот модуля маркетплейса с поддержкой отложенного применения.
   */
  app.put("/marketplace/modules/:slug", { onRequest: platformOwner }, async (request, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(request.params);
    const body = z
      .object({
        unit_price: z.number().min(0).optional(),
        base_price: z.number().min(0).optional(),
        included_units: z.number().int().min(0).optional(),
        is_available: z.boolean().optional(),
        delayed_for_existing: z.boolean().default(true),
      })
      .parse(request.body);

    const existing = await queryOne<{ unit_price: string; base_price: string; included_units: number }>(
      `SELECT unit_price, base_price, included_units FROM marketplace_modules WHERE slug = $1`,
      [slug],
    );

    if (!existing) {
      return reply.status(404).send({ message: "Модуль не найден" });
    }

    const newUnitPrice = body.unit_price ?? Number(existing.unit_price);
    const newBasePrice = body.base_price ?? Number(existing.base_price);
    const newIncludedUnits = body.included_units ?? existing.included_units;

    if (body.delayed_for_existing && newUnitPrice !== Number(existing.unit_price)) {
      await query(
        `UPDATE installed_modules
         SET locked_unit_price = COALESCE(locked_unit_price, $2),
             next_billing_date = COALESCE(next_billing_date, now() + INTERVAL '1 month')
         WHERE slug = $1`,
        [slug, Number(existing.unit_price)],
      );

      await query(
        `UPDATE marketplace_modules
         SET unit_price = $2,
             base_price = $3,
             included_units = $4,
             is_available = COALESCE($5, is_available),
             pending_unit_price = $2,
             pending_effective_at = now() + INTERVAL '1 month'
         WHERE slug = $1`,
        [slug, newUnitPrice, newBasePrice, newIncludedUnits, body.is_available ?? null],
      );
    } else {
      await query(
        `UPDATE marketplace_modules
         SET unit_price = $2,
             base_price = $3,
             included_units = $4,
             is_available = COALESCE($5, is_available),
             pending_unit_price = NULL,
             pending_effective_at = NULL
         WHERE slug = $1`,
        [slug, newUnitPrice, newBasePrice, newIncludedUnits, body.is_available ?? null],
      );
    }

    return reply.send({ success: true, slug });
  });

  /**
   * Конфигурация Базового тарифа CRM и бесплатных квот.
   */
  app.get("/billing/config", { onRequest: platformOwner }, async (_request, reply) => {
    const config = await queryOne<{
      id: string;
      base_crm_price: string;
      base_crm_users: number;
      base_crm_extra_user_price: string;
      base_crm_included_ai_agents: number;
      base_crm_included_telegram: number;
      base_crm_included_whatsapp: number;
      base_crm_included_max: number;
      base_crm_included_webchat: number;
      updated_at: Date | string;
    }>(
      `SELECT id, base_crm_price, base_crm_users, base_crm_extra_user_price,
              base_crm_included_ai_agents, base_crm_included_telegram,
              base_crm_included_whatsapp, base_crm_included_max,
              base_crm_included_webchat, updated_at
       FROM platform_billing_config
       WHERE id = 'default'`,
    );

    if (!config) {
      return reply.send({
        data: {
          baseCrmPrice: 600,
          baseCrmUsers: 10,
          baseCrmExtraUserPrice: 200,
          baseCrmIncludedAiAgents: 2,
          baseCrmIncludedTelegram: 2,
          baseCrmIncludedWhatsapp: 2,
          baseCrmIncludedMax: 2,
          baseCrmIncludedWebchat: 1,
        },
      });
    }

    return reply.send({
      data: {
        baseCrmPrice: Number(config.base_crm_price),
        baseCrmUsers: config.base_crm_users,
        baseCrmExtraUserPrice: Number(config.base_crm_extra_user_price),
        baseCrmIncludedAiAgents: config.base_crm_included_ai_agents,
        baseCrmIncludedTelegram: config.base_crm_included_telegram,
        baseCrmIncludedWhatsapp: config.base_crm_included_whatsapp,
        baseCrmIncludedMax: config.base_crm_included_max,
        baseCrmIncludedWebchat: config.base_crm_included_webchat,
        updatedAt: toIso(config.updated_at),
      },
    });
  });

  /**
   * Обновление конфигурации Базового тарифа CRM.
   */
  app.put("/billing/config", { onRequest: platformOwner }, async (request, reply) => {
    const body = z
      .object({
        base_crm_price: z.number().min(0).optional(),
        base_crm_users: z.number().int().min(1).optional(),
        base_crm_extra_user_price: z.number().min(0).optional(),
        base_crm_included_ai_agents: z.number().int().min(0).optional(),
        base_crm_included_telegram: z.number().int().min(0).optional(),
        base_crm_included_whatsapp: z.number().int().min(0).optional(),
        base_crm_included_max: z.number().int().min(0).optional(),
        base_crm_included_webchat: z.number().int().min(0).optional(),
      })
      .parse(request.body);

    const updated = await queryOne<{
      base_crm_price: string;
      base_crm_users: number;
      base_crm_extra_user_price: string;
      base_crm_included_ai_agents: number;
      base_crm_included_telegram: number;
      base_crm_included_whatsapp: number;
      base_crm_included_max: number;
      base_crm_included_webchat: number;
      updated_at: Date | string;
    }>(
      `UPDATE platform_billing_config
       SET base_crm_price = COALESCE($1, base_crm_price),
           base_crm_users = COALESCE($2, base_crm_users),
           base_crm_extra_user_price = COALESCE($3, base_crm_extra_user_price),
           base_crm_included_ai_agents = COALESCE($4, base_crm_included_ai_agents),
           base_crm_included_telegram = COALESCE($5, base_crm_included_telegram),
           base_crm_included_whatsapp = COALESCE($6, base_crm_included_whatsapp),
           base_crm_included_max = COALESCE($7, base_crm_included_max),
           base_crm_included_webchat = COALESCE($8, base_crm_included_webchat),
           updated_at = now()
       WHERE id = 'default'
       RETURNING base_crm_price, base_crm_users, base_crm_extra_user_price,
                 base_crm_included_ai_agents, base_crm_included_telegram,
                 base_crm_included_whatsapp, base_crm_included_max,
                 base_crm_included_webchat, updated_at`,
      [
        body.base_crm_price ?? null,
        body.base_crm_users ?? null,
        body.base_crm_extra_user_price ?? null,
        body.base_crm_included_ai_agents ?? null,
        body.base_crm_included_telegram ?? null,
        body.base_crm_included_whatsapp ?? null,
        body.base_crm_included_max ?? null,
        body.base_crm_included_webchat ?? null,
      ],
    );

    return reply.send({
      data: updated
        ? {
            baseCrmPrice: Number(updated.base_crm_price),
            baseCrmUsers: updated.base_crm_users,
            baseCrmExtraUserPrice: Number(updated.base_crm_extra_user_price),
            baseCrmIncludedAiAgents: updated.base_crm_included_ai_agents,
            baseCrmIncludedTelegram: updated.base_crm_included_telegram,
            baseCrmIncludedWhatsapp: updated.base_crm_included_whatsapp,
            baseCrmIncludedMax: updated.base_crm_included_max,
            baseCrmIncludedWebchat: updated.base_crm_included_webchat,
            updatedAt: toIso(updated.updated_at),
          }
        : null,
    });
  });
}
