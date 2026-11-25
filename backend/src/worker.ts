import { queueManager, type QueueJob } from "./infrastructure/queue.js";
import { chargeAiUsage, type ChargeAiUsageParams } from "./modules/ai/ai-usage-queue.js";
import { TaskRemindersService } from "./modules/crm/tasks/task-reminders.service.js";
import { notifyTaskAssignment, type TaskAssignmentNotificationJob } from "./modules/crm/tasks/task-notification.service.js";
import { processInvoiceReminder, type InvoiceReminderJob } from "./modules/finance/invoice-reminders.service.js";
import { leadNotificationQueue } from "./modules/crm/leads/lead-notification.queue.js";
import { notificationQueue } from "./modules/notifications/notification.queue.js";
import { knowledgeBaseQueue } from "./modules/ai/knowledge-base.queue.js";
import { conversionDispatcher } from "./modules/analytics/conversion-dispatcher.service.js";
import { tenantProvisioningQueue } from "./modules/tenant/tenant-provisioning.queue.js";

// ---------------------------------------------------------------------------
// Background Worker (M7.2): обработчики задач очередей.
// ---------------------------------------------------------------------------

export function initBackgroundWorker(): void {
  // 1. Очередь ai-usage
  queueManager.registerHandler<ChargeAiUsageParams>("ai-usage", async (job: QueueJob<ChargeAiUsageParams>) => {
    await chargeAiUsage(job.data);
  });

  // 2. Очередь timeline-sync (исторический синк переписки при подключении каналов)
  queueManager.registerHandler<Record<string, unknown>>("timeline-sync", async (job) => {
    if (job.name === "channel-history-sync") {
      const { runChannelHistorySync } = await import("./modules/channels/channel-history-sync.service.js");
      const data = job.data as {
        tenantId?: string;
        channelAccountId?: string;
        channel?: "max" | "telegram" | "whatsapp";
      };
      if (data.tenantId && data.channelAccountId && data.channel) {
        await runChannelHistorySync({
          tenantId: data.tenantId,
          channelAccountId: data.channelAccountId,
          channel: data.channel,
        });
      }
    }
  });

  // 3. Очередь broadcasts
  queueManager.registerHandler<{ storyId: string; channel: string }>("broadcasts", async (_job) => {
    // Отправка рассылок с контролем rate limit
  });

  // 4. Очередь task-reminders (Twenty CRM Parity)
  const remindersService = new TaskRemindersService();
  queueManager.registerHandler<{ tenantId: string }>("task-reminders", async (job: QueueJob<{ tenantId: string }>) => {
    await remindersService.checkAndDispatchReminders(job.data.tenantId);
  });

  // 5. Уведомления о назначении задач
  queueManager.registerHandler<TaskAssignmentNotificationJob>(
    "notifications",
    async (job: QueueJob<TaskAssignmentNotificationJob>) => {
      await notifyTaskAssignment(job.data);
    },
  );

  // 6. Напоминания о просроченных счетах
  queueManager.registerHandler<InvoiceReminderJob>(
    "invoice_reminders",
    async (job: QueueJob<InvoiceReminderJob>) => {
      await processInvoiceReminder(job.data);
    },
  );

  // 7. Очередь knowledge-indexing (асинхронная векторизация базы знаний агента)
  queueManager.registerHandler<{ tenantId: string; documentId: string }>(
    "knowledge-indexing",
    async (job: QueueJob<{ tenantId: string; documentId: string }>) => {
      const { KnowledgeBaseService } = await import("./modules/ai/knowledge.service.js");
      const kb = new KnowledgeBaseService();
      await kb.indexDocument(job.data.tenantId, job.data.documentId);
    },
  );
}

// Graceful shutdown
export async function shutdownWorker(): Promise<void> {
  await Promise.allSettled([
    queueManager.shutdown(),
    leadNotificationQueue.shutdown(),
    notificationQueue.shutdown(),
    knowledgeBaseQueue.shutdown(),
    conversionDispatcher.close(),
    tenantProvisioningQueue.close(),
  ]);
}
