import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { AiService } from "./ai.service.js";
import { createAgentSchema, updateAgentSchema } from "./ai.types.js";
import { knowledgeBaseQueue, isNewUrl } from "./knowledge-base.queue.js";

const botParams = z.object({ id: z.string().uuid("id must be a UUID") });

const crawlSiteSchema = z.object({
  url: z.string().url("Укажите корректный URL (http:// или https://)"),
  maxPages: z.number().int().min(1).max(50).default(25).optional(),
});

export default async function botAliasRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);
  const service = new AiService();

  const readAgents = [app.requirePermission("ai_bots:read"), app.requireModule("ai_bots")];
  const writeAgents = [app.requirePermission("ai_bots:configure"), app.requireModule("ai_bots")];

  app.get("", { onRequest: readAgents }, async (request, reply) => {
    const agents = await service.listAgents(request.tenant_id);
    return reply.send({ data: agents });
  });

  app.get("/:id", { onRequest: readAgents }, async (request, reply) => {
    const { id } = botParams.parse(request.params);
    const agent = await service.getAgent(request.tenant_id, id);
    return reply.send({ data: agent });
  });

  app.post("", { onRequest: writeAgents }, async (request, reply) => {
    const body = createAgentSchema.parse(request.body);
    const agent = await service.createAgent(request.tenant_id, body);

    const websiteUrl = (body.website_url || body.websiteUrl)?.trim();
    if (websiteUrl) {
      try {
        await knowledgeBaseQueue.add("crawl-website", {
          tenantId: request.tenant_id,
          botId: agent.id,
          url: websiteUrl,
          source: "agent_settings_auto",
        });
      } catch (err) {
        request.log.warn({ err }, "[KnowledgeBaseQueue] Failed to enqueue crawl-website on bot create");
      }
    }

    return reply.status(201).send({ data: agent });
  });

  app.patch("/:id", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = botParams.parse(request.params);
    const body = updateAgentSchema.parse(request.body);
    const existingAgent = await service.getAgent(request.tenant_id, id);
    const agent = await service.updateAgent(request.tenant_id, id, body);

    const newWebsiteUrl = (body.website_url !== undefined ? body.website_url : body.websiteUrl)?.trim();
    const oldWebsiteUrl = (existingAgent.wizardConfig as Record<string, unknown> | null)?.website_url as string | undefined;

    if (newWebsiteUrl && isNewUrl(oldWebsiteUrl, newWebsiteUrl)) {
      try {
        await knowledgeBaseQueue.add("crawl-website", {
          tenantId: request.tenant_id,
          botId: agent.id,
          url: newWebsiteUrl,
          source: "agent_settings_auto",
        });
      } catch (err) {
        request.log.warn({ err }, "[KnowledgeBaseQueue] Failed to enqueue crawl-website on bot update");
      }
    }

    return reply.send({ data: agent });
  });

  app.delete("/:id", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = botParams.parse(request.params);
    await service.deleteAgent(request.tenant_id, id);
    return reply.status(204).send();
  });

  app.get("/:id/knowledge/crawl-status", { onRequest: readAgents }, async (request, reply) => {
    const { id } = botParams.parse(request.params);
    const agent = await service.getAgent(request.tenant_id, id);
    const cfg = (agent.wizardConfig || {}) as Record<string, unknown>;
    const status = (cfg.crawl_status as string) || "idle";

    return reply.send({
      data: {
        status,
        websiteUrl: (cfg.website_url as string) ?? null,
        pagesScanned: (cfg.crawl_pages_scanned as number) ?? 0,
        pagesIndexed: (cfg.crawl_pages_indexed as number) ?? 0,
        error: (cfg.crawl_error as string) ?? null,
        updatedAt: (cfg.crawl_updated_at as string) ?? null,
      },
    });
  });

  app.post("/:id/knowledge/crawl-site", { onRequest: writeAgents }, async (request, reply) => {
    const { id } = botParams.parse(request.params);
    const { url, maxPages } = crawlSiteSchema.parse(request.body);

    const job = await knowledgeBaseQueue.add("crawl-website", {
      tenantId: request.tenant_id,
      botId: id,
      url,
      maxPages: maxPages ?? 25,
      source: "manual_button",
    });

    return reply.status(200).send({
      data: {
        jobId: job.id,
        status: "pending",
        scannedCount: 0,
        indexedCount: 0,
        documents: [],
        message: "Задача сканирования сайта добавлена в очередь",
      },
    });
  });
}
