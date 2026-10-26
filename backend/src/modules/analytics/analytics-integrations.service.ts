import { query, queryOne } from "../../db/client.js";
import { encryptSecret } from "../../services/credentials-cipher.js";
import {
  ANALYTICS_PROVIDERS,
  type AnalyticsIntegrationDTO,
  type AnalyticsIntegrationRow,
  type AnalyticsProvider,
  type ConversionResult,
  type UpdateAnalyticsIntegrationPayload,
} from "./analytics.types.js";
import { conversionDispatcher, maskToken } from "./conversion-dispatcher.service.js";

function toIso(val: Date | string | null | undefined): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  return new Date(val).toISOString();
}

function maskConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...config };
  if (typeof result.oauthToken === "string" && result.oauthToken.length > 0) {
    result.oauthToken = maskToken(result.oauthToken);
  }
  if (typeof result.apiSecret === "string" && result.apiSecret.length > 0) {
    result.apiSecret = maskToken(result.apiSecret);
  }
  if (typeof result.accessToken === "string" && result.accessToken.length > 0) {
    result.accessToken = maskToken(result.accessToken);
  }
  return result;
}

export class AnalyticsIntegrationsService {
  async listIntegrations(tenantId: string): Promise<AnalyticsIntegrationDTO[]> {
    const rows = await query<AnalyticsIntegrationRow>(
      `SELECT id, tenant_id, provider, config, is_active, created_at, updated_at
       FROM analytics_integrations
       WHERE tenant_id = $1`,
      [tenantId],
    );

    const byProvider = new Map<AnalyticsProvider, AnalyticsIntegrationRow>();
    for (const r of rows) {
      byProvider.set(r.provider, r);
    }

    // Возвращаем все 5 поддерживаемых провайдеров (даже если еще не настроены)
    return ANALYTICS_PROVIDERS.map((provider) => {
      const existing = byProvider.get(provider);
      if (existing) {
        return {
          id: existing.id,
          provider: existing.provider,
          config: maskConfigSecrets(existing.config || {}),
          isActive: existing.is_active,
          createdAt: toIso(existing.created_at),
          updatedAt: toIso(existing.updated_at),
        };
      }

      return {
        id: "",
        provider,
        config: {},
        isActive: false,
        createdAt: "",
        updatedAt: "",
      };
    });
  }

  async getIntegration(
    tenantId: string,
    provider: AnalyticsProvider,
  ): Promise<AnalyticsIntegrationDTO | null> {
    const row = await queryOne<AnalyticsIntegrationRow>(
      `SELECT id, tenant_id, provider, config, is_active, created_at, updated_at
       FROM analytics_integrations
       WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider],
    );

    if (!row) return null;

    return {
      id: row.id,
      provider: row.provider,
      config: maskConfigSecrets(row.config || {}),
      isActive: row.is_active,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  async saveIntegration(
    tenantId: string,
    provider: AnalyticsProvider,
    payload: UpdateAnalyticsIntegrationPayload,
  ): Promise<AnalyticsIntegrationDTO> {
    const existing = await queryOne<AnalyticsIntegrationRow>(
      `SELECT id, config, is_active FROM analytics_integrations
       WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider],
    );

    const oldConfig = existing?.config || {};
    const newConfig: Record<string, unknown> = { ...oldConfig, ...(payload.config || {}) };

    // Обработка шифрования секретов:
    // Если пользователь передал звездочки (маску) или пустоту — сохраняем старый зашифрованный токен
    const secretFields = ["oauthToken", "apiSecret", "accessToken"] as const;
    for (const field of secretFields) {
      const incomingVal = payload.config?.[field];
      if (typeof incomingVal === "string") {
        const trimmed = incomingVal.trim();
        if (trimmed.includes("***") || trimmed === "") {
          // Сохраняем старый ключ
          newConfig[field] = oldConfig[field];
        } else {
          // Новый токен — шифруем AES-256-GCM
          newConfig[field] = encryptSecret(trimmed);
        }
      }
    }

    const isActive = payload.isActive !== undefined ? payload.isActive : (existing?.is_active ?? true);

    const saved = await queryOne<AnalyticsIntegrationRow>(
      `INSERT INTO analytics_integrations (tenant_id, provider, config, is_active)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (tenant_id, provider)
       DO UPDATE SET
         config = EXCLUDED.config,
         is_active = EXCLUDED.is_active,
         updated_at = now()
       RETURNING id, tenant_id, provider, config, is_active, created_at, updated_at`,
      [tenantId, provider, JSON.stringify(newConfig), isActive],
    );

    if (!saved) {
      throw new Error("Failed to save analytics integration");
    }

    return {
      id: saved.id,
      provider: saved.provider,
      config: maskConfigSecrets(saved.config || {}),
      isActive: saved.is_active,
      createdAt: toIso(saved.created_at),
      updatedAt: toIso(saved.updated_at),
    };
  }

  async testIntegration(
    tenantId: string,
    provider: AnalyticsProvider,
  ): Promise<ConversionResult> {
    const results = await conversionDispatcher.processEvent({
      tenantId,
      dealId: "test-deal-id",
      dealTitle: "Тестовая конверсия",
      stageId: "test-stage-id",
      stageName: "Тестовый этап",
      isWon: true,
      isLost: false,
      budget: 1000,
      currency: "RUB",
      email: "test@example.com",
      phone: "+79991234567",
      eventName: "TestConversion",
    });

    const target = results.find((r) => r.provider === provider);
    if (!target) {
      return {
        provider,
        success: false,
        eventName: "TestConversion",
        status: 404,
        error: "Интеграция не настроена или отключена",
      };
    }

    return target;
  }
}

export const analyticsIntegrationsService = new AnalyticsIntegrationsService();
