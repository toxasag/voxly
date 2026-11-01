// ---------------------------------------------------------------------------
// Очередь уведомлений и диспетчер Push/In-App (BullMQ / Notification Queue).
//
// Обрабатывает фоновые события:
// 1. LEAD_CREATED — новая заявка / лид в CRM
// 2. MESSAGE_RECEIVED — входящее сообщение из чата / Telegram / мессенджеров
// 3. TASK_ASSIGNED — назначение задачи сотруднику
// 4. TASK_STATUS_CHANGED — изменение статуса задачи
// 5. TEST_NOTIFICATION — проверка доставки на клиентское устройство
// ---------------------------------------------------------------------------

import { Queue, Worker } from "bullmq";
import { getRedisConnectionOptions, requireDurableQueue } from "../../infrastructure/redis.js";
import { registerBullQueue } from "../../infrastructure/queue-metrics.js";
import { queryOne, runWithTenantContext } from "../../db/client.js";
import { pushNotificationService, type WebPushPayload } from "./push-notification.service.js";

export const NOTIFICATIONS_QUEUE_NAME = "notifications-queue";

export interface LeadCreatedJobData {
  type: "LEAD_CREATED";
  tenantId: string;
  dealId: string;
}

export interface MessageReceivedJobData {
  type: "MESSAGE_RECEIVED";
  tenantId: string;
  dealId: string;
  senderName: string;
  text: string;
  channel?: string;
}

export interface TaskAssignedJobData {
  type: "TASK_ASSIGNED";
  tenantId: string;
  taskId: string;
  assigneeId: string;
}

export interface TaskStatusChangedJobData {
  type: "TASK_STATUS_CHANGED";
  tenantId: string;
  taskId: string;
  oldStatus?: string;
  newStatus: string;
}

export interface TestNotificationJobData {
  type: "TEST_NOTIFICATION";
  tenantId: string;
  userId: string;
  title?: string;
  body?: string;
  url?: string;
}

export type NotificationJobData =
  | LeadCreatedJobData
  | MessageReceivedJobData
  | TaskAssignedJobData
  | TaskStatusChangedJobData
  | TestNotificationJobData;

export class NotificationQueueService {
  private static instance: NotificationQueueService | null = null;
  private bullQueue: Queue<NotificationJobData> | null = null;
  private bullWorker: Worker<NotificationJobData> | null = null;

  private constructor() {
    this.init();
  }

  public static getInstance(): NotificationQueueService {
    if (!NotificationQueueService.instance) {
      NotificationQueueService.instance = new NotificationQueueService();
    }
    return NotificationQueueService.instance;
  }

