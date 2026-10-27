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
import { getRedisConnectionOptions } from "../../../infrastructure/redis.js";
import { queryOne } from "../../../db/client.js";
import { EmailService } from "../../../services/email.service.js";

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
      console.warn(`[LeadNotificationQueue] Failed to connect BullMQ to Redis (${msg}), using in-memory queue`);
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
        console.warn(`[LeadNotificationQueue] BullMQ enqueue failed, falling back to in-memory:`, err);
      }
    }

    // In-memory fallback
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

    // Извлечение лида со строгой проверкой tenant_id
    const lead = await queryOne<LeadNotificationData>(
      `SELECT d.id, d.tenant_id, d.stage_id, d.title, d.description, d.budget, d.currency,
              d.custom_fields, d.lead_notified_at, d.created_at,
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

    // Атомарная фиксация времени отправки (идемпотентность — защита от гонок воркеров)
    const updated = await queryOne<{ id: string }>(
      `UPDATE deals
       SET lead_notified_at = now()
       WHERE tenant_id = $1 AND id = $2 AND lead_notified_at IS NULL
       RETURNING id`,
      [tenantId, leadId],
    );

    if (!updated) {
      console.log(`[LeadNotification] Lead ${leadId} already notified by another worker, skipping duplicate`);
      return;
    }

    // Определение адресата нотификации: владелец либо администратор арендатора
    let recipient = await queryOne<{ email: string; name: string }>(
      `SELECT email, name FROM users
       WHERE tenant_id = $1 AND role = 'owner' AND deleted_at IS NULL AND email IS NOT NULL AND email != ''
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenantId],
    );

    if (!recipient) {
      recipient = await queryOne<{ email: string; name: string }>(
        `SELECT email, name FROM users
         WHERE tenant_id = $1 AND role = 'admin' AND deleted_at IS NULL AND email IS NOT NULL AND email != ''
         ORDER BY created_at ASC
         LIMIT 1`,
        [tenantId],
      );
    }

    if (!recipient || !recipient.email) {
      console.warn(`[LeadNotification] No owner/admin email found for tenant ${tenantId}, skipping send`);
      return;
    }

    const appUrl = process.env.PUBLIC_APP_URL || "https://app.getvoxly.ru";
    const crmUrl = `${appUrl}/crm/deals/${lead.id}`;

    const contactNameParts = [lead.contact_first_name, lead.contact_last_name].filter(Boolean);
    const contactName = contactNameParts.length > 0 ? contactNameParts.join(" ") : null;

    const customFields = lead.custom_fields as Record<string, unknown> | null | undefined;
    const phone = lead.contact_phone || (customFields?.phone as string | undefined) || null;
    const email = lead.contact_email || (customFields?.email as string | undefined) || null;
    const telegram = lead.contact_telegram_chat_id || (customFields?.telegram as string | undefined) || null;

    const result = await EmailService.sendLeadNotificationEmail({
      to: recipient.email,
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
      customFields: customFields ?? null,
      createdAt: lead.created_at,
      crmUrl,
    });

    if (result.sent) {
      console.log(`[BullMQ] Notification sent for lead ${lead.id} to ${recipient.email}`);
    } else {
      console.warn(`[LeadNotification] Mailer reported error or not configured: ${result.error}`);
    }
  }

  /**
   * Проверка условий и постановка в очередь при необходимости.
   * Безопасный вызов из бизнес-сервисов (deals.service, crm-pipeline.service, leads.routes).
   */
  async checkAndTriggerNotification(tenantId: string, leadId: string): Promise<boolean> {
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
