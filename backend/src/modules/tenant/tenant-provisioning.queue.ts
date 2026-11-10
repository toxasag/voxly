// ---------------------------------------------------------------------------
// Очередь провижининга тенантов и приветственных писем (BullMQ / Tenant Queue).
//
// Гарантирует надежную асинхронную доставку учетных данных (логин, пароль,
// адрес портала) при онбординге партнера и создании изолированного тенанта.
// При недоступности Redis/BullMQ прозрачно переключается на прямой вызов
// EmailService с сохранением изоляции и логирования.
// ---------------------------------------------------------------------------

import { Queue, Worker, type JobsOptions } from "bullmq";
import { getRedisConnectionOptions, requireDurableQueue } from "../../infrastructure/redis.js";
import { registerBullQueue } from "../../infrastructure/queue-metrics.js";
import { EmailService, type SendResult } from "../../services/email.service.js";

export const TENANT_PROVISIONING_QUEUE_NAME = "tenant-provisioning";

export interface TenantWelcomeCredentialsJobData {
  type: "TENANT_WELCOME_CREDENTIALS";
  to: string;
  subdomain: string;
  companyName: string;
  adminName?: string;
  loginEmail: string;
  password?: string;
}

export class TenantProvisioningQueueService {
  private static instance: TenantProvisioningQueueService | null = null;
  private bullQueue: Queue<TenantWelcomeCredentialsJobData> | null = null;
  private bullWorker: Worker<TenantWelcomeCredentialsJobData> | null = null;

  private constructor() {
    this.init();
  }

  public static getInstance(): TenantProvisioningQueueService {
    if (!TenantProvisioningQueueService.instance) {
      TenantProvisioningQueueService.instance = new TenantProvisioningQueueService();
    }
    return TenantProvisioningQueueService.instance;
  }

  private init(): void {
    const connection = getRedisConnectionOptions();
    if (!connection) {
      requireDurableQueue(TENANT_PROVISIONING_QUEUE_NAME);
      return;
    }

    try {
      this.bullQueue = new Queue<TenantWelcomeCredentialsJobData>(TENANT_PROVISIONING_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 3000,
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 300 },
        },
      });

      registerBullQueue(TENANT_PROVISIONING_QUEUE_NAME, this.bullQueue as unknown as Queue<unknown>);

      this.bullWorker = new Worker<TenantWelcomeCredentialsJobData>(
        TENANT_PROVISIONING_QUEUE_NAME,
        async (job) => {
          console.log(`[BullMQ] Worker processing job ${job.name} for ${job.data.loginEmail}`);
          const sent = await EmailService.sendTenantCredentialsEmail({
            to: job.data.to,
            subdomain: job.data.subdomain,
            companyName: job.data.companyName,
            adminName: job.data.adminName,
            loginEmail: job.data.loginEmail,
            password: job.data.password,
          });

          if (!sent.sent) {
            throw new Error(`Failed to deliver welcome credentials email: ${sent.error}`);
          }

          console.log(`[BullMQ] Welcome credentials email sent successfully to ${job.data.loginEmail} (msgId: ${sent.messageId})`);
          return sent;
        },
        {
          connection,
          concurrency: 2,
        },
      );

      this.bullWorker.on("failed", (job, err) => {
        console.error(`[BullMQ] Job ${job?.id} in queue '${TENANT_PROVISIONING_QUEUE_NAME}' failed:`, err.message);
      });

      this.bullQueue.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[BullMQ] Queue error in '${TENANT_PROVISIONING_QUEUE_NAME}': ${msg}`);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[TenantProvisioningQueue] Failed to connect BullMQ to Redis (${msg})`);
    }
  }

  /**
   * Постановка задачи отправки приветственного письма с учетными данными.
   */
  async enqueueWelcomeCredentials(
    data: Omit<TenantWelcomeCredentialsJobData, "type">,
    opts?: JobsOptions,
  ): Promise<SendResult | { queued: true }> {
    const jobData: TenantWelcomeCredentialsJobData = {
      type: "TENANT_WELCOME_CREDENTIALS",
      ...data,
    };

    if (this.bullQueue) {
      try {
        console.log(`[BullMQ] Job tenantWelcomeCredentials added for ${data.loginEmail} (${data.subdomain})`);
        await this.bullQueue.add("tenantWelcomeCredentials", jobData, opts);
        return { queued: true };
      } catch (err) {
        console.warn("[TenantProvisioningQueue] BullMQ enqueue failed, falling back to direct delivery:", err);
      }
    }

    // Fallback: прямая неблокирующая отправка через EmailService
    return EmailService.sendTenantCredentialsEmail({
      to: data.to,
      subdomain: data.subdomain,
      companyName: data.companyName,
      adminName: data.adminName,
      loginEmail: data.loginEmail,
      password: data.password,
    });
  }

  async close(): Promise<void> {
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

export const tenantProvisioningQueue = TenantProvisioningQueueService.getInstance();
