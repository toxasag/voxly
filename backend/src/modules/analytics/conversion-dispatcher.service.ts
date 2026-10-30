import { Queue, Worker } from "bullmq";
import { registerBullQueue } from "../../infrastructure/queue-metrics.js";
import { createHash } from "node:crypto";
import { getEnv } from "../../config/env.js";
import { requireDurableQueue } from "../../infrastructure/redis.js";
import { query, queryOne } from "../../db/client.js";
import { decryptSecret } from "../../services/credentials-cipher.js";
import type {
  AnalyticsIntegrationRow,
  AnalyticsProvider,
  ConversionDeliveryAttemptRow,
  ConversionEventPayload,
  ConversionResult,
  TestQueueResult,
  TestQueueStatus,
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
    const redisUrl = getEnv().REDIS_URL;

    if (!redisUrl) {
      requireDurableQueue(QUEUE_NAME);
      return;
    }
    try {
      const parsed = new URL(redisUrl);
      const connection = {
        host: parsed.hostname || "127.0.0.1",
        port: parsed.port ? parseInt(parsed.port, 10) : 6379,
        password: parsed.password || undefined,
        username: parsed.username || undefined,
      };

      this.bullQueue = new Queue<ConversionEventPayload>(QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 3000,
          },
          removeOnComplete: true,
        },
      });
      registerBullQueue(QUEUE_NAME, this.bullQueue as Queue<unknown>);

      this.bullWorker = new Worker<ConversionEventPayload>(
        QUEUE_NAME,
        async (job: { data: ConversionEventPayload }) => {
          await this.processEvent(job.data);
        },
        { connection, concurrency: 5 },
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
        removeOnComplete: false,
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
    const row = await queryOne<ConversionDeliveryAttemptRow>(
      `SELECT status, attempts, last_status, last_error, response_snippet, delivered_at
       FROM conversion_delivery_attempts
       WHERE tenant_id = $1 AND job_id = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantId, jobId],
    );

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

  async handleDealStageChanged(payload: {
    tenantId: string;
    dealId: string;
    stageId: string;
  }): Promise<void> {
    const { tenantId, dealId, stageId } = payload;

    const dealRow = await query<{
      id: string;
      title: string;
      budget: string;
      currency: string;
      contact_id: string | null;
      custom_fields: Record<string, unknown> | null;
      stage_name: string;
      is_won: boolean;
      is_lost: boolean;
    }>(
      `SELECT d.id, d.title, d.budget::text, d.currency, d.contact_id, d.custom_fields,
              s.name AS stage_name, s.is_won, s.is_lost
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, dealId],
    );

    const deal = dealRow[0];
    if (!deal) return;

    let email: string | null = null;
    let phone: string | null = null;
    let contactCustomFields: Record<string, unknown> = {};

    if (deal.contact_id) {
      const contactRows = await query<{
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
      deal.custom_fields && typeof deal.custom_fields === "object"
        ? deal.custom_fields
        : {};

    const clientId =
      (dealCustomFields.client_id as string) ||
      (dealCustomFields.ga_client_id as string) ||
      (contactCustomFields.client_id as string) ||
      (contactCustomFields.ga_client_id as string) ||
      null;

    const ymUid =
      (dealCustomFields.ym_uid as string) ||
      (dealCustomFields.yandex_client_id as string) ||
      (contactCustomFields.ym_uid as string) ||
      (contactCustomFields.yandex_client_id as string) ||
      null;

    const yandexuid =
      (dealCustomFields.yandexuid as string) ||
      (contactCustomFields.yandexuid as string) ||
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

    const eventPayload: ConversionEventPayload = {
      tenantId,
      dealId: deal.id,
      dealTitle: deal.title,
      stageId,
      stageName: deal.stage_name,
      isWon: deal.is_won,
      isLost: deal.is_lost,
      budget: parseFloat(deal.budget) || 0,
      currency: deal.currency || "RUB",
      contactId: deal.contact_id,
      clientId,
      ymUid,
      yandexuid,
      gaId,
      fbId,
      tmrLvid,
      email,
      phone,
      eventName: deal.is_won ? "Purchase" : "DealStageChanged",
    };

    await this.enqueueEvent(eventPayload);
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

  async processEvent(payload: ConversionEventPayload): Promise<ConversionResult[]> {
    // Получаем активные интеграции для тенанта
    const integrations = await query<AnalyticsIntegrationRow>(
      `SELECT id, tenant_id, provider, site_name, site_url, counter_id, channel_account_id, is_default, config, is_active, created_at, updated_at
       FROM analytics_integrations
       WHERE tenant_id = $1 AND is_active = true`,
      [payload.tenantId],
    );

    if (integrations.length === 0) {
      return [];
    }

    const results: ConversionResult[] = [];

    for (const integration of integrations) {
      const provider = this.providers.get(integration.provider);
      if (!provider) continue;

      const rawConfig = integration.config || {};
      const stageEvents = (rawConfig.stageEvents as Record<string, string>) || {};

      const mappedEventName =
        stageEvents[payload.stageId || ""] ||
        (payload.isWon ? "Purchase" : payload.eventName || "Lead");

      const decryptedConfig: Record<string, unknown> = { ...rawConfig };
      if (typeof decryptedConfig.oauthToken === "string") {
        decryptedConfig.oauthToken = safeDecrypt(decryptedConfig.oauthToken);
      }
      if (typeof decryptedConfig.apiSecret === "string") {
        decryptedConfig.apiSecret = safeDecrypt(decryptedConfig.apiSecret);
      }
      if (typeof decryptedConfig.accessToken === "string") {
        decryptedConfig.accessToken = safeDecrypt(decryptedConfig.accessToken);
      }

      const eventPayloadWithMappedName: ConversionEventPayload = {
        ...payload,
        eventName: mappedEventName,
      };

      const eventKey = conversionEventKey(eventPayloadWithMappedName, integration.provider);
      const claimed = await query<{ id: string }>(
        `INSERT INTO conversion_delivery_attempts
           (tenant_id, deal_id, provider, event_key, event_name, status, attempts, locked_until, payload, is_test, job_id)
         VALUES ($1, $2, $3, $4, $5, 'pending', 1, now() + interval '5 minutes', $6::jsonb, $7, $8)
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
          integration.provider,
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
          provider: integration.provider,
          success: false,
          eventName: mappedEventName,
          status: 500,
          error: message,
        };
      }
      results.push(result);
      await query(
        `UPDATE conversion_delivery_attempts
         SET status = $3, last_status = $4, last_error = $5, response_snippet = $6,
             delivered_at = CASE WHEN $3 = 'sent' THEN now() ELSE NULL END,
             locked_until = NULL, updated_at = now()
         WHERE tenant_id = $1 AND provider = $7 AND event_key = $8`,
        [
          payload.tenantId,
          payload.dealId ?? null,
          result.success ? "sent" : "failed",
          result.status,
          result.error ?? null,
          result.responseSnippet ?? null,
          integration.provider,
          eventKey,
        ],
      );
    }

    return results;
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
