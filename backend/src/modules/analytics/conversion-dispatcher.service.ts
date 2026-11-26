import { Queue, Worker } from "bullmq";
import { registerBullQueue } from "../../infrastructure/queue-metrics.js";
import { createHash } from "node:crypto";
import { getRedisConnectionOptions, requireDurableQueue } from "../../infrastructure/redis.js";
import { withTenant } from "../../db/client.js";
import { decryptSecret } from "../../services/credentials-cipher.js";
import {
  normalizeAnalyticsProvider,
  type AnalyticsIntegrationRow,
  type AnalyticsProvider,
  type ConversionDeliveryAttemptRow,
  type ConversionEventPayload,
  type ConversionResult,
  type TestQueueResult,
  type TestQueueStatus,
} from "./analytics.types.js";
import type { IConversionProvider } from "./conversion-provider.interface.js";
import { YandexConversionProvider } from "./providers/yandex-conversion.provider.js";
import { Ga4ConversionProvider } from "./providers/ga4-conversion.provider.js";
import { MetaConversionProvider } from "./providers/meta-conversion.provider.js";
import { VkConversionProvider } from "./providers/vk-conversion.provider.js";
import { GoogleAdsConversionProvider } from "./providers/google-ads-conversion.provider.js";

const QUEUE_NAME = "conversion-events";

function safeDecrypt(val: unknown): string {
  if (typeof val !== "string" || !val) return "";
  if (val.startsWith("v1:")) {
    try {
      return decryptSecret(val);
    } catch {
      return val;
    }
  }
  return val;
}

export function maskToken(val: unknown): string {
  if (typeof val !== "string" || !val) return "";
  if (val.startsWith("v1:")) {
    try {
      const dec = decryptSecret(val);
      if (dec.length <= 6) return "***";
      return dec.slice(0, 3) + "***" + dec.slice(-3);
    } catch {
      return "***";
    }
  }
  if (val.length <= 6) return "***";
  return val.slice(0, 3) + "***" + val.slice(-3);
}

function conversionEventKey(payload: ConversionEventPayload, provider: AnalyticsProvider): string {
  return createHash("sha256")
    .update(
      `${payload.tenantId}:${payload.dealId || payload.jobId || "test"}:${provider}:${payload.stageId || "test"}:${payload.eventName}`,
    )
    .digest("hex");
}

