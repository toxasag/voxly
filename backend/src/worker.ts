import { queueManager, type QueueJob } from "./infrastructure/queue.js";
import { chargeAiUsage, type ChargeAiUsageParams } from "./modules/ai/ai-usage-queue.js";
import { TaskRemindersService } from "./modules/crm/tasks/task-reminders.service.js";
import { notifyTaskAssignment, type TaskAssignmentNotificationJob } from "./modules/crm/tasks/task-notification.service.js";
import { processInvoiceReminder, type InvoiceReminderJob } from "./modules/finance/invoice-reminders.service.js";
import { leadNotificationQueue } from "./modules/crm/leads/lead-notification.queue.js";
import { notificationQueue } from "./modules/notifications/notification.queue.js";

// ---------------------------------------------------------------------------
// Background Worker (M7.2): обработчики задач очередей.
// ---------------------------------------------------------------------------

export function initBackgroundWorker(): void {
  // 1. Очередь ai-usage
  queueManager.registerHandler<ChargeAiUsageParams>("ai-usage", async (job: QueueJob<ChargeAiUsageParams>) => {
    await chargeAiUsage(job.data);
  });

  // 2. Очередь timeline-sync
  queueManager.registerHandler<{ dealId: string; action: string }>("timeline-sync", async (_job) => {
    // Асинхронный синк таймлайна
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
  await queueManager.shutdown();
  await leadNotificationQueue.shutdown();
  await notificationQueue.shutdown();
}
