import { query, queryOne, withTenant, type TransactionClient } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";
import {
  SYSTEM_FEATURE_QUOTAS,
  type QuotaCheckResult,
  type TenantQuotaItemDTO,
  type UpdateTenantQuotasPayload,
} from "./quota.types.js";

interface CustomQuotaRow {
  feature_key: string;
  is_unlimited: boolean;
  max_limit: number;
}

export class QuotaService {
  /**
   * Подсчёт фактического текущего использования для каждой фичи тенанта.
   */
  async getCurrentUsage(tenantId: string, featureKey: string): Promise<number> {
    switch (featureKey) {
      case "webchat_widgets": {
        const row = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'webchat' AND deleted_at IS NULL`,
          [tenantId],
        );
        return Number(row?.count ?? 0);
      }
      case "ai_agents": {
        const row = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM ai_agents
           WHERE tenant_id = $1 AND deleted_at IS NULL`,
          [tenantId],
        );
        return Number(row?.count ?? 0);
      }
      case "telegram_channels": {
        const row = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'telegram' AND deleted_at IS NULL`,
          [tenantId],
        );
        return Number(row?.count ?? 0);
      }
      case "whatsapp_channels": {
        const row = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'whatsapp' AND deleted_at IS NULL`,
          [tenantId],
        );
        return Number(row?.count ?? 0);
      }
      case "max_channels": {
        const row = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'max' AND deleted_at IS NULL`,
          [tenantId],
        );
        return Number(row?.count ?? 0);
      }
      case "custom_pipelines": {
        const row = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM pipelines
           WHERE tenant_id = $1`,
          [tenantId],
        );
        return Number(row?.count ?? 0);
      }
      default:
        return 0;
    }
  }

  /**
   * Получение базового лимита фичи из общесистемной конфигурации.
   */
  async getDefaultLimit(featureKey: string): Promise<number> {
    try {
      const config = await queryOne<{
        base_crm_included_webchat: number;
        base_crm_included_ai_agents: number;
        base_crm_included_telegram: number;
        base_crm_included_whatsapp: number;
        base_crm_included_max: number;
      }>(
        `SELECT base_crm_included_webchat, base_crm_included_ai_agents,
                base_crm_included_telegram, base_crm_included_whatsapp, base_crm_included_max
         FROM platform_billing_config WHERE id = 'default'`,
      );

      if (config) {
        if (featureKey === "webchat_widgets") return Number(config.base_crm_included_webchat ?? 1);
        if (featureKey === "ai_agents") return Number(config.base_crm_included_ai_agents ?? 2);
        if (featureKey === "telegram_channels") return Number(config.base_crm_included_telegram ?? 2);
        if (featureKey === "whatsapp_channels") return Number(config.base_crm_included_whatsapp ?? 2);
        if (featureKey === "max_channels") return Number(config.base_crm_included_max ?? 2);
      }
    } catch {
      // Игнорируем ошибку чтения конфигурации и берем статичный дефолт
    }

    const fallback = SYSTEM_FEATURE_QUOTAS.find((item) => item.key === featureKey);
    return fallback?.defaultLimit ?? 1;
  }

  /**
   * Проверка квоты для тенанта: разрешено ли создать ещё одну сущность.
   */
  async checkQuota(tenantId: string, featureKey: string): Promise<QuotaCheckResult> {
    const current = await this.getCurrentUsage(tenantId, featureKey);

    // 1. Проверяем наличие индивидуального переопределения для конкретного тенанта
    const custom = await queryOne<CustomQuotaRow>(
      `SELECT feature_key, is_unlimited, max_limit
       FROM tenant_feature_quotas
       WHERE tenant_id = $1 AND feature_key = $2`,
      [tenantId, featureKey],
    );

    if (custom) {
      if (custom.is_unlimited || custom.max_limit === -1) {
        return {
          allowed: true,
          isUnlimited: true,
          current,
          maxLimit: null,
        };
      }
      return {
        allowed: current < custom.max_limit,
        isUnlimited: false,
        current,
        maxLimit: custom.max_limit,
      };
    }

    // 2. Если индивидуального переопределения нет — проверяем базовый лимит и installed_modules.quantity
    let defaultLimit = await this.getDefaultLimit(featureKey);

    let moduleSlug: string | null = null;
    if (featureKey === "webchat_widgets") moduleSlug = "webchat";
    else if (featureKey === "ai_agents") moduleSlug = "ai_bots";
    else if (featureKey === "telegram_channels") moduleSlug = "telegram";
    else if (featureKey === "whatsapp_channels") moduleSlug = "whatsapp";
    else if (featureKey === "max_channels") moduleSlug = "max";

    if (moduleSlug) {
      const installed = await queryOne<{ quantity: number }>(
        `SELECT quantity FROM installed_modules WHERE tenant_id = $1 AND slug = $2`,
        [tenantId, moduleSlug],
      );
      if (installed && Number(installed.quantity) > defaultLimit) {
        defaultLimit = Number(installed.quantity);
      }
    }

    return {
      allowed: current < defaultLimit,
      isUnlimited: false,
      current,
      maxLimit: defaultLimit,
    };
  }

  /**
   * Guard clause: бросает HTTP 403 ошибку с кодом QUOTA_EXCEEDED, если лимит исчерпан.
   */
  async assertQuota(tenantId: string, featureKey: string, entityLabel = "сущностей"): Promise<void> {
    const check = await this.checkQuota(tenantId, featureKey);
    if (!check.allowed) {
      throw new AppError(
        403,
        "QUOTA_EXCEEDED",
        `Исчерпан лимит создания ${entityLabel} (${check.current} из ${check.maxLimit}). Для снятия ограничений обратитесь к администратору или выберите индивидуальный тариф.`,
        {
          quota: [
            `Лимит: ${check.maxLimit ?? "не задан"}, текущее количество: ${check.current}`,
          ],
        },
      );
    }
  }

  /**
   * Получение полного списка квот с фактическим использованием для тенанта.
   */
  async getTenantQuotas(tenantId: string): Promise<TenantQuotaItemDTO[]> {
    const customRows = await query<CustomQuotaRow>(
      `SELECT feature_key, is_unlimited, max_limit
       FROM tenant_feature_quotas
       WHERE tenant_id = $1`,
      [tenantId],
    );

    const customMap = new Map<string, CustomQuotaRow>();
    for (const row of customRows) {
      customMap.set(row.feature_key, row);
    }

    const results: TenantQuotaItemDTO[] = [];

    for (const def of SYSTEM_FEATURE_QUOTAS) {
      const usage = await this.getCurrentUsage(tenantId, def.key);
      const defaultLimit = await this.getDefaultLimit(def.key);
      const custom = customMap.get(def.key);

      const isCustom = custom !== undefined;
      const isUnlimited = custom ? Boolean(custom.is_unlimited || custom.max_limit === -1) : false;
      const maxLimit = custom && !isUnlimited ? custom.max_limit : defaultLimit;
      const allowed = isUnlimited || usage < maxLimit;

      results.push({
        feature_key: def.key,
        name: def.name,
        description: def.description,
        category: def.category,
        current_usage: usage,
        is_unlimited: isUnlimited,
        max_limit: isUnlimited ? -1 : maxLimit,
        allowed,
        default_limit: defaultLimit,
        is_custom_override: isCustom,
      });
    }

    return results;
  }

  /**
   * Массовое обновление индивидуальных квот конкретного тенанта (для платформенного администратора).
   */
  async bulkUpdateTenantQuotas(
    tenantId: string,
    quotas: UpdateTenantQuotasPayload["quotas"],
  ): Promise<TenantQuotaItemDTO[]> {
    await withTenant(tenantId, async (tx: TransactionClient) => {
      for (const item of quotas) {
        const isUnlimited = item.is_unlimited === true || item.max_limit === -1;
        const maxLimit = isUnlimited ? -1 : Math.max(1, item.max_limit ?? 1);

        await tx.query(
          `INSERT INTO tenant_feature_quotas (tenant_id, feature_key, is_unlimited, max_limit, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (tenant_id, feature_key) DO UPDATE
           SET is_unlimited = EXCLUDED.is_unlimited,
               max_limit = EXCLUDED.max_limit,
               updated_at = now()`,
          [tenantId, item.feature_key, isUnlimited, maxLimit],
        );

        // Синхронизация с installed_modules.quantity для обратной совместимости легаси компонентов
        let moduleSlug: string | null = null;
        if (item.feature_key === "webchat_widgets") moduleSlug = "webchat";
        else if (item.feature_key === "ai_agents") moduleSlug = "ai_bots";
        else if (item.feature_key === "telegram_channels") moduleSlug = "telegram";
        else if (item.feature_key === "whatsapp_channels") moduleSlug = "whatsapp";
        else if (item.feature_key === "max_channels") moduleSlug = "max";

        if (moduleSlug) {
          const syncQuantity = isUnlimited ? 999999 : maxLimit;
          await tx.query(
            `UPDATE installed_modules
             SET quantity = $3
             WHERE tenant_id = $1 AND slug = $2`,
            [tenantId, moduleSlug, syncQuantity],
          );
        }
      }
    });

    return this.getTenantQuotas(tenantId);
  }
}

export const quotaService = new QuotaService();
