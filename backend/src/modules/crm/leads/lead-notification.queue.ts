// ---------------------------------------------------------------------------
// Очередь нотификаций о новых лидах / заявках (BullMQ / Background Queue).
//
// Реализует асинхронную отправку почтовых уведомлений владельцам арендатора
// о поступивших заявках с контактными данными.
//
// Бизнес-правило (Guard Clause):
// 1. Лиды на этапе «Первый контакт» (анонимный веб-чат без контактов) НЕ вызывают отправку.
// 2. Отправка инициируется только при наличии контактных данных (телефон, email, мессенджер)
//    и переходе из «Первого контакта» в квалифицированный этап, либо при создании заявки с контактами.
// 3. Защита от дублей: поле deals.lead_notified_at гарантирует идемпотентность (ровно 1 письмо на лид).
// ---------------------------------------------------------------------------

import { Queue, Worker, type JobsOptions } from "bullmq";
import { getRedisConnectionOptions, requireDurableQueue } from "../../../infrastructure/redis.js";
import { registerBullQueue } from "../../../infrastructure/queue-metrics.js";
import { query, queryOne, runWithTenantContext } from "../../../db/client.js";
import { EmailService } from "../../../services/email.service.js";
import { TelegramService, escapeHtml } from "../../auth/telegram.service.js";
import { bitrix24Service } from "../../integrations/bitrix24/bitrix24.service.js";
import type { LeadSource } from "../../integrations/bitrix24/bitrix24.types.js";
import type { NotificationChannelType } from "../../notifications/notification-channels.types.js";
import { getDealConversationSummary } from "./lead-summary.service.js";

export interface LeadNotificationJobData {
  tenantId: string;
  leadId: string;
}

export interface LeadNotificationData {
  id: string;
  tenant_id: string;
  stage_id: string;
  stage_name?: string | null;
  title: string;
  description?: string | null;
  budget?: number | string | null;
  currency?: string | null;
  custom_fields?: Record<string, unknown> | null;
  source_metadata?: Record<string, unknown> | null;
  source_widget_id?: string | null;
  lead_notified_at?: Date | string | null;
  created_at: Date | string;
  contact_id?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_telegram_chat_id?: string | null;
  contact_channel?: string | null;
  tenant_name?: string;
}

export const LEAD_NOTIFICATIONS_QUEUE_NAME = "lead-notifications";

/**
 * Проверка этапа «Первый контакт».
 */
export function isFirstContactStage(stageName?: string | null): boolean {
  if (!stageName) return false;
  const s = stageName.trim().toLowerCase();
  return s === "первый контакт" || s === "first_contact" || s.startsWith("первый контакт");
}

/**
 * Контракт бизнес-правила (Guard Clause).
 * Возвращает true только если лид готов к отправке уведомления.
 */
export function shouldNotifyLead(lead: LeadNotificationData): boolean {
  // 1. Защита от повторной отправки (идемпотентность)
  if (lead.lead_notified_at !== null && lead.lead_notified_at !== undefined) {
    return false;
  }

  // 2. Фильтрация этапа: «Первый контакт» категорически не отправляется
  if (isFirstContactStage(lead.stage_name)) {
    return false;
  }

  // 3. Проверка наличия хотя бы одного контакта
  const hasContactPhone = Boolean(lead.contact_phone && lead.contact_phone.trim().length > 0);
  const hasContactEmail = Boolean(lead.contact_email && lead.contact_email.trim().length > 0);
  const hasContactTelegram = Boolean(lead.contact_telegram_chat_id && lead.contact_telegram_chat_id.trim().length > 0);

  const customFields = lead.custom_fields;
  const hasCustomPhone = Boolean(
    customFields &&
    typeof customFields.phone === "string" &&
    customFields.phone.trim().length > 0,
  );
  const hasCustomEmail = Boolean(
    customFields &&
    typeof customFields.email === "string" &&
    customFields.email.trim().length > 0,
  );
  const hasCustomTelegram = Boolean(
    customFields &&
    typeof customFields.telegram === "string" &&
    customFields.telegram.trim().length > 0,
  );

  const hasAnyContact =
    hasContactPhone ||
    hasContactEmail ||
    hasContactTelegram ||
    hasCustomPhone ||
    hasCustomEmail ||
    hasCustomTelegram;

  if (!hasAnyContact) {
    return false;
  }

  return true;
}