function extractAttribution(
  dealCustomFields: Record<string, unknown>,
  contactCustomFields: Record<string, unknown>,
  sourceMetadata: Record<string, unknown>,
) {
  const metaAnalytics =
    typeof sourceMetadata.analytics === "object" && sourceMetadata.analytics !== null
      ? (sourceMetadata.analytics as Record<string, unknown>)
      : {};
  const metaClickIds =
    typeof sourceMetadata.clickIds === "object" && sourceMetadata.clickIds !== null
      ? (sourceMetadata.clickIds as Record<string, unknown>)
      : {};
  const metaPage =
    typeof sourceMetadata.page === "object" && sourceMetadata.page !== null
      ? (sourceMetadata.page as Record<string, unknown>)
      : {};

  const ymUid =
    (dealCustomFields.ym_uid as string) ||
    (dealCustomFields.ym_client_id as string) ||
    (dealCustomFields.ya_client_id as string) ||
    (dealCustomFields.yandex_client_id as string) ||
    (dealCustomFields.ya_cid as string) ||
    (metaAnalytics.ymUid as string) ||
    (metaAnalytics.ym_uid as string) ||
    (contactCustomFields.ym_uid as string) ||
    (contactCustomFields.ym_client_id as string) ||
    (contactCustomFields.ya_client_id as string) ||
    (contactCustomFields.yandex_client_id as string) ||
    (sourceMetadata.ym_client_id as string) ||
    (sourceMetadata.ym_uid as string) ||
    null;

  const yclid =
    (dealCustomFields.yclid as string) ||
    (metaClickIds.yclid as string) ||
    (contactCustomFields.yclid as string) ||
    (sourceMetadata.yclid as string) ||
    null;

  const gclid =
    (dealCustomFields.gclid as string) ||
    (metaClickIds.gclid as string) ||
    (contactCustomFields.gclid as string) ||
    (sourceMetadata.gclid as string) ||
    ((sourceMetadata.form_data as Record<string, unknown> | undefined)?.gclid as string) ||
    null;

  const gbraid =
    (dealCustomFields.gbraid as string) ||
    (metaClickIds.gbraid as string) ||
    (contactCustomFields.gbraid as string) ||
    (sourceMetadata.gbraid as string) ||
    ((sourceMetadata.form_data as Record<string, unknown> | undefined)?.gbraid as string) ||
    null;

  const wbraid =
    (dealCustomFields.wbraid as string) ||
    (metaClickIds.wbraid as string) ||
    (contactCustomFields.wbraid as string) ||
    (sourceMetadata.wbraid as string) ||
    ((sourceMetadata.form_data as Record<string, unknown> | undefined)?.wbraid as string) ||
    null;

  const clientId =
    (dealCustomFields.client_id as string) ||
    (dealCustomFields.ga_client_id as string) ||
    (metaAnalytics.clientId as string) ||
    (metaAnalytics.client_id as string) ||
    (contactCustomFields.client_id as string) ||
    (contactCustomFields.ga_client_id as string) ||
    (sourceMetadata.ga_client_id as string) ||
    (sourceMetadata.client_id as string) ||
    ymUid ||
    null;

  const yandexuid =
    (dealCustomFields.yandexuid as string) ||
    (metaAnalytics.yandexuid as string) ||
    (contactCustomFields.yandexuid as string) ||
    (sourceMetadata.yandexuid as string) ||
    null;

  const gaId =
    (dealCustomFields.ga_id as string) ||
    (contactCustomFields.ga_id as string) ||
    null;

  const fbId =
    (dealCustomFields.fb_id as string) ||
    (contactCustomFields.fb_id as string) ||
    null;

  const tmrLvid =
    (dealCustomFields.tmr_lvid as string) ||
    (contactCustomFields.tmr_lvid as string) ||
    null;

  const sourceUrl =
    (metaPage.url as string) ||
    (metaPage.domain as string) ||
    (dealCustomFields.page_url as string) ||
    (sourceMetadata.url as string) ||
    (sourceMetadata.site_url as string) ||
    (sourceMetadata.page_url as string) ||
    null;

  return { ymUid, yclid, gclid, gbraid, wbraid, clientId, yandexuid, gaId, fbId, tmrLvid, sourceUrl };
}

export class ConversionDispatcherService {
  private static instance: ConversionDispatcherService | null = null;
  private readonly providers: Map<AnalyticsProvider, IConversionProvider>;
  private bullQueue: Queue<ConversionEventPayload> | null = null;
  private bullWorker: Worker<ConversionEventPayload> | null = null;
  private inMemoryQueue: ConversionEventPayload[] = [];
  private isProcessingInMemory = false;

  constructor() {
    this.providers = new Map<AnalyticsProvider, IConversionProvider>([
      ["yandex", new YandexConversionProvider()],
      ["ga4", new Ga4ConversionProvider()],
      ["meta", new MetaConversionProvider()],
      ["vk", new VkConversionProvider()],
      ["google_ads", new GoogleAdsConversionProvider()],
    ]);

    this.initQueue();
  }

  static getInstance(): ConversionDispatcherService {
    if (!this.instance) {
      this.instance = new ConversionDispatcherService();
    }
    return this.instance;
  }

  private initQueue(): void {
    let connOptions: ReturnType<typeof getRedisConnectionOptions> = null;
    try {
      connOptions = getRedisConnectionOptions();
    } catch {
      return;
    }

    if (!connOptions) {
      requireDurableQueue(QUEUE_NAME);
      return;
    }
    try {
      this.bullQueue = new Queue<ConversionEventPayload>(QUEUE_NAME, {
        connection: connOptions,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 3000,
          },
          removeOnComplete: { count: 1000, age: 86400 },
          removeOnFail: { count: 500, age: 86400 },
        },
      });
      registerBullQueue(QUEUE_NAME, this.bullQueue as Queue<unknown>);

      this.bullWorker = new Worker<ConversionEventPayload>(
        QUEUE_NAME,
        async (job: { data: ConversionEventPayload }) => {
          await this.processEvent(job.data);
        },
        { connection: connOptions, concurrency: 5 },
      );

