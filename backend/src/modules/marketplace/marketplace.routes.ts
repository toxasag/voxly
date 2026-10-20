import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne, withTenant } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { NotFoundError } from "../../plugins/errorHandler.js";
import {
  moduleSlugSchema,
  toggleModuleSchema,
  updateQuantitySchema,
  type BillingKind,
  type BillingSummaryDTO,
  type MarketplaceModuleDTO,
} from "./marketplace.types.js";
import { effectiveMonthly, isTrialActive, monthlyPrice } from "./pricing.js";
import {
  BASE_MODULE_SLUG,
  ModuleDataService,
  PURGE_GRACE_DAYS,
  type PurgeResult,
} from "./module-data.service.js";
import { PageLayoutTabsService } from "../crm/page-layout-tabs/page-layout-tabs.service.js";
import { platformConfigService } from "../admin/platform-config.service.js";

const params = z.object({ slug: moduleSlugSchema });

interface CatalogRow {
  slug: string;
  name: string;
  description: string;
  price_monthly: string;
  billing_kind: BillingKind;
  base_price: string;
  unit_price: string;
  included_units: number;
  unit_label: string;
  is_multi: boolean;
  category: string;
  icon: string;
  trial_days: number;
  features: string[] | null;
  installed: boolean;
  installed_at: Date | string | null;
  quantity: number | null;
  trial_ends_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Число пользователей арендатора — база для тарифа per_seat.
 *
 * Считается на сервере, а не приходит от клиента: иначе стоимость подписки
 * задавал бы браузер.
 */
async function countUsers(tenantId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT count(*)::text AS total FROM users WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(row?.total ?? 0);
}

/** Marketplace route group, mounted at /api/v1/marketplace. Auth first, then tenant:admin. */
export default async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);
  const auth = app.requirePermission("tenant:admin");
  const moduleData = new ModuleDataService(app);
  const pageLayoutTabs = new PageLayoutTabsService();

  app.get("/modules", { onRequest: auth }, async (request) => {
    const usersCount = await countUsers(request.tenant_id);

    const rows = await query<CatalogRow>(
      `SELECT m.slug, m.name, m.description, m.price_monthly, m.billing_kind,
              m.base_price, m.unit_price, m.included_units, m.unit_label,
              m.is_multi, m.category, m.icon, m.trial_days, m.features,
              (i.slug IS NOT NULL) AS installed, i.installed_at,
              i.quantity, i.trial_ends_at
       FROM marketplace_modules m
       LEFT JOIN installed_modules i ON i.slug = m.slug AND i.tenant_id = $1
       WHERE m.is_available
       ORDER BY m.sort_order, m.name`,
      [request.tenant_id],
    );

    const data: MarketplaceModuleDTO[] = rows.map((row) => {
      const quantity = row.quantity ?? 0;
      const pricing = {
        billingKind: row.billing_kind,
        basePrice: Number(row.base_price),
        unitPrice: Number(row.unit_price),
        includedUnits: row.included_units,
        // Для не установленного модуля показываем цену за одну единицу,
        // иначе карточка per_unit показывала бы 0 ₽.
        quantity: quantity === 0 ? 1 : quantity,
        usersCount,
      };

      return {
        slug: row.slug,
        name: row.name,
        description: row.description,
        priceMonthly: Number(row.price_monthly),
        billingKind: row.billing_kind,
        basePrice: pricing.basePrice,
        unitPrice: pricing.unitPrice,
        includedUnits: row.included_units,
        unitLabel: row.unit_label,
        isMulti: row.is_multi,
        isBaseModule: row.slug === BASE_MODULE_SLUG,
        category: row.category,
        icon: row.icon,
        trialDays: row.trial_days,
        features: row.features ?? [],
        installed: row.installed,
        installedAt: toIso(row.installed_at),
        quantity,
        trialEndsAt: toIso(row.trial_ends_at),
        trialActive: isTrialActive(row.trial_ends_at),
        monthlyTotal: row.installed
          ? effectiveMonthly(pricing, row.trial_ends_at)
          : monthlyPrice(pricing),
      };
    });

    return { data };
  });

  /** Сводка по подписке: что и сколько арендатор платит сейчас. */
  app.get("/billing", { onRequest: auth }, async (request) => {
    const usersCount = await countUsers(request.tenant_id);

    const rows = await query<CatalogRow>(
      `SELECT m.slug, m.name, m.description, m.price_monthly, m.billing_kind,
              m.base_price,
              COALESCE(
                CASE WHEN i.locked_unit_price IS NOT NULL AND (i.next_billing_date IS NULL OR i.next_billing_date > now())
                     THEN i.locked_unit_price
                     ELSE m.unit_price
                END,
                m.unit_price
              ) AS unit_price,
              m.included_units, m.unit_label,
              m.is_multi, m.category, m.icon, m.trial_days, m.features,
              true AS installed, i.installed_at, i.quantity, i.trial_ends_at
       FROM installed_modules i
       JOIN marketplace_modules m ON m.slug = i.slug
       WHERE i.tenant_id = $1
       ORDER BY m.sort_order`,
      [request.tenant_id],
    );

    const items = rows.map((row) => {
      const pricing = {
        billingKind: row.billing_kind,
        basePrice: Number(row.base_price),
        unitPrice: Number(row.unit_price),
        includedUnits: row.included_units,
        quantity: row.quantity ?? 1,
        usersCount,
      };

      return {
        slug: row.slug,
        name: row.name,
        quantity: row.quantity ?? 1,
        monthlyTotal: effectiveMonthly(pricing, row.trial_ends_at),
        // Полная цена без скидки пробного периода — чтобы показать, во что
        // подписка превратится после его окончания.
        fullMonthly: monthlyPrice(pricing),
        trialActive: isTrialActive(row.trial_ends_at),
        trialEndsAt: toIso(row.trial_ends_at),
      };
    });

    const integrations = await platformConfigService.getEffectiveIntegrations();
    const isRoboConfigured = integrations.robokassa.isConfigured;

    const summary: BillingSummaryDTO = {
      monthlyTotal: items.reduce((sum, item) => sum + item.monthlyTotal, 0),
      monthlyAfterTrials: items.reduce((sum, item) => sum + item.fullMonthly, 0),
      usersCount,
      items: items.map(({ fullMonthly: _full, ...rest }) => rest),
      billingProvider: {
        connected: isRoboConfigured,
        provider: isRoboConfigured ? "robokassa" : null,
      },
    };

    return { data: summary };
  });

  app.post("/modules/:slug/toggle", { onRequest: auth }, async (request, reply) => {
    const { slug } = params.parse(request.params);
    const { enabled, quantity } = toggleModuleSchema.parse(request.body);

    const result = await withTenant(request.tenant_id, async (tx) => {
      const module = await tx.queryOne<{
        name: string;
        billing_kind: BillingKind;
        is_multi: boolean;
        trial_days: number;
      }>(
        `SELECT name, billing_kind, is_multi, trial_days
         FROM marketplace_modules WHERE slug = $1 AND is_available`,
        [slug],
      );

      if (module === null) throw new NotFoundError("Модуль маркетплейса не найден");

      let purge: PurgeResult | null = null;
      let restored: { restored: Record<string, number>; total: number } | null = null;

      if (!enabled) {
        // Базовая CRM не отключается: на её контакты и сделки ссылаются
        // остальные модули. Проверка здесь, а не только в интерфейсе — запрос
        // можно отправить и минуя его; в БД стоит ещё и триггер.
        ModuleDataService.assertNotBaseModule(slug);

        // Данные помечаются удалёнными в той же транзакции, что и снятие
        // установки: иначе модуль оказался бы отключён, а его данные видимы.
        purge = await moduleData.softDelete(tx, {
          tenantId: request.tenant_id,
          slug,
          actorId: request.authUser.id,
        });

        await tx.query(`DELETE FROM installed_modules WHERE tenant_id = $1 AND slug = $2`, [
          request.tenant_id,
          slug,
        ]);

        await pageLayoutTabs.applyModuleUninstall(tx, request.tenant_id, slug);
      } else {
        // Повторное включение в течение окна возвращает ровно те строки, которые
        // скрыло отключение.
        restored = await moduleData.restore(tx, { tenantId: request.tenant_id, slug });

        // Количество применимо только к мульти-модулям; для остальных всегда 1,
        // иначе клиент мог бы «размножить» модуль с фиксированной ценой.
        const units = module.is_multi ? (quantity ?? 1) : 1;

        // Пробный период начисляется только при первой установке: повторное
        // включение после отключения не должно давать новые 14 дней.
        // ON CONFLICT здесь не подходит — строка удаляется при отключении,
        // поэтому историю проверяем по журналу аудита.
        const hadTrial = await tx.queryOne<{ exists: boolean }>(
          `SELECT true AS exists FROM tenant_audit_log
           WHERE tenant_id = $1 AND entity_type = 'module' AND entity_id = $2
             AND action = 'module.install'
           LIMIT 1`,
          [request.tenant_id, slug],
        );

        const trialInterval = hadTrial === null ? module.trial_days : null;

        await tx.query(
          `INSERT INTO installed_modules (tenant_id, slug, name, quantity, trial_ends_at)
           VALUES ($1, $2, $3, $4,
                   CASE WHEN $5::int IS NULL THEN NULL
                        ELSE now() + ($5::int * INTERVAL '1 day') END)
           ON CONFLICT (tenant_id, slug)
           DO UPDATE SET quantity = EXCLUDED.quantity, name = EXCLUDED.name`,
          [request.tenant_id, slug, module.name, units, trialInterval],
        );

        await pageLayoutTabs.applyModuleInstall(tx, request.tenant_id, slug);
      }

      await tx.query(
        `INSERT INTO tenant_audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, $3, 'module', $4, $5::jsonb)`,
        [
          request.tenant_id,
          request.authUser.id,
          enabled ? "module.install" : "module.uninstall",
          slug,
          JSON.stringify({ enabled, quantity: quantity ?? 1 }),
        ],
      );

      const saved = await tx.queryOne<{ quantity: number; trial_ends_at: Date | string | null }>(
        `SELECT quantity, trial_ends_at FROM installed_modules
         WHERE tenant_id = $1 AND slug = $2`,
        [request.tenant_id, slug],
      );

      return {
        slug,
        enabled,
        quantity: saved?.quantity ?? 0,
        trialEndsAt: toIso(saved?.trial_ends_at ?? null),
        // Сколько строк скрыто или возвращено — интерфейс сообщает это в тосте,
        // иначе пользователь не знает, что именно произошло с его данными.
        affectedRows: purge?.total ?? restored?.total ?? 0,
        purgeAfter: purge?.purgeAfter ?? null,
        graceDays: purge === null ? null : PURGE_GRACE_DAYS,
      };
    });

    return reply.send({ data: result });
  });

  /**
   * Что потеряет арендатор при отключении модуля.
   *
   * Отдельный эндпоинт, а не поле в списке модулей: подсчёт строк по таблицам
   * нужен только в момент открытия диалога подтверждения, и выполнять его при
   * каждой загрузке маркетплейса было бы напрасной работой.
   */
  app.get("/modules/:slug/impact", { onRequest: auth }, async (request, reply) => {
    const { slug } = params.parse(request.params);

    const data = await withTenant(request.tenant_id, async (tx) => {
      const counts = await moduleData.preview(tx, request.tenant_id, slug);
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

      return {
        slug,
        isBaseModule: slug === BASE_MODULE_SLUG,
        affected: counts,
        total,
        graceDays: PURGE_GRACE_DAYS,
      };
    });

    return reply.send({ data });
  });

  /** Изменение числа агентов или аккаунтов у подключённого модуля. */
  app.patch("/modules/:slug/quantity", { onRequest: auth }, async (request, reply) => {
    const { slug } = params.parse(request.params);
    const { quantity } = updateQuantitySchema.parse(request.body);

    const result = await withTenant(request.tenant_id, async (tx) => {
      const module = await tx.queryOne<{ is_multi: boolean }>(
        `SELECT is_multi FROM marketplace_modules WHERE slug = $1 AND is_available`,
        [slug],
      );
      if (module === null) throw new NotFoundError("Модуль маркетплейса не найден");
      if (!module.is_multi) {
        throw new NotFoundError("У этого модуля нет количественного учёта");
      }

      const updated = await tx.queryOne<{ quantity: number }>(
        `UPDATE installed_modules SET quantity = $3
         WHERE tenant_id = $1 AND slug = $2
         RETURNING quantity`,
        [request.tenant_id, slug, quantity],
      );

      if (updated === null) throw new NotFoundError("Модуль не подключён");

      await tx.query(
        `INSERT INTO tenant_audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'module.quantity', 'module', $3, $4::jsonb)`,
        [request.tenant_id, request.authUser.id, slug, JSON.stringify({ quantity })],
      );

      return { slug, quantity: updated.quantity };
    });

    return reply.send({ data: result });
  });
}
