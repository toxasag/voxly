import { queueManager, type QueueJob } from "./infrastructure/queue.js";
import { chargeAiUsage, type ChargeAiUsageParams } from "./modules/ai/ai-usage-queue.js";
import { TaskRemindersService } from "./modules/crm/tasks/task-reminders.service.js";

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
}

// Graceful shutdown
export async function shutdownWorker(): Promise<void> {
  await queueManager.shutdown();
}