/**
 * Форматирование HTML-сообщения о новом лиде для Telegram Bot API.
 */
export function formatLeadTelegramNotification(options: {
  leadTitle: string;
  tenantName: string;
  stageName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  telegram?: string | null;
  channel?: string | null;
  budget?: number | null;
  currency?: string | null;
  conversationSummary?: string | null;
  crmUrl: string;
}): string {
  const parts: string[] = [
    `<b>Новая заявка:</b> ${escapeHtml(options.leadTitle)}`,
    `<b>Компания:</b> ${escapeHtml(options.tenantName)}`,
    `<b>Этап:</b> ${escapeHtml(options.stageName || "Квалифицирован")}`,
  ];

  if (options.conversationSummary) {
    parts.push("");
    parts.push(`<b>Суть обращения:</b>\n${escapeHtml(options.conversationSummary)}`);
  }

  parts.push("");
  parts.push(`<b>Контакт:</b> ${escapeHtml(options.contactName || "Не указан")}`);

  if (options.phone) parts.push(`<b>Телефон:</b> ${escapeHtml(options.phone)}`);
  if (options.email) parts.push(`<b>Email:</b> ${escapeHtml(options.email)}`);
  if (options.telegram) parts.push(`<b>Telegram:</b> ${escapeHtml(options.telegram)}`);
  if (options.channel) parts.push(`<b>Канал:</b> ${escapeHtml(options.channel)}`);
  if (options.budget !== null && options.budget !== undefined && options.budget > 0) {
    parts.push(`<b>Бюджет:</b> ${options.budget.toLocaleString("ru-RU")} ${escapeHtml(options.currency || "RUB")}`);
  }

  parts.push("");
  parts.push(`<a href="${options.crmUrl}">Открыть сделку в CRM</a>`);

  return parts.join("\n");
}

export class LeadNotificationQueueService {
  private static instance: LeadNotificationQueueService | null = null;
  private bullQueue: Queue<LeadNotificationJobData> | null = null;
  private bullWorker: Worker<LeadNotificationJobData> | null = null;
  private inMemoryQueue: Array<{
    id: string;
    name: string;
    data: LeadNotificationJobData;
  }> = [];
  private isProcessingInMemory = false;

  private constructor() {
    this.initBullMQ();
  }

  static getInstance(): LeadNotificationQueueService {
    if (!this.instance) {
      this.instance = new LeadNotificationQueueService();
    }
    return this.instance;
  }

  private initBullMQ(): void {
    const connOptions = getRedisConnectionOptions();
    if (!connOptions) {
      requireDurableQueue(LEAD_NOTIFICATIONS_QUEUE_NAME);
      return;
    }

    try {
      this.bullQueue = new Queue<LeadNotificationJobData>(LEAD_NOTIFICATIONS_QUEUE_NAME, {
        connection: connOptions,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000,
          },
          removeOnComplete: true,
        },
      });
      registerBullQueue(LEAD_NOTIFICATIONS_QUEUE_NAME, this.bullQueue as Queue<unknown>);

