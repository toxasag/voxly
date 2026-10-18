import { queueManager, type QueueJob } from "./infrastructure/queue.js";
import { chargeAiUsage, type ChargeAiUsageParams } from "./modules/ai/ai-usage-queue.js";

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
}

// Graceful shutdown
export async function shutdownWorker(): Promise<void> {
  await queueManager.shutdown();
}