  private init(): void {
    const connection = getRedisConnectionOptions();
    if (!connection) {
      requireDurableQueue(NOTIFICATIONS_QUEUE_NAME);
      return;
    }

    try {
      this.bullQueue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000,
          },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
        },
      });

      registerBullQueue(NOTIFICATIONS_QUEUE_NAME, this.bullQueue as Queue<unknown>);

      this.bullWorker = new Worker<NotificationJobData>(
        NOTIFICATIONS_QUEUE_NAME,
        async (job: { data: NotificationJobData }) => {
          await this.processJob(job.data);
        },
        { connection, concurrency: 5 },
      );

      this.bullWorker.on("failed", (job: { id?: string } | undefined, err: Error) => {
        console.warn(`[BullMQ:Notifications] Job ${job?.id} failed:`, err);
      });
    } catch (err) {
      requireDurableQueue(NOTIFICATIONS_QUEUE_NAME);
      console.warn("[BullMQ:Notifications] Failed to initialize queue:", err);
      this.bullQueue = null;
      this.bullWorker = null;
    }
  }

  private async processJob(data: NotificationJobData): Promise<void> {
    switch (data.type) {
      case "LEAD_CREATED":
        await this.handleLeadCreated(data);
        break;
      case "MESSAGE_RECEIVED":
        await this.handleMessageReceived(data);
        break;
      case "TASK_ASSIGNED":
        await this.handleTaskAssigned(data);
        break;
      case "TASK_STATUS_CHANGED":
        await this.handleTaskStatusChanged(data);
        break;
      case "TEST_NOTIFICATION":
        await this.handleTestNotification(data);
        break;
    }
  }

  private async handleLeadCreated(job: LeadCreatedJobData): Promise<void> {
    return runWithTenantContext(job.tenantId, async () => {
      const deal = await queryOne<{
        id: string;
        title: string;
        description: string | null;
        budget: number | string | null;
        contact_first_name: string | null;
        contact_last_name: string | null;
        contact_phone: string | null;
      }>(
        `SELECT d.id, d.title, d.description, d.budget,
                c.first_name AS contact_first_name, c.last_name AS contact_last_name,
                c.phone AS contact_phone
         FROM deals d
         LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
         WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
        [job.tenantId, job.dealId],
      );

      if (!deal) return;

      const contactName = [deal.contact_first_name, deal.contact_last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      const budgetStr = deal.budget ? `${Number(deal.budget).toLocaleString("ru-RU")} ₽` : "";

      const title = `Новая заявка: ${deal.title}`;
      const descParts: string[] = [];
      if (contactName) descParts.push(contactName);
      if (budgetStr) descParts.push(budgetStr);
      if (deal.description?.trim()) descParts.push(deal.description.trim().slice(0, 80));

      const description = descParts.join(" • ") || "Поступила новая заявка с сайта/канала";
      const url = `/crm/deals/${deal.id}`;

      // 1. Создаём запись в inapp_notifications (пушится в SSE на активные вкладки)
      await pushNotificationService.createInAppNotification({
        tenantId: job.tenantId,
        category: "lead",
        entityType: "deal",
        entityId: deal.id,
        title,
        description,
        data: { dealId: deal.id, url },
        url,
      });

      // 2. Отправляем фоновый Web Push всем подписанным устройствам арендатора
      const pushPayload: WebPushPayload = {
        title,
        body: description,
        icon: "/icon-192.png",
        badge: "/favicon-32.png",
        url,
        data: { type: "deal", id: deal.id, url },
      };

      await pushNotificationService.sendNotificationToTenant(job.tenantId, pushPayload);
    });
  }

  private async handleMessageReceived(job: MessageReceivedJobData): Promise<void> {
    const channelNames: Record<string, string> = {
      telegram: "Telegram",
      whatsapp: "WhatsApp",
      webchat: "Онлайн-чат",
      max: "MAX",
    };
    const ch = channelNames[job.channel || ""] || "Чат";
    const title = `Новое сообщение в ${ch}`;
    const cleanText = job.text.trim().slice(0, 100);
    const description = `${job.senderName}: «${cleanText}»`;
    const url = `/crm/deals/${job.dealId}`;

    // In-App Notification (SSE)
    await pushNotificationService.createInAppNotification({
      tenantId: job.tenantId,
      category: "message",
      entityType: "deal",
      entityId: job.dealId,
      title,
      description,
      data: { dealId: job.dealId, channel: job.channel, url },
      url,
    });

    // Web Push
    const pushPayload: WebPushPayload = {
      title,
      body: description,
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      url,
      data: { type: "chat", id: job.dealId, url },
    };

    await pushNotificationService.sendNotificationToTenant(job.tenantId, pushPayload);
  }

  private async handleTaskAssigned(job: TaskAssignedJobData): Promise<void> {
    return runWithTenantContext(job.tenantId, async () => {
      const task = await queryOne<{
        id: string;
        title: string;
        priority: string;
        due_date: Date | null;
        assignee_id: string;
      }>(
        `SELECT id, title, priority, due_date, assignee_id
         FROM crm_tasks
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [job.tenantId, job.taskId],
      );

      if (!task) return;

      const priorityMap: Record<string, string> = {
        high: "Высокий",
        medium: "Средний",
        low: "Низкий",
      };
      const priorityLabel = priorityMap[task.priority] || task.priority;
      const title = "Вам назначена задача";
      const description = `${task.title} • Приоритет: ${priorityLabel}`;
      const url = `/crm/tasks?record=${task.id}`;

      // In-App Notification для конкретного исполнителя
      await pushNotificationService.createInAppNotification({
        tenantId: job.tenantId,
        userId: job.assigneeId,
        category: "task",
        entityType: "task",
        entityId: task.id,
        title,
        description,
        data: { taskId: task.id, url },
        url,
      });

      // Web Push конкретному пользователю
      const pushPayload: WebPushPayload = {
        title,
        body: description,
        icon: "/icon-192.png",
        badge: "/favicon-32.png",
        url,
        data: { type: "task", id: task.id, url },
      };

      await pushNotificationService.sendNotificationToUser(
        job.tenantId,
        job.assigneeId,
        pushPayload,
      );
    });
  }

  private async handleTaskStatusChanged(job: TaskStatusChangedJobData): Promise<void> {
    return runWithTenantContext(job.tenantId, async () => {
      const task = await queryOne<{
        id: string;
        title: string;
        assignee_id: string | null;
      }>(
        `SELECT id, title, assignee_id
         FROM crm_tasks
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [job.tenantId, job.taskId],
      );

      if (!task) return;

      const statusMap: Record<string, string> = {
        todo: "К выполнению",
        in_progress: "В работе",
        done: "Выполнена",
        canceled: "Отменена",
      };
      const statusLabel = statusMap[job.newStatus] || job.newStatus;
      const title = "Статус задачи изменён";
      const description = `${task.title} → ${statusLabel}`;
      const url = `/crm/tasks?record=${task.id}`;

      await pushNotificationService.createInAppNotification({
        tenantId: job.tenantId,
        userId: task.assignee_id,
        category: "task",
        entityType: "task",
        entityId: task.id,
        title,
        description,
        data: { taskId: task.id, newStatus: job.newStatus, url },
        url,
      });

      if (task.assignee_id) {
        await pushNotificationService.sendNotificationToUser(job.tenantId, task.assignee_id, {
          title,
          body: description,
          icon: "/icon-192.png",
          badge: "/favicon-32.png",
          url,
          data: { type: "task", id: task.id, url },
        });
      }
    });
  }

  private async handleTestNotification(job: TestNotificationJobData): Promise<void> {
    const title = job.title || "Тестовое уведомление GETVOXLY";
    const description = job.body || "Web Push и сервис уведомлений успешно настроены!";
    const url = job.url || "/dashboard";

    await pushNotificationService.createInAppNotification({
      tenantId: job.tenantId,
      userId: job.userId,
      category: "system",
      entityType: "system",
      entityId: "test",
      title,
      description,
      data: { url },
      url,
    });

    await pushNotificationService.sendNotificationToUser(job.tenantId, job.userId, {
      title,
      body: description,
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      url,
      data: { type: "test", url },
    });
  }

  // --- Dispatcher methods called from business logic ---

  async dispatchLeadCreated(params: { tenantId: string; dealId: string }): Promise<void> {
    if (!this.bullQueue) return;
    await this.bullQueue.add("leadCreated", {
      type: "LEAD_CREATED",
      tenantId: params.tenantId,
      dealId: params.dealId,
    });
  }

  async dispatchMessageReceived(params: {
    tenantId: string;
    dealId: string;
    senderName: string;
    text: string;
    channel?: string;
  }): Promise<void> {
    if (!this.bullQueue) return;
    await this.bullQueue.add("messageReceived", {
      type: "MESSAGE_RECEIVED",
      ...params,
    });
  }

  async dispatchTaskAssigned(params: {
    tenantId: string;
    taskId: string;
    assigneeId: string;
  }): Promise<void> {
    if (!this.bullQueue) return;
    await this.bullQueue.add("taskAssigned", {
      type: "TASK_ASSIGNED",
      ...params,
    });
  }

  async dispatchTaskStatusChanged(params: {
    tenantId: string;
    taskId: string;
    oldStatus?: string;
    newStatus: string;
  }): Promise<void> {
    if (!this.bullQueue) return;
    await this.bullQueue.add("taskStatusChanged", {
      type: "TASK_STATUS_CHANGED",
      ...params,
    });
  }

  async dispatchTestNotification(params: {
    tenantId: string;
    userId: string;
    title?: string;
    body?: string;
    url?: string;
  }): Promise<void> {
    if (!this.bullQueue) return;
    await this.bullQueue.add("testNotification", {
      type: "TEST_NOTIFICATION",
      ...params,
    });
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

export const notificationQueue = NotificationQueueService.getInstance();