      this.bullQueue.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (process.env.NODE_ENV !== "test") {
          console.warn(`[BullMQ] Queue error in '${LEAD_NOTIFICATIONS_QUEUE_NAME}': ${msg}`);
        }
      });

      this.bullWorker = new Worker<LeadNotificationJobData>(
        LEAD_NOTIFICATIONS_QUEUE_NAME,
        async (job: { data: LeadNotificationJobData }) => {
          await this.processLeadNotification(job.data);
        },
        {
          connection: connOptions,
          concurrency: 2,
        },
      );

      this.bullWorker.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (process.env.NODE_ENV !== "test") {
          console.warn(`[BullMQ] Worker error in '${LEAD_NOTIFICATIONS_QUEUE_NAME}': ${msg}`);
        }
      });

      this.bullWorker.on("failed", (job: { id?: string } | undefined, err: Error) => {
        console.error(`[BullMQ] Job ${job?.id} in queue '${LEAD_NOTIFICATIONS_QUEUE_NAME}' failed:`, err.message);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      requireDurableQueue(LEAD_NOTIFICATIONS_QUEUE_NAME);
      console.warn(`[LeadNotificationQueue] Failed to connect BullMQ to Redis (${msg})`);
      this.bullQueue = null;
      this.bullWorker = null;
    }
  }

  /**
   * Постановка задачи отправки email-уведомления о лиде в очередь.
   */
  async add(
    name: "sendLeadNotificationJob" | string,
    data: LeadNotificationJobData,
    opts?: JobsOptions,
  ): Promise<{ id: string }> {
    const jobId = `lead-notif-${data.leadId}-${Date.now()}`;

    // Формат логирования постановки задачи BullMQ
    console.log(`[BullMQ] Job sendLeadNotificationJob added for lead ${data.leadId} (tenant: ${data.tenantId})`);

    if (this.bullQueue) {
      try {
        const job = await this.bullQueue.add(name, data, {
          jobId,
          ...opts,
        });
        return { id: String(job.id || jobId) };
      } catch (err) {
        requireDurableQueue(LEAD_NOTIFICATIONS_QUEUE_NAME);
        console.warn(`[LeadNotificationQueue] BullMQ enqueue failed:`, err);
      }
    }

    // In-memory fallback is intentionally limited to development and tests.
    requireDurableQueue(LEAD_NOTIFICATIONS_QUEUE_NAME);
    this.inMemoryQueue.push({ id: jobId, name, data });
    void this.processNextInMemory();
    return { id: jobId };
  }

  private async processNextInMemory(): Promise<void> {
    if (this.isProcessingInMemory || this.inMemoryQueue.length === 0) {
      return;
    }

    this.isProcessingInMemory = true;
    try {
      const item = this.inMemoryQueue.shift();
      if (!item) return;

      if (item.name === "sendLeadNotificationJob") {
        await this.processLeadNotification(item.data);
      }
    } catch (err) {
      console.error("[LeadNotificationQueue] In-memory job failed:", err);
    } finally {
      this.isProcessingInMemory = false;
      if (this.inMemoryQueue.length > 0) {
        setTimeout(() => void this.processNextInMemory(), 100);
      }
    }
  }

  /**
   * Обработчик задачи воркера: выборка лида с multi-tenant изоляцией,
   * проверка guard clause, атомарная фиксация отправки и вызов EmailService.
   */
  async processLeadNotification(data: LeadNotificationJobData): Promise<void> {
    const { tenantId, leadId } = data;
    console.log(`[BullMQ] Worker processing job sendLeadNotificationJob for lead ${leadId}`);

    return runWithTenantContext(tenantId, async () => {
      // Извлечение лида со строгой проверкой tenant_id
      const lead = await queryOne<LeadNotificationData>(
      `SELECT d.id, d.tenant_id, d.stage_id, d.title, d.description, d.budget, d.currency,
              d.custom_fields, d.source_metadata, d.source_widget_id, d.lead_notified_at, d.created_at,
              s.name AS stage_name,
              c.id AS contact_id, c.first_name AS contact_first_name, c.last_name AS contact_last_name,
              c.phone AS contact_phone, c.email AS contact_email, c.telegram_chat_id AS contact_telegram_chat_id,
              c.channel AS contact_channel,
              t.name AS tenant_name
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       JOIN tenants t ON t.id = d.tenant_id
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, leadId],
    );

    if (!lead) {
      console.warn(`[LeadNotification] Lead ${leadId} not found for tenant ${tenantId}`);
      return;
    }

    // Проверка guard clause
    if (!shouldNotifyLead(lead)) {
      console.log(`[LeadNotification] Skipping lead ${leadId}: condition not met (stage is First Contact or missing contacts)`);
      return;
    }

    // Claim a durable delivery slot before touching external providers. A crashed
    // worker leaves a short lease; another attempt can retry after it expires.
    const deliveryClaim = await queryOne<{ id: string }>(
      `INSERT INTO lead_notification_deliveries (tenant_id, deal_id, status, attempts, locked_until)
       VALUES ($1, $2, 'pending', 1, now() + interval '5 minutes')
       ON CONFLICT (tenant_id, deal_id) DO UPDATE
       SET status = 'pending', attempts = lead_notification_deliveries.attempts + 1,
           locked_until = now() + interval '5 minutes',
           last_error = NULL, updated_at = now()
       WHERE lead_notification_deliveries.status <> 'sent'
         AND (lead_notification_deliveries.locked_until IS NULL OR lead_notification_deliveries.locked_until < now())
       RETURNING id`,
      [tenantId, leadId],
    );
    if (!deliveryClaim) {
      console.log(`[LeadNotification] Lead ${leadId} is already being delivered or was sent`);
      return;
    }

    // Delivery is claimed only after at least one channel confirms success.
    // The durable lease above prevents concurrent duplicate sends and allows retry.
    let delivered = false;
    let deliveredChannel: "email" | "telegram" | "whatsapp" | null = null;
    let providerMessageId: string | null = null;
    let providerResponse: Record<string, unknown> | null = null;

    // 1. Извлекаем активные каналы уведомлений тенанта (Email, Telegram, WhatsApp, Bitrix24)
    const configuredChannels = await query<{
      id: string;
      channel_type: NotificationChannelType;
      destination: string;
      extra_meta: Record<string, unknown>;
    }>(
      `SELECT id, channel_type, destination, extra_meta
       FROM tenant_notification_channels
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [tenantId],
    );

    // 2. Определение дефолтного получателя (владелец либо администратор) на случай отсутствия email-каналов
    let defaultRecipient = await queryOne<{ email: string; name: string }>(
      `SELECT email, name FROM users
       WHERE tenant_id = $1 AND role = 'owner' AND deleted_at IS NULL AND email IS NOT NULL AND email != ''
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenantId],
    );

    if (!defaultRecipient) {
      defaultRecipient = await queryOne<{ email: string; name: string }>(
        `SELECT email, name FROM users
         WHERE tenant_id = $1 AND role = 'admin' AND deleted_at IS NULL AND email IS NOT NULL AND email != ''
         ORDER BY created_at ASC
         LIMIT 1`,
        [tenantId],
      );
    }

    const appUrl = process.env.PUBLIC_APP_URL || "https://app.getvoxly.ru";
    const crmUrl = `${appUrl}/crm/deals/${lead.id}`;

    const contactNameParts = [lead.contact_first_name, lead.contact_last_name].filter(Boolean);
    const contactName = contactNameParts.length > 0 ? contactNameParts.join(" ") : null;

    const customFields = lead.custom_fields as Record<string, unknown> | null | undefined;
    const phone = lead.contact_phone || (customFields?.phone as string | undefined) || null;
    const email = lead.contact_email || (customFields?.email as string | undefined) || null;
    const telegram = lead.contact_telegram_chat_id || (customFields?.telegram as string | undefined) || null;

    // Извлечение краткого резюме переписки с клиентом (AI-саммари / детерминированный fallback)
    const conversationSummary = await getDealConversationSummary(tenantId, lead.id);

    // --- Канал 1: Email ---
    const emailChannels = configuredChannels.filter((c) => c.channel_type === "email");
    const emailsToSend = new Set<string>();
    for (const ch of emailChannels) {
      if (ch.destination && ch.destination.trim()) {
        emailsToSend.add(ch.destination.trim());
      }
    }
    // Если пользовательские email-каналы не заданы, шлём на основной e-mail владельца
    if (emailsToSend.size === 0 && defaultRecipient?.email) {
      emailsToSend.add(defaultRecipient.email.trim());
    }

    for (const toEmail of emailsToSend) {
      const result = await EmailService.sendLeadNotificationEmail({
        to: toEmail,
        tenantName: lead.tenant_name || "GETVOXLY",
        leadTitle: lead.title,
        contactName,
        phone,
        email,
        telegram,
        channel: lead.contact_channel || "Прямое обращение",
        stageName: lead.stage_name,
        budget: lead.budget ? Number(lead.budget) : null,
        currency: lead.currency || "RUB",
        conversationSummary,
        customFields: customFields ?? null,
        createdAt: lead.created_at,
        crmUrl,
      });

      if (result.sent) {
        delivered = true;
        deliveredChannel = "email";
        providerResponse = { sent: result.sent };
        console.log(`[BullMQ] Notification sent for lead ${lead.id} to ${toEmail}`);
      } else {
        console.warn(`[LeadNotification] Mailer reported error or not configured: ${result.error}`);
      }
    }

    // --- Канал 2: Telegram (100% антибан через официальный Bot API) ---
    const telegramChannels = configuredChannels.filter((c) => c.channel_type === "telegram");
    if (telegramChannels.length > 0) {
      const telegramService = new TelegramService();
      if (telegramService.isConfigured) {
        const tgText = formatLeadTelegramNotification({
          leadTitle: lead.title,
          tenantName: lead.tenant_name || "GETVOXLY",
          stageName: lead.stage_name,
          contactName,
          phone,
          email,
          telegram,
          channel: lead.contact_channel || "Прямое обращение",
          budget: lead.budget ? Number(lead.budget) : null,
          currency: lead.currency || "RUB",
          conversationSummary,
          crmUrl,
        });

        for (const ch of telegramChannels) {
          try {
            const res = await telegramService.sendMessage(ch.destination, tgText, {
              parseMode: "HTML",
            });
            if (res.delivered) {
              delivered = true;
              deliveredChannel = "telegram";
              providerResponse = { delivered: res.delivered };
              console.log(
                `[BullMQ] Telegram notification sent for lead ${lead.id} to chat ${ch.destination}`,
              );
            } else {
              console.warn(
                `[BullMQ] Telegram notification failed for lead ${lead.id} to chat ${ch.destination}: ${res.reason}`,
              );
            }
          } catch (err) {
            console.warn(
              `[BullMQ] Telegram dispatch error for lead ${lead.id} to chat ${ch.destination}:`,
              err,
            );
          }
        }
      } else {
        console.warn(
          `[LeadNotification] TelegramService not configured, skipping telegram delivery for lead ${lead.id}`,
        );
      }
    }

    const whatsappChannels = configuredChannels.filter((c) => c.channel_type === "whatsapp");
    if (whatsappChannels.length > 0) {
      const whatsappService = new (await import("../../channels/whatsapp-evolution.service.js")).WhatsappEvolutionService();
      for (const ch of whatsappChannels) {
        const account = await queryOne<{ credentials: { instanceName?: string } | null }>(
          `SELECT credentials FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'whatsapp' AND status = 'connected' AND deleted_at IS NULL
           ORDER BY connected_at ASC LIMIT 1`,
          [tenantId],
        );
        const instanceName = account?.credentials?.instanceName;
        if (!instanceName) {
          console.warn(`[LeadNotification] WhatsApp instance is not connected for ${ch.destination}`);
          continue;
        }
        try {
          const result = await whatsappService.sendTextMessage(instanceName, ch.destination, `Новая заявка: ${lead.title}\nОткрыть сделку: ${crmUrl}`);
          if (result.ok) {
            delivered = true;
            deliveredChannel = "whatsapp";
            providerMessageId = result.messageId ?? null;
            providerResponse = { ok: result.ok, messageId: result.messageId ?? null };
          } else {
            console.warn(`[LeadNotification] WhatsApp delivery failed: ${result.error ?? "unknown error"}`);
          }
        } catch (error) {
          console.warn(`[LeadNotification] WhatsApp provider error:`, error);
        }
      }
    }

    // --- Канал 4: Битрикс24 (Экспорт лида через входящий вебхук crm.lead.add) ---
    try {
      const yaClientId =
        (customFields?.ym_uid as string) ||
        (customFields?.ym_client_id as string) ||
        (customFields?.ya_client_id as string) ||
        (customFields?.yandex_client_id as string) ||
        (customFields?.ya_cid as string) ||
        (lead.contact_id ? await this.resolveYaClientId(tenantId, lead.contact_id, lead.id) : null);

      const tenantRow = await queryOne<{ slug: string }>(
        `SELECT slug FROM tenants WHERE id = $1`,
        [tenantId],
      );

      const b24Payload = {
        leadId: lead.id,
        title: lead.title,
        contactName,
        phone,
        email,
        yaClientId,
        comments: conversationSummary || lead.description || null,
        budget: lead.budget ? Number(lead.budget) : null,
        currency: lead.currency || "RUB",
        utmTags: (customFields?.utm_tags as Record<string, string>) || null,
        tenantIdentifier: tenantRow?.slug || lead.tenant_name || "getvoxly",
        sourceMetadata: lead.source_metadata,
        sourceWidgetId: lead.source_widget_id,
        contactChannel: lead.contact_channel,
        customFields,
      };

      const b24Channels = configuredChannels.filter((c) => c.channel_type === "bitrix24");

      if (b24Channels.length > 0) {
        for (const b24Ch of b24Channels) {
          const meta = b24Ch.extra_meta ?? {};
          const allowedSources = Array.isArray(meta.allowed_sources)
            ? (meta.allowed_sources as LeadSource[])
            : [];
          const selectedWidgets = Array.isArray(meta.selected_widget_ids)
            ? (meta.selected_widget_ids as string[])
            : [];
          const customSourceId = typeof meta.custom_source_id === "string" && meta.custom_source_id.trim()
            ? meta.custom_source_id.trim()
            : "UC_VWN1ZK";

          const b24Result = await bitrix24Service.sendLead(
            tenantId,
            b24Payload,
            {
              webhook_url: b24Ch.destination,
              is_enabled: true,
              allowed_sources: allowedSources,
              selected_widget_ids: selectedWidgets,
              custom_source_id: customSourceId,
              send_utm_marks: meta.send_utm_marks !== false,
              send_geo_data: meta.send_geo_data !== false,
            },
          );

          if (b24Result.success && b24Result.leadId) {
            delivered = true;
            if (!deliveredChannel) deliveredChannel = "email";
            console.log(`[BullMQ] Lead ${lead.id} exported to Bitrix24 (ID: ${b24Result.leadId}, Channel: ${b24Ch.id})`);
            try {
              await query(
                `UPDATE tenant_notification_channels
                 SET extra_meta = extra_meta || $3::jsonb, updated_at = NOW()
                 WHERE tenant_id = $1 AND id = $2`,
                [
                  tenantId,
                  b24Ch.id,
                  JSON.stringify({
                    last_lead_id: String(b24Result.leadId),
                    last_sync_at: new Date().toISOString(),
                    last_error: null,
                  }),
                ],
              );
            } catch {}
          } else if (b24Result.skipped) {
            console.log(`[BullMQ] Lead ${lead.id} skipped for Bitrix24 channel ${b24Ch.id} (${b24Result.reason || "skipped"})`);
          }
        }
      } else {
        const b24Result = await bitrix24Service.sendLead(tenantId, b24Payload);
        if (b24Result.success && b24Result.leadId) {
          delivered = true;
          if (!deliveredChannel) {
            deliveredChannel = "email"; // fallback маркер канала для статистики доставки
          }
          console.log(`[BullMQ] Lead ${lead.id} exported to Bitrix24 (ID: ${b24Result.leadId})`);
        } else if (b24Result.skipped) {
          console.log(`[BullMQ] Lead ${lead.id} skipped for Bitrix24 (${b24Result.reason || "skipped"})`);
        }
      }
    } catch (b24Err) {
      console.warn(`[LeadNotification] Bitrix24 lead export non-blocking error:`, b24Err);
    }

    if (!delivered) {
      const errorMessage = "No notification channel delivered the lead";
      await query(
        `UPDATE lead_notification_deliveries
         SET status = 'failed', last_error = $3, locked_until = NULL, updated_at = now()
         WHERE tenant_id = $1 AND deal_id = $2 AND status <> 'sent'`,
        [tenantId, leadId, errorMessage],
      );
      throw new Error(`${errorMessage}: ${lead.id}`);
    }

    await query(
      `UPDATE lead_notification_deliveries
       SET status = 'sent', delivered_at = now(), locked_until = NULL, last_error = NULL,
           delivered_channel = $3, provider_message_id = $4, provider_response = $5::jsonb,
           updated_at = now()
       WHERE tenant_id = $1 AND deal_id = $2 AND status <> 'sent'`,
      [tenantId, leadId, deliveredChannel, providerMessageId, JSON.stringify(providerResponse ?? {})],
    );

    const claimed = await queryOne<{ id: string }>(
      `UPDATE deals SET lead_notified_at = now()
       WHERE tenant_id = $1 AND id = $2 AND lead_notified_at IS NULL
       RETURNING id`,
      [tenantId, leadId],
    );
    if (!claimed) {
      console.log(`[LeadNotification] Lead ${leadId} was claimed by another worker`);
    }
    });
  }

  /**
   * Проверка условий и постановка в очередь при необходимости.
   * Безопасный вызов из бизнес-сервисов (deals.service, crm-pipeline.service, leads.routes).
   */
  async checkAndTriggerNotification(tenantId: string, leadId: string): Promise<boolean> {
    return runWithTenantContext(tenantId, async () => {
      try {
        const lead = await queryOne<LeadNotificationData>(
          `SELECT d.id, d.tenant_id, d.stage_id, d.title, d.description, d.budget, d.currency,
                  d.custom_fields, d.lead_notified_at, d.created_at,
                  s.name AS stage_name,
                  c.id AS contact_id, c.first_name AS contact_first_name, c.last_name AS contact_last_name,
                  c.phone AS contact_phone, c.email AS contact_email, c.telegram_chat_id AS contact_telegram_chat_id,
                  c.channel AS contact_channel
           FROM deals d
           JOIN stages s ON s.id = d.stage_id
           LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
           WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
          [tenantId, leadId],
        );

        if (!lead) return false;

        if (!shouldNotifyLead(lead)) {
          console.log(`[LeadNotification] Lead ${leadId} skipped: stage is First Contact or missing contacts`);
          return false;
        }

        await this.add("sendLeadNotificationJob", { tenantId, leadId });
        return true;
      } catch (err) {
        console.warn(`[LeadNotification] Failed to check and trigger notification for lead ${leadId}:`, err);
        return false;
      }
    });
  }

  private async resolveYaClientId(
    tenantId: string,
    contactId: string,
    dealId: string,
  ): Promise<string | null> {
    try {
      const session = await queryOne<{ ym_client_id: string | null }>(
        `SELECT ym_client_id FROM analytics_sessions
         WHERE tenant_id = $1 AND (contact_id = $2 OR deal_id = $3) AND ym_client_id IS NOT NULL AND ym_client_id <> ''
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, contactId, dealId],
      );
      return session?.ym_client_id ?? null;
    } catch {
      return null;
    }
  }

  async shutdown(): Promise<void> {
    if (this.bullWorker) {
      await this.bullWorker.close();
      this.bullWorker = null;
    }
    if (this.bullQueue) {
      await this.bullQueue.close();
      this.bullQueue = null;
    }
  }
}

export const leadNotificationQueue = LeadNotificationQueueService.getInstance();
export default leadNotificationQueue;
