import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne, withTenant, type SqlParam } from "../../../db/client.js";
import { authenticatePlugin } from "../../../plugins/authenticate.js";
import { NotFoundError, ValidationError } from "../../../plugins/errorHandler.js";
import { leadNotificationQueue } from "./lead-notification.queue.js";
import { ensureTenantDefaults } from "../../tenant/tenant-defaults.js";
import { notifyDealStageChanged } from "../deals/deals.service.js";
import { ConversionDispatcherService } from "../../analytics/conversion-dispatcher.service.js";

const leadParamsSchema = z.object({ id: z.string().uuid("id must be a UUID") });

const listLeadsQuerySchema = z.object({
  pipeline_id: z.string().uuid().optional(),
  stage_id: z.string().uuid().optional(),
  stage: z.string().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const createLeadSchema = z.object({
  title: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  phone: z.string().max(50).optional().or(z.literal("")),
  email: z.string().optional().or(z.literal("")),
  telegram: z.string().max(100).optional().or(z.literal("")),
  channel: z.string().max(50).optional(),
  source: z.string().max(50).optional(),
  stage: z.string().optional(),
  stage_id: z.string().uuid().optional(),
  pipeline_id: z.string().uuid().optional(),
  budget: z.number().nonnegative().optional().default(0),
  currency: z.string().length(3).default("RUB"),
  description: z.string().max(4000).optional().default(""),
  custom_fields: z.record(z.unknown()).optional(),
  contact_id: z.string().uuid().optional().or(z.literal("")),
  company_id: z.string().uuid().optional().or(z.literal("")),
});

export const updateLeadSchema = z.object({
  title: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  phone: z.string().max(50).optional().or(z.literal("")),
  email: z.string().optional().or(z.literal("")),
  telegram: z.string().max(100).optional().or(z.literal("")),
  channel: z.string().max(50).optional(),
  source: z.string().max(50).optional(),
  stage: z.string().optional(),
  stage_id: z.string().uuid().optional(),
  budget: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  description: z.string().max(4000).optional(),
  custom_fields: z.record(z.unknown()).optional(),
  contact_id: z.string().uuid().optional().or(z.literal("")),
  company_id: z.string().uuid().optional().or(z.literal("")),
});

export async function leadsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const canRead = app.requirePermission("deals:read");
  const canWrite = app.requirePermission("deals:write");

  // GET /leads — список заявок / лидов
  app.get("", { onRequest: canRead }, async (request, reply) => {
    const { pipeline_id, stage_id, search, limit, offset } = listLeadsQuerySchema.parse(request.query);

    const conditions: string[] = ["d.tenant_id = $1", "d.deleted_at IS NULL"];
    const params: SqlParam[] = [request.tenant_id];

    if (pipeline_id) {
      params.push(pipeline_id);
      conditions.push(`d.pipeline_id = $${params.length}`);
    }

    if (stage_id) {
      params.push(stage_id);
      conditions.push(`d.stage_id = $${params.length}`);
    }

    if (search && search.trim().length > 0) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(d.title ILIKE $${params.length} OR c.first_name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(" AND ");

    const totalRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM deals d
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
       WHERE ${whereClause}`,
      params,
    );
    const total = parseInt(totalRow?.total || "0", 10);

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const rows = await query(
      `SELECT d.id, d.tenant_id, d.pipeline_id, d.stage_id, d.contact_id, d.company_id,
              d.title, d.description, d.budget, d.currency, d.custom_fields, d.lead_notified_at,
              d.created_at, d.updated_at,
              s.name AS stage_name,
              c.first_name AS contact_first_name, c.last_name AS contact_last_name,
              c.phone AS contact_phone, c.email AS contact_email, c.channel AS contact_channel
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
       WHERE ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return reply.send({ data: rows, meta: { limit, offset, total } });
  });

  // GET /leads/:id — карточка заявки / лида
  app.get("/:id", { onRequest: canRead }, async (request, reply) => {
    const { id } = leadParamsSchema.parse(request.params);

    const lead = await queryOne(
      `SELECT d.id, d.tenant_id, d.pipeline_id, d.stage_id, d.contact_id, d.company_id,
              d.title, d.description, d.budget, d.currency, d.custom_fields, d.lead_notified_at,
              d.created_at, d.updated_at,
              s.name AS stage_name,
              c.first_name AS contact_first_name, c.last_name AS contact_last_name,
              c.phone AS contact_phone, c.email AS contact_email, c.channel AS contact_channel
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [request.tenant_id, id],
    );

    if (!lead) throw new NotFoundError("Lead not found");

    return reply.send({ data: lead });
  });

  // POST /leads — создание новой заявки / лида
  app.post("", { onRequest: canWrite }, async (request, reply) => {
    const body = createLeadSchema.parse(request.body);
    const tenantId = request.tenant_id;
    const userId = request.authUser.id;

    const result = await withTenant(tenantId, async (tx) => {
      // 1. Определение воронки
      let pipelineId = body.pipeline_id;
      if (!pipelineId) {
        const pipe = await tx.queryOne<{ id: string }>(
          `SELECT id FROM pipelines WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [tenantId],
        );
        if (pipe) {
          pipelineId = pipe.id;
        } else {
          await ensureTenantDefaults(tenantId);
          const seeded = await tx.queryOne<{ id: string }>(
            `SELECT id FROM pipelines WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [tenantId],
          );
          if (!seeded) throw new ValidationError("No CRM pipeline found", { pipeline: ["Missing pipeline"] });
          pipelineId = seeded.id;
        }
      }

      // 2. Определение стадии
      let stageId = body.stage_id;
      if (!stageId) {
        const stageRaw = body.stage ? body.stage.trim().toLowerCase() : "";
        if (stageRaw === "first_contact" || stageRaw === "первый контакт") {
          const fc = await tx.queryOne<{ id: string }>(
            `SELECT id FROM stages WHERE pipeline_id = $1 AND (name = 'Первый контакт' OR name ILIKE '%первый контакт%') LIMIT 1`,
            [pipelineId],
          );
          if (fc) stageId = fc.id;
        } else if (stageRaw === "new_lead" || stageRaw === "новый лид") {
          const nl = await tx.queryOne<{ id: string }>(
            `SELECT id FROM stages WHERE pipeline_id = $1 AND name = 'Новый лид' LIMIT 1`,
            [pipelineId],
          );
          if (nl) stageId = nl.id;
        }

        if (!stageId) {
          // Если контакты переданы — сразу в «Новый лид», если нет — в «Первый контакт»
          const hasContacts = Boolean(body.phone || body.email || body.telegram);
          const defaultName = hasContacts ? "Новый лид" : "Первый контакт";

          const stageFound = await tx.queryOne<{ id: string }>(
            `SELECT id FROM stages WHERE pipeline_id = $1 AND name = $2 LIMIT 1`,
            [pipelineId, defaultName],
          );

          if (stageFound) {
            stageId = stageFound.id;
          } else {
            const firstStage = await tx.queryOne<{ id: string }>(
              `SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY sort_order ASC LIMIT 1`,
              [pipelineId],
            );
            if (!firstStage) throw new ValidationError("No stages found for pipeline", { stage: ["Missing stage"] });
            stageId = firstStage.id;
          }
        }
      }

      // 3. Создание или привязка контакта
      let contactId = body.contact_id ? body.contact_id.trim() : null;
      if (!contactId && (body.phone || body.email || body.name || body.first_name || body.last_name || body.telegram)) {
        let firstName = body.first_name?.trim() || "";
        let lastName = body.last_name?.trim() || "";

        if (!firstName && body.name) {
          const parts = body.name.trim().split(/\s+/);
          firstName = parts[0] || "Контакт";
          lastName = parts.slice(1).join(" ");
        }

        if (!firstName) firstName = body.phone ? `Клиент ${body.phone}` : "Заявка";

        const contact = await tx.queryOne<{ id: string }>(
          `INSERT INTO contacts
             (tenant_id, first_name, last_name, phone, email, telegram_chat_id, channel, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            tenantId,
            firstName,
            lastName || null,
            body.phone?.trim() || null,
            body.email?.trim() || null,
            body.telegram?.trim() || null,
            body.channel || body.source || "lead",
            userId,
          ],
        );
        contactId = contact?.id ?? null;
      }

      // 4. Название сделки
      let title = body.title?.trim();
      if (!title) {
        if (body.name) title = `Заявка: ${body.name.trim()}`;
        else if (body.phone) title = `Заявка с ${body.phone.trim()}`;
        else title = "Новая заявка";
      }

      // 5. Создание записи в таблице deals
      const deal = await tx.queryOneOrThrow(
        `INSERT INTO deals
           (tenant_id, pipeline_id, stage_id, contact_id, company_id, title, description,
            budget, currency, custom_fields, created_by, owner_id, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11, 0)
         RETURNING *`,
        [
          tenantId,
          pipelineId,
          stageId,
          contactId,
          body.company_id ? body.company_id.trim() : null,
          title,
          body.description || "",
          body.budget ?? 0,
          body.currency || "RUB",
          JSON.stringify(body.custom_fields || {}),
          userId,
        ],
      );

      return deal;
    });

    // Асинхронная проверка условий нотификации через BullMQ очередь
    void leadNotificationQueue.checkAndTriggerNotification(tenantId, (result as { id: string }).id);
    void ConversionDispatcherService.getInstance().handleDealCreated({
      tenantId,
      dealId: (result as { id: string }).id,
    });

    return reply.status(201).send({ data: result });
  });

  // PATCH /leads/:id — обновление заявки / лида (в том числе обогащение контактами)
  app.patch("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = leadParamsSchema.parse(request.params);
    const body = updateLeadSchema.parse(request.body);
    const tenantId = request.tenant_id;

    const existing = await queryOne<{
      id: string;
      stage_id: string;
      pipeline_id: string;
      contact_id: string | null;
      stage_name: string;
      contact_phone: string | null;
      contact_email: string | null;
    }>(
      `SELECT d.id, d.stage_id, d.pipeline_id, d.contact_id, s.name AS stage_name,
              c.phone AS contact_phone, c.email AS contact_email
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, id],
    );

    if (!existing) throw new NotFoundError("Lead not found");

    const result = await withTenant(tenantId, async (tx) => {
      let contactId = existing.contact_id;

      // Обогащение или создание контакта при передаче контактных данных
      const hasContactPayload =
        body.phone !== undefined ||
        body.email !== undefined ||
        body.telegram !== undefined ||
        body.name !== undefined ||
        body.first_name !== undefined ||
        body.last_name !== undefined;

      if (hasContactPayload) {
        if (contactId) {
          let firstName = body.first_name;
          let lastName = body.last_name;
          if (!firstName && body.name) {
            const parts = body.name.trim().split(/\s+/);
            firstName = parts[0];
            lastName = parts.slice(1).join(" ");
          }

          await tx.query(
            `UPDATE contacts
             SET phone = COALESCE($3, phone),
                 email = COALESCE($4, email),
                 first_name = COALESCE($5, first_name),
                 last_name = COALESCE($6, last_name),
                 telegram_chat_id = COALESCE($7, telegram_chat_id),
                 updated_at = now()
             WHERE tenant_id = $1 AND id = $2`,
            [
              tenantId,
              contactId,
              body.phone !== undefined ? (body.phone.trim() || null) : null,
              body.email !== undefined ? (body.email.trim() || null) : null,
              firstName !== undefined ? (firstName.trim() || null) : null,
              lastName !== undefined ? (lastName.trim() || null) : null,
              body.telegram !== undefined ? (body.telegram.trim() || null) : null,
            ],
          );
        } else if (body.phone || body.email || body.name || body.first_name || body.telegram) {
          let firstName = body.first_name?.trim() || "";
          let lastName = body.last_name?.trim() || "";

          if (!firstName && body.name) {
            const parts = body.name.trim().split(/\s+/);
            firstName = parts[0] || "Контакт";
            lastName = parts.slice(1).join(" ");
          }

          if (!firstName) firstName = body.phone ? `Клиент ${body.phone}` : "Контакт лида";

          const newContact = await tx.queryOne<{ id: string }>(
            `INSERT INTO contacts
               (tenant_id, first_name, last_name, phone, email, telegram_chat_id, channel, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              tenantId,
              firstName,
              lastName || null,
              body.phone?.trim() || null,
              body.email?.trim() || null,
              body.telegram?.trim() || null,
              body.channel || body.source || "lead",
              request.authUser.id,
            ],
          );

          if (newContact) {
            contactId = newContact.id;
          }
        }
      }

      // Определение целевой стадии: переход из «Первый контакт» в «Новый лид»
      let targetStageId = existing.stage_id;
      if (body.stage_id) {
        targetStageId = body.stage_id;
      } else if (body.stage) {
        const sRaw = body.stage.trim().toLowerCase();
        if (sRaw === "first_contact" || sRaw === "первый контакт") {
          const fc = await tx.queryOne<{ id: string }>(
            `SELECT id FROM stages WHERE pipeline_id = $1 AND name = 'Первый контакт' LIMIT 1`,
            [existing.pipeline_id],
          );
          if (fc) targetStageId = fc.id;
        } else if (sRaw === "new_lead" || sRaw === "новый лид" || sRaw === "qualified") {
          const nl = await tx.queryOne<{ id: string }>(
            `SELECT id FROM stages WHERE pipeline_id = $1 AND (name = 'Новый лид' OR name ILIKE '%лид%') LIMIT 1`,
            [existing.pipeline_id],
          );
          if (nl) targetStageId = nl.id;
        }
      } else if (
        (body.phone || body.email || body.telegram) &&
        (existing.stage_name === "Первый контакт" || existing.stage_name.toLowerCase().includes("первый контакт"))
      ) {
        // Автоперевод из «Первый контакт» в «Новый лид» при появлении контактов
        const nextStage = await tx.queryOne<{ id: string }>(
          `SELECT id FROM stages WHERE pipeline_id = $1 AND name = 'Новый лид' LIMIT 1`,
          [existing.pipeline_id],
        );
        if (nextStage) {
          targetStageId = nextStage.id;
        }
      }

      // Обновление сделки
      const updatedDeal = await tx.queryOneOrThrow(
        `UPDATE deals
         SET title = COALESCE($3, title),
             description = COALESCE($4, description),
             budget = COALESCE($5, budget),
             currency = COALESCE($6, currency),
             stage_id = $7,
             contact_id = COALESCE($8, contact_id),
             custom_fields = CASE WHEN $9::text IS NOT NULL THEN $9::jsonb ELSE custom_fields END,
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [
          tenantId,
          id,
          body.title?.trim() ?? null,
          body.description ?? null,
          body.budget ?? null,
          body.currency ?? null,
          targetStageId,
          contactId,
          body.custom_fields ? JSON.stringify(body.custom_fields) : null,
        ],
      );

      return updatedDeal;
    });

    // Асинхронная проверка условий нотификации через BullMQ очередь
    void leadNotificationQueue.checkAndTriggerNotification(tenantId, id);

    if (result.stage_id !== existing.stage_id) {
      notifyDealStageChanged({ tenantId, dealId: id, stageId: result.stage_id });
    }

    return reply.send({ data: result });
  });

  // DELETE /leads/:id — удаление заявки / лида
  app.delete("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = leadParamsSchema.parse(request.params);

    const deleted = await queryOne(
      `UPDATE deals SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [request.tenant_id, id],
    );

    if (!deleted) throw new NotFoundError("Lead not found");

    return reply.status(204).send();
  });
}

export default leadsRoutes;
