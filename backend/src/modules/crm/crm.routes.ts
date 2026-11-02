import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { ChatMediaService } from "./chat/media.service.js";
import { mediaEnrichmentService } from "./media/media-enrichment.service.js";
import { contactsRoutes } from "./contacts/contacts.routes.js";
import { companiesRoutes } from "./companies/companies.routes.js";
import { dealsRoutes } from "./deals/deals.routes.js";
import { tasksRoutes } from "./tasks/tasks.routes.js";
import { notesRoutes } from "./notes/notes.routes.js";
import { recordTableLayoutsRoutes } from "./record-table-layouts/record-table-layouts.routes.js";
import { pageLayoutTabsRoutes } from "./page-layout-tabs/page-layout-tabs.routes.js";
import { timelineRoutes } from "./timeline/timeline.routes.js";
import { inboxRoutes } from "./inbox/inbox.routes.js";
import { leadsRoutes } from "./leads/leads.routes.js";

/**
 * Core CRM route group, mounted at /api/v1/crm by app.ts.
 *
 * Deliberately NOT wrapped in fastify-plugin: that would break encapsulation
 * and discard the prefix, and the authenticate hook would leak to every route
 * in the application. Keeping it encapsulated scopes both the prefix and the
 * auth hooks to this group.
 */
export default async function crmRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  await app.register(contactsRoutes, { prefix: "/contacts" });
  await app.register(companiesRoutes, { prefix: "/companies" });
  await app.register(dealsRoutes, { prefix: "/deals" });
  await app.register(tasksRoutes, { prefix: "/tasks" });
  // Заметки не имеют своего права: каждый роут сверяет право по типу целевой
  // записи, поэтому группа регистрируется без requirePermission на уровне префикса.
  await app.register(notesRoutes, { prefix: "/notes" });
  await app.register(recordTableLayoutsRoutes, { prefix: "/table-layouts" });
  await app.register(pageLayoutTabsRoutes, { prefix: "/page-layouts" });
  await app.register(timelineRoutes, { prefix: "/records" });
  await app.register(inboxRoutes, { prefix: "/inbox" });
  await app.register(leadsRoutes, { prefix: "/leads" });

  // Загрузка вложений (документы, фото, видео, аудио) для чатов CRM
  const handleUpload = async (request: FastifyRequest, reply: FastifyReply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: "Файл не прикреплен" });
    }

    const buffer = await file.toBuffer();
    if (buffer.length === 0) {
      return reply.status(400).send({ error: "Пустой файл" });
    }

    const mediaService = new ChatMediaService();
    const stored = await mediaService.storeBuffer({
      buffer,
      originalName: file.filename || `file_${Date.now()}`,
      mimeType: file.mimetype || "application/octet-stream",
      tenantId: request.tenant_id,
    });

    return reply.send({
      data: {
        url: stored.url,
        filename: stored.filename,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
      },
    });
  };

  app.post("/upload", handleUpload);
  app.post("/chat/upload", handleUpload);

  // Транскрибация аудиосообщения
  app.post("/messages/:id/transcribe", async (request, reply) => {
    const { id } = request.params as { id: string };
    const transcript = await mediaEnrichmentService.transcribeAudioMessage(request.tenant_id, id);
    return reply.send({ data: transcript });
  });

  // Обогащение медиасообщения (аудио или документ)
  app.post("/messages/:id/enrich", async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = await mediaEnrichmentService.enrichMessageMedia(request.tenant_id, id);
    return reply.send({ data: updated });
  });
}
