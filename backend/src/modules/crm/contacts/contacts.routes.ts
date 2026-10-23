import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ContactsService } from "./contacts.service.js";
import { ContactDedupeService } from "./dedupe.service.js";
import {
  contactChannelSchema,
  createContactSchema,
  updateContactSchema,
} from "./contacts.types.js";
import { NotFoundError } from "../../../plugins/errorHandler.js";
import { DealMessagingService } from "../deals/deal-messaging.service.js";
import { createDealMessageSchema } from "../deals/deals.types.js";
import { CrmEnrichmentService } from "../enrichment.service.js";

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  company_id: z.string().uuid().optional(),
  channel: contactChannelSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const idParamsSchema = z.object({ id: z.string().uuid("id must be a UUID") });

const customFieldsSchema = z.object({ custom_fields: z.record(z.unknown()) });

export async function contactsRoutes(app: FastifyInstance): Promise<void> {
  const service = new ContactsService();
  const messaging = new DealMessagingService(undefined, app.log);

  const canRead = app.requirePermission("contacts:read");
  const canWrite = app.requirePermission("contacts:write");
  const canDelete = app.requirePermission("contacts:delete");

  app.get("", { onRequest: canRead }, async (request, reply) => {
    const { search, company_id, channel, limit, offset } = listQuerySchema.parse(request.query);

    const { items, total } = await service.list(request.tenant_id, {
      search,
      companyId: company_id,
      channel,
      limit,
      offset,
    });

    return reply.send({ data: items, meta: { limit, offset, total } });
  });

  app.get("/:id", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const contact = await service.get(request.tenant_id, id);

    if (contact === null) throw new NotFoundError("Contact not found");

    return reply.send({ data: contact });
  });

  app.post("", { onRequest: canWrite }, async (request, reply) => {
    const body = createContactSchema.parse(request.body);
    // Автор берётся из токена, а не из тела: иначе клиент мог бы записать
    // создателем любого пользователя тенанта.
    const contact = await service.create(request.tenant_id, body, request.authUser.id);

    return reply.status(201).send({ data: contact });
  });

  app.patch("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateContactSchema.parse(request.body);
    const contact = await service.update(request.tenant_id, id, body);

    if (contact === null) throw new NotFoundError("Contact not found");

    return reply.send({ data: contact });
  });

  // PUT replaces the JSONB bag; PATCH above merges into it.
  app.put("/:id/custom-fields", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { custom_fields } = customFieldsSchema.parse(request.body);

    const contact = await service.replaceCustomFields(request.tenant_id, id, custom_fields);

    if (contact === null) throw new NotFoundError("Contact not found");

    return reply.send({ data: contact });
  });

  app.delete("/:id", { onRequest: canDelete }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);

    const linkedDeals = await service.countLinkedDeals(request.tenant_id, id);
    const deleted = await service.softDelete(request.tenant_id, id);

    if (!deleted) throw new NotFoundError("Contact not found");

    // 200 with a cascade note when the contact still had open deals, so the
    // client can surface it; plain 204 otherwise.
    if (linkedDeals > 0) {
      return reply.status(200).send({
        data: { id, deleted: true },
        meta: { linkedDeals, warning: "Contact had linked deals; they now reference a deleted contact" },
      });
    }

    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Дедупликация и слияние контактов (CRM Dedupe & Soft Merge)
  // ---------------------------------------------------------------------------

  const dedupeService = new ContactDedupeService();

  const duplicatesQuerySchema = z.object({
    phone: z.string().min(1, "phone query parameter is required"),
    exclude_id: z.string().uuid().optional(),
  });

  app.get("/duplicates", { onRequest: canRead }, async (request, reply) => {
    const { phone, exclude_id } = duplicatesQuerySchema.parse(request.query);
    const duplicates = await dedupeService.findDuplicatesByPhone(
      request.tenant_id,
      phone,
      exclude_id,
    );
    return reply.send({ data: duplicates, meta: { total: duplicates.length } });
  });

  const mergeContactsSchema = z.object({
    primary_id: z.string().uuid("primary_id must be a UUID"),
    loser_ids: z.array(z.string().uuid("loser_id must be a UUID")).min(1, "Укажите хотя бы один дубликат"),
  });

  app.post("/merge", { onRequest: canWrite }, async (request, reply) => {
    const body = mergeContactsSchema.parse(request.body);
    const result = await dedupeService.mergeContacts(
      request.tenant_id,
      body.primary_id,
      body.loser_ids,
      request.authUser.id,
    );
    return reply.send({ data: result });
  });

  const suppressDealsSchema = z.object({
    suppress: z.boolean(),
  });

  app.patch("/:id/suppress-deals", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { suppress } = suppressDealsSchema.parse(request.body);
    await dedupeService.setSuppressDealCreation(request.tenant_id, id, suppress);
    return reply.send({ data: { id, suppress_deal_creation: suppress } });
  });

  // ---------------------------------------------------------------------------
  // Чат и хронология переписки по контакту
  // ---------------------------------------------------------------------------

  app.get("/:id/messages", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const messages = await messaging.listContactMessages(request.tenant_id, id);
    return reply.send({ data: messages, meta: { total: messages.length } });
  });

  app.post("/:id/messages", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = createDealMessageSchema.parse(request.body);
    const message = await messaging.sendContactMessage({
      tenantId: request.tenant_id,
      contactId: id,
      senderName: request.authUser.name,
      userId: request.authUser.id,
      payload: body,
    });
    return reply.status(201).send({ data: message });
  });

  app.get("/:id/send-from-options", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const options = await messaging.getContactSendFromOptions(request.tenant_id, id);
    return reply.send({ data: options, meta: { total: options.length } });
  });

  app.get("/:id/ai-status", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const status = await messaging.getContactAiStatus(request.tenant_id, id);
    return reply.send({ data: status });
  });

  const aiControlSchema = z.object({
    action: z.enum(["enable", "pause", "disable"]),
  });

  app.post("/:id/ai-control", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { action } = aiControlSchema.parse(request.body);
    const status = await messaging.setContactAiControl(request.tenant_id, id, action);
    return reply.send({ data: status });
  });

  app.post("/:id/ai-draft", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const draft = await messaging.generateContactAiDraft(request.tenant_id, id);
    return reply.send({ data: draft });
  });

  app.post("/:id/enrich", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const enrichment = new CrmEnrichmentService();
    const result = await enrichment.enrichContact(request.tenant_id, id);
    return reply.send({ data: result });
  });

  app.post("/:id/sync-chat-history", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const result = await messaging.syncContactChatHistory(request.tenant_id, id);
    return reply.send({ data: result });
  });
}
