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
}
