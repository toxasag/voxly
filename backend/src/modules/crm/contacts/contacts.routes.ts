import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ContactsService } from "./contacts.service.js";
import { ContactDedupeService } from "./dedupe.service.js";
import {
  contactChannelSchema,
  createContactSchema,
  toContactDTO,
  updateContactSchema,
} from "./contacts.types.js";
import { NotFoundError } from "../../../plugins/errorHandler.js";
import { DealMessagingService } from "../deals/deal-messaging.service.js";
import { createDealMessageSchema } from "../deals/deals.types.js";
import { CrmEnrichmentService } from "../enrichment.service.js";
import { ContactActivityService } from "./contact-activity.service.js";
import { activityChannelSchema, activityKindSchema } from "./contact-activity.types.js";
import { notificationEventBus } from "../../notifications/push-notification.service.js";

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  company_id: z.string().uuid().optional(),
  channel: contactChannelSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const callerIdQuerySchema = z.object({
  phone: z.string().min(3, "Номер телефона слишком короткий").max(40),
});

const callerIdLogSchema = z.object({
  phone: z.string().min(3).max(40),
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  status: z.enum(["answered", "missed", "rejected"]).default("answered"),
  duration_seconds: z.number().int().nonnegative().default(0),
  contact_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  recording_url: z.string().url().optional(),
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

  // Высокоскоростной Caller ID поиск для телефонии и мобильных Android Companion сервисов
  app.get("/caller-id-lookup", { onRequest: canRead }, async (request, reply) => {
    const { phone } = callerIdQuerySchema.parse(request.query);
    const result = await service.lookupByPhone(request.tenant_id, phone);
    return reply.send({ data: result });
  });

  // Фиксация звонка от Android Companion App и мгновенное уведомление в браузер CRM
  app.post("/caller-id-log", { onRequest: canWrite }, async (request, reply) => {
    const body = callerIdLogSchema.parse(request.body);
    const activityService = new ContactActivityService();

    let targetContactId = body.contact_id;
    let targetDealId = body.deal_id;
    let contactName = body.phone;

    // Если contact_id не передан, производим быстрый lookup по номеру
    if (!targetContactId) {
      const lookup = await service.lookupByPhone(request.tenant_id, body.phone);
      if (lookup.found && lookup.contact) {
        targetContactId = lookup.contact.id;
        contactName = lookup.contact.fullName;
        if (!targetDealId && lookup.contact.activeDeal) {
          targetDealId = lookup.contact.activeDeal.id;
        }
      }
    }

    if (targetContactId) {
      const statusRu = body.status === "answered" ? "Отвечен" : body.status === "missed" ? "Пропущен" : "Отклонен";
      const dirRu = body.direction === "inbound" ? "Входящий" : "Исходящий";
      const durationStr = body.duration_seconds > 0 ? ` (${Math.round(body.duration_seconds)} сек.)` : "";

      await activityService.recordActivity({
        tenantId: request.tenant_id,
        contactId: targetContactId,
        dealId: targetDealId ?? null,
        activityChannel: "call",
        activityKind: "task",
        direction: body.direction,
        title: `${dirRu} звонок: ${contactName} — ${statusRu}${durationStr}`,
        authorId: request.authUser.id,
        authorName: request.authUser.name,
        clientHandle: body.phone,
        payload: {
          phone: body.phone,
          status: body.status,
          duration_seconds: body.duration_seconds,
          recording_url: body.recording_url ?? null,
        },
      });

      // Эмит события в Real-time шину для мгновенного всплытия карточки в браузере менеджера
      notificationEventBus.emitNotification(request.tenant_id, null, {
        id: crypto.randomUUID(),
        category: "message",
        entity_type: targetDealId ? "deal" : "contact",
        entity_id: targetDealId || targetContactId,
        title: `📞 ${dirRu} звонок: ${contactName}`,
        description: `Статус: ${statusRu}${durationStr}. Номер: ${body.phone}`,
        created_at: new Date().toISOString(),
        read: false,
        data: {
          url: targetDealId ? `/crm/deals/${targetDealId}` : `/crm/contacts/${targetContactId}`,
          phone: body.phone,
          direction: body.direction,
          status: body.status,
        },
      });
    }

    return reply.status(201).send({
      data: {
        success: true,
        contact_id: targetContactId ?? null,
        deal_id: targetDealId ?? null,
      },
    });
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

  app.get("/lookup", { onRequest: canRead }, async (request, reply) => {
    const { phone } = duplicatesQuerySchema.parse(request.query);
    const duplicates = await dedupeService.findDuplicatesByPhone(
      request.tenant_id,
      phone,
    );
    const contact = duplicates.length > 0 && duplicates[0] ? toContactDTO(duplicates[0]) : null;
    return reply.send({ data: contact });
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

  const personalSchema = z.object({
    is_personal: z.boolean(),
  });

  app.patch("/:id/suppress-deals", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { suppress } = suppressDealsSchema.parse(request.body);
    await dedupeService.setSuppressDealCreation(request.tenant_id, id, suppress);
    return reply.send({ data: { id, suppress_deal_creation: suppress } });
  });

  app.patch("/:id/personal", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { is_personal } = personalSchema.parse(request.body);
    const updated = await service.setPersonal(request.tenant_id, id, is_personal);
    if (!updated) throw new NotFoundError("Contact not found");
    return reply.send({ data: updated });
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

  app.get("/:id/deals-history", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(100).default(50),
        offset: z.coerce.number().int().nonnegative().default(0),
      })
      .parse(request.query);
    const result = await service.getDealsHistory(request.tenant_id, id, query);
    return reply.send({ data: result });
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

  const timelineQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(100).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
    channel: activityChannelSchema.optional(),
    kind: activityKindSchema.optional(),
    deal_id: z.string().uuid().optional(),
  });

  app.get("/:id/timeline", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { limit, offset, channel, kind, deal_id } = timelineQuerySchema.parse(request.query);

    const activityService = new ContactActivityService();
    const result = await activityService.listContactActivities(request.tenant_id, id, {
      limit,
      offset,
      channel,
      kind,
      dealId: deal_id,
    });

    return reply.send({
      data: result.items,
      meta: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  });

  const recordActivityBodySchema = z.object({
    deal_id: z.string().uuid().optional().nullable(),
    activity_channel: activityChannelSchema,
    activity_kind: activityKindSchema,
    direction: z.enum(["inbound", "outbound"]).optional().nullable(),
    title: z.string().min(1).max(500),
    client_handle: z.string().max(255).optional().nullable(),
    external_account_id: z.string().max(255).optional().nullable(),
    occurred_at: z.string().datetime().optional(),
    payload: z.record(z.unknown()).default({}),
  });

  app.post("/:id/activities", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = recordActivityBodySchema.parse(request.body);

    const activityService = new ContactActivityService();
    const activity = await activityService.recordActivity({
      tenantId: request.tenant_id,
      contactId: id,
      dealId: body.deal_id,
      activityChannel: body.activity_channel,
      activityKind: body.activity_kind,
      direction: body.direction,
      title: body.title,
      authorId: request.authUser.id,
      authorName: request.authUser.name || undefined,
      clientHandle: body.client_handle,
      externalAccountId: body.external_account_id,
      occurredAt: body.occurred_at,
      payload: body.payload,
    });

    return reply.status(201).send({ data: activity });
  });
}