      this.bullWorker.on("failed", (job: { id?: string } | undefined, err: Error) => {
        console.error(
          `[ConversionDispatcher] Job ${job?.id ?? "unknown"} failed permanently:`,
          err.message,
        );
      });
    } catch (err) {
      console.warn("[ConversionDispatcher] Failed to connect BullMQ to Redis:", err);
    }
  }

  async enqueueEvent(payload: ConversionEventPayload): Promise<void> {
    if (this.bullQueue) {
      await this.bullQueue.add("dispatch-conversion", payload);
      return;
    }

    requireDurableQueue(QUEUE_NAME);
    this.inMemoryQueue.push(payload);
    void this.drainInMemoryQueue();
  }

  /**
   * Постановка тестовой задачи в очередь BullMQ для проверки отредактированных настроек.
   */
  async enqueueTestEvent(
    tenantId: string,
    provider: AnalyticsProvider,
  ): Promise<TestQueueResult> {
    const jobId = `test_${provider}_${Date.now()}`;
    const testPayload: ConversionEventPayload = {
      tenantId,
      dealId: null,
      dealTitle: "Тестовая проверка настроек",
      stageId: "test-stage-id",
      stageName: "Тест",
      isWon: true,
      isLost: false,
      budget: 1000,
      currency: "RUB",
      email: "test@example.com",
      phone: "+79991234567",
      eventName: "TestConversion",
      isTest: true,
      jobId,
    };

    if (this.bullQueue) {
      const job = await this.bullQueue.add("test-conversion", testPayload, {
        jobId,
        attempts: 1,
        removeOnComplete: { count: 200, age: 3600 },
        removeOnFail: { count: 200, age: 3600 },
      });
      return {
        jobId: job.id || jobId,
        provider,
        status: "enqueued",
        message: "Тестовая задача поставлена в очередь BullMQ",
      };
    }

    // In-memory обработка при отсутствии Redis
    void this.processEvent(testPayload);
    return {
      jobId,
      provider,
      status: "enqueued",
      message: "Тестовая задача поставлена на локальное выполнение",
    };
  }

  /**
   * Получение статуса выполнения тестовой задачи из базы попыток
   */
  async getJobStatus(tenantId: string, jobId: string): Promise<TestQueueStatus | null> {
    const row = await withTenant(tenantId, async (tx) => {
      return tx.queryOne<ConversionDeliveryAttemptRow>(
        `SELECT status, attempts, last_status, last_error, response_snippet, delivered_at
         FROM conversion_delivery_attempts
         WHERE tenant_id = $1 AND job_id = $2
         ORDER BY updated_at DESC
         LIMIT 1`,
        [tenantId, jobId],
      );
    });

    if (!row) return null;

    return {
      jobId,
      status: row.status,
      attempts: row.attempts,
      lastStatus: row.last_status,
      lastError: row.last_error,
      responseSnippet: row.response_snippet,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
    };
  }

  async buildDealEventPayload(
    tenantId: string,
    dealId: string,
    stageId?: string,
    overrideEventName?: string,
  ): Promise<ConversionEventPayload | null> {
    return withTenant(tenantId, async (tx) => {
      const dealRows = await tx.query<{
        id: string;
        title: string;
        budget: string;
        currency: string;
        contact_id: string | null;
        custom_fields: Record<string, unknown> | null;
        source_metadata: Record<string, unknown> | null;
        stage_name: string;
        stage_id: string;
        is_won: boolean;
        is_lost: boolean;
        created_at: Date | string;
      }>(
        `SELECT d.id, d.title, d.budget::text, d.currency, d.contact_id, d.custom_fields, d.source_metadata,
                d.stage_id, s.name AS stage_name, s.is_won, s.is_lost, d.created_at
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
        [tenantId, dealId],
      );

      const deal = dealRows[0];
      if (!deal) return null;

      let email: string | null = null;
      let phone: string | null = null;
      let contactCustomFields: Record<string, unknown> = {};

      if (deal.contact_id) {
        const contactRows = await tx.query<{
          email: string | null;
          phone: string | null;
          custom_fields: Record<string, unknown> | null;
        }>(
          `SELECT email, phone, custom_fields
           FROM contacts
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, deal.contact_id],
        );
        const contact = contactRows[0];
        if (contact) {
          email = contact.email;
          phone = contact.phone;
          if (contact.custom_fields && typeof contact.custom_fields === "object") {
            contactCustomFields = contact.custom_fields;
          }
        }
      }

      const dealCustomFields =
        deal.custom_fields && typeof deal.custom_fields === "object" ? deal.custom_fields : {};
      const sourceMetadata =
        deal.source_metadata && typeof deal.source_metadata === "object" ? deal.source_metadata : {};

      const { ymUid, yclid, gclid, gbraid, wbraid, clientId, yandexuid, gaId, fbId, tmrLvid, sourceUrl } =
        extractAttribution(dealCustomFields, contactCustomFields, sourceMetadata);

      let eventName = overrideEventName;
      if (!eventName) {
        if (deal.is_won) {
          eventName = "Purchase";
        } else {
          const isLeadStage =
            deal.stage_name.toLowerCase().includes("лид") ||
            deal.stage_name.toLowerCase().includes("lead") ||
            deal.stage_name.toLowerCase().includes("квалифиц");
          eventName = isLeadStage ? "Lead" : "DealStageChanged";
        }
      }

      const effectiveStageId = stageId || deal.stage_id;

      const resultPayload: ConversionEventPayload = {
        tenantId,
        dealId: deal.id,
        dealTitle: deal.title,
        stageId: effectiveStageId,
        stageName: deal.stage_name,
        isWon: deal.is_won,
        isLost: deal.is_lost,
        budget: parseFloat(deal.budget) || 0,
        currency: deal.currency || "RUB",
        contactId: deal.contact_id,
        clientId,
        ymUid,
        yclid,
        gclid,
        gbraid,
        wbraid,
        yandexuid,
        gaId,
        fbId,
        tmrLvid,
        email,
        phone,
        eventName,
        createdAt: deal.created_at,
        sourceUrl,
      };

      return resultPayload;
    });
  }

  /**
   * Отправка серверной конверсии «Лид» при создании новой сделки
   */
  async handleDealCreated(payload: { tenantId: string; dealId: string }): Promise<void> {
    const eventPayload = await this.buildDealEventPayload(payload.tenantId, payload.dealId, undefined, "Lead");
    if (eventPayload) {
      await this.enqueueEvent(eventPayload);
    }
  }

  /**
   * Прямая синхронная отправка события сделки (для повторной отправки / replay)
   */
  async handleDealCreatedDirect(tenantId: string, dealId: string): Promise<ConversionResult[]> {
    const eventPayload = await this.buildDealEventPayload(tenantId, dealId);
    if (!eventPayload) return [];
    return this.processEvent(eventPayload);
  }

  async handleDealStageChanged(payload: {
    tenantId: string;
    dealId: string;
    stageId: string;
  }): Promise<void> {
    const eventPayload = await this.buildDealEventPayload(payload.tenantId, payload.dealId, payload.stageId);
    if (eventPayload) {
      await this.enqueueEvent(eventPayload);
    }
  }

  private async drainInMemoryQueue(): Promise<void> {
    if (this.isProcessingInMemory) return;
    this.isProcessingInMemory = true;

    try {
      while (this.inMemoryQueue.length > 0) {
        const item = this.inMemoryQueue.shift();
        if (item) {
          await this.processEvent(item);
        }
      }
    } finally {
      this.isProcessingInMemory = false;
    }
  }

  /**
   * Прямая синхронная проверка одного конкретного счетчика по его ID
   */
  async testSingleIntegration(
    tenantId: string,
    integration: AnalyticsIntegrationRow,
  ): Promise<ConversionResult> {
    const canonical = normalizeAnalyticsProvider(integration.provider);
    const provider = this.providers.get(canonical);
    if (!provider) {
      return {
        provider: integration.provider,
        success: false,
        eventName: "TestConversion",
        status: 400,
        error: `Провайдер ${integration.provider} не поддерживается`,
      };
    }

    const rawConfig = integration.config || {};
    const decryptedConfig: Record<string, unknown> = { ...rawConfig };
    if (!decryptedConfig.counterId && integration.counter_id) {
      decryptedConfig.counterId = integration.counter_id;
    }
    if (typeof decryptedConfig.oauthToken === "string") {
      decryptedConfig.oauthToken = safeDecrypt(decryptedConfig.oauthToken);
    }
    if (typeof decryptedConfig.apiSecret === "string") {
      decryptedConfig.apiSecret = safeDecrypt(decryptedConfig.apiSecret);
    }
    if (typeof decryptedConfig.accessToken === "string") {
      decryptedConfig.accessToken = safeDecrypt(decryptedConfig.accessToken);
    }

    const testPayload: ConversionEventPayload = {
      tenantId,
      dealId: null,
      dealTitle: `Тестовая конверсия (${integration.site_name || "Сайт"})`,
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
      jobId: `test-${integration.id}`,
    };

    let result: ConversionResult;
    try {
      result = await provider.sendEvent(testPayload, decryptedConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        provider: integration.provider,
        success: false,
        eventName: "TestConversion",
        status: 500,
        error: message,
      };
    }

    // Записываем результат проверки в conversion_delivery_attempts
    try {
      const canonical = normalizeAnalyticsProvider(integration.provider);
      const eventKey = conversionEventKey(testPayload, canonical);
      await withTenant(tenantId, async (tx) => {
        await tx.query(
          `INSERT INTO conversion_delivery_attempts
             (tenant_id, deal_id, provider, event_key, event_name, status, attempts, last_status, last_error, response_snippet, is_test, job_id, delivered_at)
           VALUES ($1, NULL, $2, $3, 'TestConversion', $4, 1, $5, $6, $7, true, $8, CASE WHEN $4 = 'sent' THEN now() ELSE NULL END)
           ON CONFLICT (tenant_id, provider, event_key) DO UPDATE
           SET status = EXCLUDED.status, last_status = EXCLUDED.last_status, last_error = EXCLUDED.last_error,
               response_snippet = EXCLUDED.response_snippet, delivered_at = EXCLUDED.delivered_at, updated_at = now()`,
          [
            tenantId,
            canonical,
            eventKey,
            result.success ? "sent" : "failed",
            result.status,
            result.error ?? null,
            result.responseSnippet ? result.responseSnippet.slice(0, 500) : null,
            testPayload.jobId ?? null,
          ],
        );
      });
    } catch {
      // Игнорируем ошибку логирования в базу
    }

    return result;
  }

  async processEvent(payload: ConversionEventPayload): Promise<ConversionResult[]> {
    return withTenant(payload.tenantId, async (tx) => {
      // Получаем активные интеграции для тенанта
      const integrations = await tx.query<AnalyticsIntegrationRow>(
        `SELECT id, tenant_id, provider, site_name, site_url, counter_id, channel_account_id, is_default, config, event_rules, is_active, created_at, updated_at
         FROM analytics_integrations
         WHERE tenant_id = $1 AND is_active = true`,
        [payload.tenantId],
      );

      if (integrations.length === 0) {
        return [];
      }

      const results: ConversionResult[] = [];

      for (const integration of integrations) {
        const canonical = normalizeAnalyticsProvider(integration.provider);
        const provider = this.providers.get(canonical);
        if (!provider) continue;

        // 1. Проверяем правила событий
        const eventRules = integration.event_rules || {};
        if (payload.isWon && eventRules.onDealWon === false) {
          continue;
        }
        if (payload.eventName === "Lead" && eventRules.onLeadCreated === false) {
          continue;
        }
        if (payload.eventName === "Chat" && eventRules.onFirstMessage === false) {
          continue;
        }

        // 2. Если у события указан домен/URL источника, а у интеграции задан site_url
        if (payload.sourceUrl && integration.site_url) {
          try {
            const payloadHost = new URL(
              payload.sourceUrl.startsWith("http") ? payload.sourceUrl : `https://${payload.sourceUrl}`,
            ).hostname.replace(/^www\./, "");
            const intHost = new URL(
              integration.site_url.startsWith("http") ? integration.site_url : `https://${integration.site_url}`,
            ).hostname.replace(/^www\./, "");
            if (payloadHost !== intHost && !integration.is_default) {
              continue;
            }
          } catch {
            // ignore url parse error
          }
        }

        const rawConfig = integration.config || {};
        const stageEvents = (rawConfig.stageEvents as Record<string, string>) || {};

        const mappedEventName =
          stageEvents[payload.stageId || ""] ||
          (payload.isWon ? "Purchase" : payload.eventName || "Lead");

        const decryptedConfig: Record<string, unknown> = { ...rawConfig };
        if (!decryptedConfig.counterId && integration.counter_id) {
          decryptedConfig.counterId = integration.counter_id;
        }
        if (typeof decryptedConfig.oauthToken === "string") {
          decryptedConfig.oauthToken = safeDecrypt(decryptedConfig.oauthToken);
        }
        if (typeof decryptedConfig.apiSecret === "string") {
          decryptedConfig.apiSecret = safeDecrypt(decryptedConfig.apiSecret);
        }
        if (typeof decryptedConfig.accessToken === "string") {
          decryptedConfig.accessToken = safeDecrypt(decryptedConfig.accessToken);
        }
        if (typeof decryptedConfig.developerToken === "string") {
          decryptedConfig.developerToken = safeDecrypt(decryptedConfig.developerToken);
        }
        if (typeof decryptedConfig.refreshToken === "string") {
          decryptedConfig.refreshToken = safeDecrypt(decryptedConfig.refreshToken);
        }

        // Если Google Ads не имеет собственных API-ключей, проверяем наличие активного потока GA4 для моста
        if (canonical === "google_ads" && !decryptedConfig.ga4MeasurementId && !decryptedConfig.developerToken) {
          const linkedGa4 = integrations.find(
            (i) => normalizeAnalyticsProvider(i.provider) === "ga4" && i.is_active,
          );
          if (linkedGa4) {
            const ga4Config = (linkedGa4.config as Record<string, unknown>) || {};
            decryptedConfig.ga4MeasurementId = linkedGa4.counter_id || ga4Config.measurementId;
            if (typeof ga4Config.apiSecret === "string") {
              decryptedConfig.ga4ApiSecret = safeDecrypt(ga4Config.apiSecret);
            }
          }
        }

        const eventPayloadWithMappedName: ConversionEventPayload = {
          ...payload,
          eventName: mappedEventName,
        };

        const eventKey = conversionEventKey(eventPayloadWithMappedName, canonical);
        const claimed = await tx.query<{ id: string }>(
          `INSERT INTO conversion_delivery_attempts
             (tenant_id, deal_id, provider, event_key, event_name, status, attempts, locked_until, payload, is_test, job_id)
           VALUES ($1, $2::uuid, $3, $4, $5, 'pending', 1, now() + interval '5 minutes', $6::jsonb, $7, $8)
           ON CONFLICT (tenant_id, provider, event_key) DO UPDATE
           SET status = 'pending', attempts = conversion_delivery_attempts.attempts + 1,
               locked_until = now() + interval '5 minutes', last_error = NULL,
               updated_at = now(), payload = EXCLUDED.payload, event_name = EXCLUDED.event_name,
               is_test = EXCLUDED.is_test, job_id = EXCLUDED.job_id
           WHERE conversion_delivery_attempts.status <> 'sent'
             AND (conversion_delivery_attempts.locked_until IS NULL OR conversion_delivery_attempts.locked_until < now())
           RETURNING id`,
          [
            payload.tenantId,
            payload.dealId ?? null,
            canonical,
            eventKey,
            mappedEventName,
            JSON.stringify(eventPayloadWithMappedName),
            Boolean(payload.isTest),
            payload.jobId ?? null,
          ],
        );
        if (claimed.length === 0) continue;

        let result: ConversionResult;
        try {
          result = await provider.sendEvent(eventPayloadWithMappedName, decryptedConfig);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result = {
            provider: canonical,
            success: false,
            eventName: mappedEventName,
            status: 500,
            error: message,
          };
        }
        results.push(result);
        await tx.query(
          `UPDATE conversion_delivery_attempts
           SET status = $2, last_status = $3, last_error = $4, response_snippet = $5,
               delivered_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END,
               locked_until = NULL, updated_at = now()
           WHERE tenant_id = $1 AND provider = $6 AND event_key = $7`,
          [
            payload.tenantId,
            result.success ? "sent" : "failed",
            result.status,
            result.error ?? null,
            result.responseSnippet ? result.responseSnippet.slice(0, 500) : null,
            canonical,
            eventKey,
          ],
        );
      }

      return results;
    });
  }

  async close(): Promise<void> {
    if (this.bullWorker) {
      await this.bullWorker.close();
    }
    if (this.bullQueue) {
      await this.bullQueue.close();
    }
  }
}

export const conversionDispatcher = ConversionDispatcherService.getInstance();
