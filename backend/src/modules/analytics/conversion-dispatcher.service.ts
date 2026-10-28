import { Queue, Worker } from "bullmq";
import { getEnv } from "../../config/env.js";
import { requireDurableQueue } from "../../infrastructure/redis.js";
import { query } from "../../db/client.js";
import { decryptSecret } from "../../services/credentials-cipher.js";
import type {
  AnalyticsIntegrationRow,
  AnalyticsProvider,
  ConversionEventPayload,
  ConversionResult,
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

        this.bullWorker = new Worker<ConversionEventPayload>(
          QUEUE_NAME,
          async (job: { data: ConversionEventPayload }) => {
            await this.processEvent(job.data);
          },
          { connection, concurrency: 5 },
        );

        this.bullWorker.on("failed", (job: { id?: string } | undefined, err: Error) => {
          // Логгер сбоев при отправке конверсий
          console.warn(`[ConversionDispatcher] Job ${job?.id} failed:`, err.message);
        });
    } catch (err) {
      requireDurableQueue(QUEUE_NAME);
      console.warn("[ConversionDispatcher] Failed to connect BullMQ to Redis:", err);
    }
  }

  async enqueueEvent(payload: ConversionEventPayload): Promise<void> {
    if (this.bullQueue) {
      await this.bullQueue.add("dispatch-conversion", payload);
      return;
    }

    // In-memory fallback is intentionally limited to development and tests.
    requireDurableQueue(QUEUE_NAME);
    this.inMemoryQueue.push(payload);
    void this.processNextInMemory();
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

    const eventPayload: ConversionEventPayload = {
      tenantId,
      dealId: deal.id,
      dealTitle: deal.title,
      stageId,
      stageName: deal.stage_name,
      isWon: deal.is_won,
      isLost: deal.is_lost,
      budget: Number(deal.budget || 0),
      currency: deal.currency || "RUB",
      contactId: deal.contact_id,
      clientId,
      ymUid,
      gaId: clientId,
      email,
      phone,
      eventName: deal.is_won ? "Purchase" : "Lead",
      timestamp: new Date().toISOString(),
    };

    await this.enqueueEvent(eventPayload);
  }

  private async processNextInMemory(): Promise<void> {
    if (this.isProcessingInMemory || this.inMemoryQueue.length === 0) return;
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
    // 1. Получаем активные интеграции для тенанта
    const integrations = await query<AnalyticsIntegrationRow>(
      `SELECT id, tenant_id, provider, config, is_active, created_at, updated_at
       FROM analytics_integrations
       WHERE tenant_id = $1 AND is_active = true`,
      [payload.tenantId],
    );

    if (integrations.length === 0) {
      return [];
    }

    const results: ConversionResult[] = [];

    // 2. Рассылаем событие параллельно во все подключенные счетчики
    for (const integration of integrations) {
      const provider = this.providers.get(integration.provider);
      if (!provider) continue;

      const rawConfig = integration.config || {};
      const stageEvents = (rawConfig.stageEvents as Record<string, string>) || {};

      // Определяем имя события: маппинг из стадии -> дефолт по статусу (Purchase / QualifiedLead / Lead)
      const mappedEventName =
        stageEvents[payload.stageId] ||
        (payload.isWon ? "Purchase" : payload.eventName || "Lead");

      // Расшифровываем токены для сетевого вызова
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

      try {
        const res = await provider.sendEvent(eventPayloadWithMappedName, decryptedConfig);
        results.push(res);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          provider: integration.provider,
          success: false,
          eventName: mappedEventName,
          status: 500,
          error: message,
        });
      }
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
