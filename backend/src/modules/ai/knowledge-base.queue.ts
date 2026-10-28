// ---------------------------------------------------------------------------
// Очередь индексации базы знаний (Knowledge Base BullMQ / Background Queue).
//
// Обеспечивает асинхронное фоновое сканирование сайтов (Crawler) и векторизацию
// страниц в базу знаний без блокировки HTTP-запросов Fastify.
// При доступности REDIS_URL подключает BullMQ (очередь "kb" -> ключи "bull:kb:*"),
// при отсутствии или сбое Redis прозрачно переключается на in-memory worker.
// ---------------------------------------------------------------------------

import { Queue, Worker, type JobsOptions } from "bullmq";
import { getRedisConnectionOptions, requireDurableQueue } from "../../infrastructure/redis.js";
import { registerBullQueue } from "../../infrastructure/queue-metrics.js";
import { query } from "../../db/client.js";
import { crawlWebsite } from "./site-crawler.js";
import { KnowledgeBaseService } from "./knowledge.service.js";

export interface CrawlWebsiteJobData {
  tenantId: string;
  botId: string;
  url: string;
  maxPages?: number;
  source?: string;
}

export const KB_QUEUE_NAME = "kb";

export function normalizeUrl(u?: string | null): string {
  if (!u) return "";
  try {
    const parsed = new URL(u.trim());
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.hostname}${path}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function isNewUrl(oldUrl?: string | null, newUrl?: string | null): boolean {
  if (!newUrl || !newUrl.trim()) return false;
  if (!oldUrl || !oldUrl.trim()) return true;
  return normalizeUrl(oldUrl) !== normalizeUrl(newUrl);
}

export class KnowledgeBaseQueueService {
  private static instance: KnowledgeBaseQueueService | null = null;
  private bullQueue: Queue<CrawlWebsiteJobData> | null = null;
  private bullWorker: Worker<CrawlWebsiteJobData> | null = null;
  private inMemoryQueue: Array<{
    id: string;
    name: string;
    data: CrawlWebsiteJobData;
  }> = [];
  private isProcessingInMemory = false;
  private knowledgeService: KnowledgeBaseService | null = null;

  private constructor() {
    this.initBullMQ();
  }

  static getInstance(): KnowledgeBaseQueueService {
    if (!this.instance) {
      this.instance = new KnowledgeBaseQueueService();
    }
    return this.instance;
  }

  private initBullMQ(): void {
    const connOptions = getRedisConnectionOptions();
    if (!connOptions) {
      requireDurableQueue(KB_QUEUE_NAME);
      return;
    }

    try {
      this.bullQueue = new Queue<CrawlWebsiteJobData>(KB_QUEUE_NAME, {
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
      registerBullQueue(KB_QUEUE_NAME, this.bullQueue as Queue<unknown>);

      this.bullQueue.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (process.env.NODE_ENV !== "test") {
          console.warn(`[BullMQ] Queue error in '${KB_QUEUE_NAME}': ${msg}`);
        }
      });

      this.bullWorker = new Worker<CrawlWebsiteJobData>(
        KB_QUEUE_NAME,
        async (job: { data: CrawlWebsiteJobData }) => {
          await this.processCrawlWebsite(job.data);
        },
        {
          connection: connOptions,
          concurrency: 2,
        },
      );

      this.bullWorker.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (process.env.NODE_ENV !== "test") {
          console.warn(`[BullMQ] Worker error in '${KB_QUEUE_NAME}': ${msg}`);
        }
      });

      this.bullWorker.on("failed", (job: { id?: string } | undefined, err: Error) => {
        console.error(`[BullMQ] Job ${job?.id} in queue '${KB_QUEUE_NAME}' failed:`, err.message);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      requireDurableQueue(KB_QUEUE_NAME);
      console.warn(`[KnowledgeBaseQueue] Failed to connect BullMQ to Redis (${msg})`);
      this.bullQueue = null;
      this.bullWorker = null;
    }
  }

  async add(
    name: "crawl-website" | string,
    data: CrawlWebsiteJobData,
    opts?: JobsOptions,
  ): Promise<{ id: string }> {
    const jobId = `crawl-${data.botId}-${Date.now()}`;

    // Критерий приемки: логирование постановки задачи в формате [BullMQ] Job crawl-website added for bot <id>
    console.log(`[BullMQ] Job crawl-website added for bot ${data.botId}`);

    // Инициализируем статус 'pending' в wizard_config агента
    try {
      await query(
        `UPDATE ai_agents
         SET wizard_config = jsonb_set(
           jsonb_set(
             jsonb_set(COALESCE(wizard_config, '{}'::jsonb), '{crawl_status}', '"pending"'),
             '{website_url}', to_jsonb($3::text)
           ),
           '{crawl_updated_at}', to_jsonb(now()::text)
         )
         WHERE tenant_id = $1 AND id = $2`,
        [data.tenantId, data.botId, data.url],
      );
    } catch (dbErr) {
      console.warn(`[KnowledgeBaseQueue] Failed to set pending status in agent wizard_config:`, dbErr);
    }

    if (this.bullQueue) {
      try {
        const job = await this.bullQueue.add(name, data, {
          jobId,
          ...opts,
        });
        return { id: String(job.id || jobId) };
      } catch (err) {
        requireDurableQueue(KB_QUEUE_NAME);
        console.warn(`[KnowledgeBaseQueue] BullMQ enqueue failed:`, err);
      }
    }

    // In-memory fallback is intentionally limited to development and tests.
    requireDurableQueue(KB_QUEUE_NAME);
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

      if (item.name === "crawl-website") {
        await this.processCrawlWebsite(item.data);
      }
    } catch (err) {
      console.error("[KnowledgeBaseQueue] In-memory job failed:", err);
    } finally {
      this.isProcessingInMemory = false;
      if (this.inMemoryQueue.length > 0) {
        setTimeout(() => void this.processNextInMemory(), 100);
      }
    }
  }

  async processCrawlWebsite(data: CrawlWebsiteJobData): Promise<void> {
    const { tenantId, botId, url, maxPages = 25 } = data;
    console.log(`[KnowledgeBaseQueue] Starting site crawl for bot ${botId}, URL: ${url}`);

    // Обновляем статус на in_progress
    await query(
      `UPDATE ai_agents
       SET wizard_config = jsonb_set(
         jsonb_set(
           jsonb_set(COALESCE(wizard_config, '{}'::jsonb), '{crawl_status}', '"in_progress"'),
           '{website_url}', to_jsonb($3::text)
         ),
         '{crawl_updated_at}', to_jsonb(now()::text)
       )
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, botId, url],
    );

    if (!this.knowledgeService) {
      this.knowledgeService = new KnowledgeBaseService();
    }

    try {
      const crawledPages = await crawlWebsite(url, { maxPages });

      if (crawledPages.length === 0) {
        await query(
          `UPDATE ai_agents
           SET wizard_config = jsonb_set(
             jsonb_set(
               jsonb_set(COALESCE(wizard_config, '{}'::jsonb), '{crawl_status}', '"failed"'),
               '{crawl_error}', '"На сайте не найдено подходящих страниц с текстовым содержимым"'
             ),
             '{crawl_updated_at}', to_jsonb(now()::text)
           )
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, botId],
        );
        return;
      }

      let indexedCount = 0;
      for (const page of crawledPages) {
        try {
          await this.knowledgeService.addDocument({
            tenantId,
            agentId: botId,
            filename: `Сайт [${page.path}]: ${page.title.slice(0, 50)}`,
            mimeType: "text/html",
            text: `# ${page.title}\nURL: ${page.url}\n\n${page.text}`,
            category: "general",
          });
          indexedCount++;
        } catch (pageErr) {
          console.warn(`[KnowledgeBaseQueue] Failed to index page ${page.url}:`, pageErr);
        }
      }

      await query(
        `UPDATE ai_agents
         SET wizard_config = jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(COALESCE(wizard_config, '{}'::jsonb), '{crawl_status}', '"ready"'),
               '{crawl_pages_scanned}', to_jsonb($3::int)
             ),
             '{crawl_pages_indexed}', to_jsonb($4::int)
           ),
           '{crawl_updated_at}', to_jsonb(now()::text)
         )
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, botId, crawledPages.length, indexedCount],
      );

      console.log(`[KnowledgeBaseQueue] Completed crawl for bot ${botId}: ${indexedCount}/${crawledPages.length} pages added to knowledge base`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[KnowledgeBaseQueue] Error crawling site for bot ${botId}:`, errorMsg);
      await query(
        `UPDATE ai_agents
         SET wizard_config = jsonb_set(
           jsonb_set(
             jsonb_set(COALESCE(wizard_config, '{}'::jsonb), '{crawl_status}', '"failed"'),
             '{crawl_error}', to_jsonb($3::text)
           ),
           '{crawl_updated_at}', to_jsonb(now()::text)
         )
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, botId, errorMsg.slice(0, 300)],
      );
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

export const knowledgeBaseQueue = KnowledgeBaseQueueService.getInstance();
export default knowledgeBaseQueue;
