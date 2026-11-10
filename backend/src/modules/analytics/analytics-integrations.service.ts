import { query, queryOne } from "../../db/client.js";
import { encryptSecret } from "../../services/credentials-cipher.js";
import {
  normalizeAnalyticsProvider,
  type AnalyticsEventRules,
  type AnalyticsIntegrationDTO,
  type AnalyticsIntegrationRow,
  type AnalyticsProvider,
  type ConversionResult,
  type CreateAnalyticsIntegrationPayload,
  type TestQueueResult,
  type TestQueueStatus,
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

function rowToDto(row: AnalyticsIntegrationRow): AnalyticsIntegrationDTO {
  const canonical = normalizeAnalyticsProvider(row.provider);
  const siteName = row.name || row.site_name || "Основной сайт";
  const maskedConfig = maskConfigSecrets(row.config || {});
  const eventRules: AnalyticsEventRules = row.event_rules || {
    onLeadCreated: true,
    onDealWon: true,
    onFirstMessage: true,
  };

  return {
    id: row.id,
    provider: row.provider,
    canonicalProvider: canonical,
    name: siteName,
    siteName,
    siteUrl: row.site_url,
    counterId: row.counter_id,
    channelAccountId: row.channel_account_id,
    isDefault: row.is_default,
    config: maskedConfig,
    credentials: maskedConfig,
    eventRules,
    isActive: row.is_active,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class AnalyticsIntegrationsService {
  /**
   * Возвращает все подключенные счётчики и сайты тенанта
   */
  async listIntegrations(tenantId: string): Promise<AnalyticsIntegrationDTO[]> {
    const rows = await query<AnalyticsIntegrationRow>(
      `SELECT id, tenant_id, provider, site_name, name, site_url, counter_id,
              channel_account_id, is_default, config, event_rules, is_active, created_at, updated_at
       FROM analytics_integrations
       WHERE tenant_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [tenantId],
    );

    return rows.map(rowToDto);
  }

  /**
   * Создание нового счётчика / интеграции сайта
   */
  async createIntegration(
    tenantId: string,
    payload: CreateAnalyticsIntegrationPayload,
  ): Promise<AnalyticsIntegrationDTO> {
    const rawConfig = payload.credentials || payload.config || {};
    const encryptedConfig = this.processIncomingSecrets({}, rawConfig);

    const counterId =
      payload.counterId ||
      String(
        rawConfig.counterId ||
          rawConfig.measurementId ||
          rawConfig.pixelId ||
          rawConfig.conversionId ||
          "",
      );

    const isDefault = payload.isDefault !== undefined ? payload.isDefault : false;
    const name = payload.name || payload.siteName || "Сайт";
    const eventRules = payload.eventRules || {
      onLeadCreated: true,
      onDealWon: true,
      onFirstMessage: true,
    };

    // Если создается как default, снимаем предыдущий default для этого провайдера
    if (isDefault) {
      await query(
        `UPDATE analytics_integrations SET is_default = false
         WHERE tenant_id = $1 AND provider = $2`,
        [tenantId, payload.provider],
      );
    }

    const row = await queryOne<AnalyticsIntegrationRow>(
      `INSERT INTO analytics_integrations (
         tenant_id, provider, site_name, name, site_url, counter_id,
         channel_account_id, is_default, config, event_rules, is_active
       )
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       RETURNING id, tenant_id, provider, site_name, name, site_url, counter_id,
                 channel_account_id, is_default, config, event_rules, is_active, created_at, updated_at`,
      [
        tenantId,
        payload.provider,
        name,
        payload.siteUrl || null,
        counterId || null,
        payload.channelAccountId || null,
        isDefault,
        JSON.stringify(encryptedConfig),
        JSON.stringify(eventRules),
        payload.isActive !== undefined ? payload.isActive : true,
      ],
    );

    if (!row) throw new Error("Failed to create integration");
    return rowToDto(row);
  }

  /**
   * Обновление интеграции по её уникальному UUID
   */
  async updateIntegrationById(
    tenantId: string,
    id: string,
    payload: UpdateAnalyticsIntegrationPayload,
  ): Promise<AnalyticsIntegrationDTO> {
    const existing = await queryOne<AnalyticsIntegrationRow>(
      `SELECT * FROM analytics_integrations WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    if (!existing) {
      throw new Error(`Integration with id ${id} not found`);
    }

    const incomingConfig = payload.credentials || payload.config || {};
    const updatedConfig = this.processIncomingSecrets(existing.config || {}, incomingConfig);
    const counterId =
      payload.counterId !== undefined
        ? payload.counterId
        : String(
            incomingConfig.counterId ||
              incomingConfig.measurementId ||
              incomingConfig.pixelId ||
              incomingConfig.conversionId ||
              existing.counter_id ||
              "",
          );

    const isDefault = payload.isDefault !== undefined ? payload.isDefault : existing.is_default;
    if (isDefault && !existing.is_default) {
      await query(
        `UPDATE analytics_integrations SET is_default = false
         WHERE tenant_id = $1 AND provider = $2 AND id <> $3`,
        [tenantId, existing.provider, id],
      );
    }

    const name = payload.name || payload.siteName || existing.name || existing.site_name;
    const eventRules = payload.eventRules ? { ...(existing.event_rules || {}), ...payload.eventRules } : existing.event_rules;

    const updated = await queryOne<AnalyticsIntegrationRow>(
      `UPDATE analytics_integrations
       SET site_name = COALESCE($3, site_name),
           name = COALESCE($3, name),
           site_url = COALESCE($4, site_url),
           counter_id = COALESCE($5, counter_id),
           channel_account_id = COALESCE($6, channel_account_id),
           is_default = $7,
           config = $8::jsonb,
           event_rules = COALESCE($9::jsonb, event_rules),
           is_active = COALESCE($10, is_active),
           updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, tenant_id, provider, site_name, name, site_url, counter_id,
                 channel_account_id, is_default, config, event_rules, is_active, created_at, updated_at`,
      [
        id,
        tenantId,
        name ?? null,
        payload.siteUrl ?? null,
        counterId || null,
        payload.channelAccountId ?? null,
        isDefault,
        JSON.stringify(updatedConfig),
        eventRules ? JSON.stringify(eventRules) : null,
        payload.isActive ?? null,
      ],
    );

    if (!updated) throw new Error("Failed to update integration");
    return rowToDto(updated);
  }

  /**
   * Удаление интеграции
   */
  async deleteIntegration(tenantId: string, id: string): Promise<boolean> {
    const res = await query(
      `DELETE FROM analytics_integrations WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return res.length > 0;
  }

  /**
   * Прямой синхронный тест соединения для конкретной интеграции по ID
   */
  async testIntegrationById(
    tenantId: string,
    id: string,
  ): Promise<ConversionResult> {
    const integration = await queryOne<AnalyticsIntegrationRow>(
      `SELECT * FROM analytics_integrations WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    if (!integration) {
      throw new Error(`Интеграция с ID ${id} не найдена`);
    }

    return conversionDispatcher.testSingleIntegration(tenantId, integration);
  }

  /**
   * Обратная совместимость для getIntegration по провайдеру (возвращает дефолтный)
   */
  async getIntegration(
    tenantId: string,
    provider: AnalyticsProvider,
  ): Promise<AnalyticsIntegrationDTO | null> {
    const row = await queryOne<AnalyticsIntegrationRow>(
      `SELECT id, tenant_id, provider, site_name, site_url, counter_id,
              channel_account_id, is_default, config, is_active, created_at, updated_at
       FROM analytics_integrations
       WHERE tenant_id = $1 AND provider = $2
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
      [tenantId, provider],
    );

    if (!row) return null;
    return rowToDto(row);
  }

  /**
   * Обратная совместимость для saveIntegration по провайдеру
   */
  async saveIntegration(
    tenantId: string,
    provider: AnalyticsProvider,
    payload: UpdateAnalyticsIntegrationPayload,
  ): Promise<AnalyticsIntegrationDTO> {
    const existing = await queryOne<AnalyticsIntegrationRow>(
      `SELECT * FROM analytics_integrations
       WHERE tenant_id = $1 AND provider = $2
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
      [tenantId, provider],
    );

    if (existing) {
      return this.updateIntegrationById(tenantId, existing.id, payload);
    }

    return this.createIntegration(tenantId, {
      provider,
      siteName: payload.siteName || "Основной сайт",
      siteUrl: payload.siteUrl,
      counterId: payload.counterId,
      channelAccountId: payload.channelAccountId,
      isDefault: true,
      isActive: payload.isActive,
      config: payload.config || {},
    });
  }

  private processIncomingSecrets(
    oldConfig: Record<string, unknown>,
    newIncoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...oldConfig, ...newIncoming };
    const secretFields = ["oauthToken", "apiSecret", "accessToken"] as const;

    for (const field of secretFields) {
      const incomingVal = newIncoming[field];
      if (typeof incomingVal === "string") {
        const trimmed = incomingVal.trim();
        if (trimmed.includes("***") || trimmed === "") {
          merged[field] = oldConfig[field];
        } else {
          merged[field] = encryptSecret(trimmed);
        }
      }
    }

    return merged;
  }

  /**
   * Прямой синхронный тест соединения
   */
  async testIntegration(
    tenantId: string,
    provider: AnalyticsProvider,
  ): Promise<ConversionResult> {
    const results = await conversionDispatcher.processEvent({
      tenantId,
      dealId: null,
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
      isTest: true,
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

  /**
   * Постановка тестовой задачи в фоновую очередь BullMQ
   */
  async testIntegrationInQueue(
    tenantId: string,
    provider: AnalyticsProvider,
  ): Promise<TestQueueResult> {
    return conversionDispatcher.enqueueTestEvent(tenantId, provider);
  }

  /**
   * Получение статуса задачи из очереди
   */
  async getTestJobStatus(tenantId: string, jobId: string): Promise<TestQueueStatus | null> {
    return conversionDispatcher.getJobStatus(tenantId, jobId);
  }
}

export const analyticsIntegrationsService = new AnalyticsIntegrationsService();
