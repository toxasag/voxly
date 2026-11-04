import type {
  ChangeStatusPayload,
  CreateNotePayload,
  CreatePartPayload,
  CreatePhotoPayload,
  CreateRepairPayload,
  CreateWorkPayload,
  RepairNoteRow,
  RepairOrderDTO,
  RepairOrderDetailDTO,
  RepairOrderRow,
  RepairPartDTO,
  RepairPartRow,
  RepairPhotoRow,
  RepairPriority,
  RepairStatus,
  RepairWorkDTO,
  RepairWorkRow,
  UpdatePartPayload,
  UpdateRepairPayload,
  UpdateWorkPayload,
} from "./repairs.types.js";
import {
  allowedTransitionsFrom,
  calculateTotals,
  canTransition,
  toRepairNoteDTO,
  toRepairOrderDTO,
  toRepairPartDTO,
  toRepairPhotoDTO,
  toRepairWorkDTO,
} from "./repairs.types.js";
import {
  query,
  queryOne,
  withTenant,
  type SqlParam,
  type TransactionClient,
} from "../../db/client.js";
import { AppError, NotFoundError, ValidationError } from "../../plugins/errorHandler.js";
import { normalizePhoneToE164 } from "../crm/contacts/dedupe.service.js";
import { ensureTenantDefaults } from "../tenant/tenant-defaults.js";

const ORDER_COLUMNS = `
  id, tenant_id, ticket_number, deal_id, customer_id, customer_name, customer_phone,
  equipment_type, equipment_brand, equipment_model, equipment_serial,
  package_contents, appearance, defect_description, defect_photos,
  status, priority, master_id, master_name, estimated_cost, final_cost,
  notes, diagnostics, received_at, completed_at, delivered_at, created_at, updated_at
`;

const WORK_COLUMNS = `id, repair_order_id, description, master_id, master_name, cost, created_at`;
const PART_COLUMNS = `id, repair_order_id, name, article, quantity, retail_price, cost_price, created_at`;
const NOTE_COLUMNS = `id, repair_order_id, author_id, author_name, kind, content, from_status, to_status, created_at`;
const PHOTO_COLUMNS = `id, repair_order_id, url, caption, uploaded_by, created_at`;

/** 409 — the requested status is not reachable from the current one. */
export class InvalidStatusTransitionError extends AppError {
  constructor(from: RepairStatus, to: RepairStatus) {
    super(
      409,
      "INVALID_STATUS_TRANSITION",
      `Cannot move a repair order from "${from}" to "${to}"`,
      { status: [`Allowed from "${from}": ${allowedTransitionsFrom(from).join(", ") || "none"}`] },
    );
  }
}

function nullIfBlank(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  return value;
}

export interface ListRepairsOptions {
  status?: RepairStatus;
  priority?: RepairPriority;
  masterId?: string;
  customerId?: string;
  search?: string;
  limit: number;
  offset: number;
}

export class RepairsService {
  // -------------------------------------------------------------------------
  // Ticket numbering
  // -------------------------------------------------------------------------

  /**
   * Allocates the next ЗН-YYYY-NNNN number for the tenant. The upsert on
   * repair_counters serialises concurrent intakes, so two orders can never
   * share a number.
   */
  private async allocateTicketNumber(tx: TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();

    const row = await tx.queryOneOrThrow<{ last_number: number }>(
      `INSERT INTO repair_counters (tenant_id, counter_type, year, last_number)
       VALUES ($1, 'repair', $2, 1)
       ON CONFLICT (tenant_id, counter_type, year)
       DO UPDATE SET last_number = repair_counters.last_number + 1
       RETURNING last_number`,
      [tenantId, year],
    );

    return `ЗН-${year}-${String(row.last_number).padStart(4, "0")}`;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    tenantId: string,
    options: ListRepairsOptions,
  ): Promise<{ items: RepairOrderDTO[]; total: number }> {
    const conditions: string[] = ["tenant_id = $1", "deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    if (options.status !== undefined) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }

    if (options.priority !== undefined) {
      params.push(options.priority);
      conditions.push(`priority = $${params.length}`);
    }

    if (options.masterId !== undefined) {
      params.push(options.masterId);
      conditions.push(`master_id = $${params.length}`);
    }

    if (options.customerId !== undefined) {
      params.push(options.customerId);
      conditions.push(`customer_id = $${params.length}`);
    }

    if (options.search !== undefined && options.search.length > 0) {
      params.push(`%${options.search}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(ticket_number ILIKE ${placeholder}
          OR customer_name ILIKE ${placeholder}
          OR customer_phone ILIKE ${placeholder}
          OR equipment_brand ILIKE ${placeholder}
          OR equipment_model ILIKE ${placeholder}
          OR equipment_serial ILIKE ${placeholder})`,
      );
    }

    const where = conditions.join(" AND ");

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM repair_orders WHERE ${where}`,
      params,
    );

    params.push(options.limit, options.offset);

    const rows = await query<RepairOrderRow>(
      `SELECT ${ORDER_COLUMNS}
       FROM repair_orders
       WHERE ${where}
       ORDER BY
         CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC,
         received_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: rows.map(toRepairOrderDTO), total: Number(countRow?.total ?? 0) };
  }

  async get(tenantId: string, id: string): Promise<RepairOrderDTO | null> {
    const row = await queryOne<RepairOrderRow>(
      `SELECT ${ORDER_COLUMNS}
       FROM repair_orders
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );

    return row === null ? null : toRepairOrderDTO(row);
  }

  /** Full order with works, parts, notes, photos and the money breakdown. */
  async getDetail(tenantId: string, id: string): Promise<RepairOrderDetailDTO | null> {
    const order = await this.get(tenantId, id);
    if (order === null) return null;

    const [works, parts, notesLog, photos] = await Promise.all([
      this.listWorks(tenantId, id),
      this.listParts(tenantId, id),
      this.listNotes(tenantId, id),
      this.listPhotos(tenantId, id),
    ]);

    return {
      ...order,
      works,
      parts,
      notes_log: notesLog,
      photos,
      totals: calculateTotals(works, parts),
    };
  }

  async listWorks(tenantId: string, orderId: string): Promise<RepairWorkDTO[]> {
    const rows = await query<RepairWorkRow>(
      `SELECT ${WORK_COLUMNS}
       FROM repair_works
       WHERE tenant_id = $1 AND repair_order_id = $2
       ORDER BY created_at ASC`,
      [tenantId, orderId],
    );

    return rows.map(toRepairWorkDTO);
  }

  async listParts(tenantId: string, orderId: string): Promise<RepairPartDTO[]> {
    const rows = await query<RepairPartRow>(
      `SELECT ${PART_COLUMNS}
       FROM repair_parts
       WHERE tenant_id = $1 AND repair_order_id = $2
       ORDER BY created_at ASC`,
      [tenantId, orderId],
    );

    return rows.map(toRepairPartDTO);
  }

  async listNotes(tenantId: string, orderId: string) {
    const rows = await query<RepairNoteRow>(
      `SELECT ${NOTE_COLUMNS}
       FROM repair_notes
       WHERE tenant_id = $1 AND repair_order_id = $2
       ORDER BY created_at ASC`,
      [tenantId, orderId],
    );

    return rows.map(toRepairNoteDTO);
  }

  async listPhotos(tenantId: string, orderId: string) {
    const rows = await query<RepairPhotoRow>(
      `SELECT ${PHOTO_COLUMNS}
       FROM repair_photos
       WHERE tenant_id = $1 AND repair_order_id = $2
       ORDER BY created_at ASC`,
      [tenantId, orderId],
    );

    return rows.map(toRepairPhotoDTO);
  }

  /** Recomputes totals from the current works/parts rows. */
  async totals(tenantId: string, orderId: string) {
    const [works, parts] = await Promise.all([
      this.listWorks(tenantId, orderId),
      this.listParts(tenantId, orderId),
    ]);

    return calculateTotals(works, parts);
  }

  // -------------------------------------------------------------------------
  // Intake
  // -------------------------------------------------------------------------

  /**
   * Registers a new order: allocates the ticket number, stores the equipment
   * and package details, seeds the photo rows and writes the opening log entry.
   */
  async create(
    tenantId: string,
    author: { id: string; name: string },
    payload: CreateRepairPayload,
  ): Promise<RepairOrderDTO> {
    return withTenant(tenantId, async (tx) => {
      const ticketNumber = await this.allocateTicketNumber(tx, tenantId);
      const photos = payload.defect_photos ?? [];

      let customerId = payload.customer_id ? payload.customer_id.trim() : "";
      let dealId = payload.deal_id ? payload.deal_id.trim() : "";
      let companyId: string | null = null;

      // 1. Если передана сделка (Режим 1: Выбор существующей активной сделки)
      if (dealId) {
        const deal = await tx.queryOne<{ id: string; contact_id: string | null; company_id: string | null }>(
          `SELECT id, contact_id, company_id FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, dealId],
        );
        if (deal === null) throw new NotFoundError("Выбранная сделка не найдена");
        dealId = deal.id;
        companyId = deal.company_id;
        if (!customerId && deal.contact_id) {
          customerId = deal.contact_id;
        }
      }

      // 2. Если сделка не выбрана или требуется верификация контакта (Режим 2: Новый клиент / сделка)
      if (!customerId) {
        // Проверяем дедупликацию по номеру телефона
        const canonicalPhone = normalizePhoneToE164(payload.customer_phone);
        if (canonicalPhone) {
          const last10 = canonicalPhone.slice(-10);
          const existingContact = await tx.queryOne<{ id: string; company_id: string | null }>(
            `SELECT id, company_id FROM contacts
             WHERE tenant_id = $1 AND deleted_at IS NULL
               AND (
                 phone = $2
                 OR phone LIKE '%' || $3
                 OR whatsapp = $2
                 OR whatsapp LIKE '%' || $3
                 OR EXISTS (
                   SELECT 1 FROM jsonb_array_elements(additional_phones) AS p
                   WHERE (p->>'number') LIKE '%' || $3
                 )
               )
             ORDER BY created_at ASC LIMIT 1`,
            [tenantId, canonicalPhone, last10],
          );
          if (existingContact) {
            customerId = existingContact.id;
            if (!companyId) companyId = existingContact.company_id;
          }
        }

        // Если контакт так и не найден — создаём новый контакт
        if (!customerId) {
          const rawName = payload.customer_name.trim();
          const parts = rawName.split(/\s+/);
          const firstName = parts[0] || rawName;
          const lastName = parts.slice(1).join(" ");

          if (payload.company_name && payload.company_name.trim()) {
            const compName = payload.company_name.trim();
            const existingComp = await tx.queryOne<{ id: string }>(
              `SELECT id FROM companies WHERE tenant_id = $1 AND lower(btrim(name)) = lower($2) AND deleted_at IS NULL LIMIT 1`,
              [tenantId, compName],
            );
            if (existingComp) {
              companyId = existingComp.id;
            } else {
              const newComp = await tx.queryOneOrThrow<{ id: string }>(
                `INSERT INTO companies (tenant_id, name, notes) VALUES ($1, $2, 'Создана автоматически при приёмке в ремонт') RETURNING id`,
                [tenantId, compName],
              );
              companyId = newComp.id;
            }
          }

          const newContact = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO contacts (tenant_id, first_name, last_name, phone, company_name, company_id, channel, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'direct', 'Создан автоматически при приёмке оборудования в ремонт', $7)
             RETURNING id`,
            [tenantId, firstName, lastName, canonicalPhone || payload.customer_phone, payload.company_name ?? "", companyId, author.id],
          );
          customerId = newContact.id;
        }
      }

      // 3. Если сделки всё ещё нет — создаём её автоматически в CRM на стартовом этапе воронки
      if (!dealId) {
        let pipelineRow = await tx.queryOne<{ id: string }>(
          `SELECT id FROM pipelines WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
          [tenantId],
        );
        if (!pipelineRow) {
          await ensureTenantDefaults(tenantId);
          pipelineRow = await tx.queryOneOrThrow<{ id: string }>(
            `SELECT id FROM pipelines WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
            [tenantId],
          );
        }

        const stageRow = await tx.queryOneOrThrow<{ id: string }>(
          `SELECT id FROM stages
           WHERE pipeline_id = $1 AND is_won = false AND is_lost = false
           ORDER BY sort_order ASC LIMIT 1`,
          [pipelineRow.id],
        );

        const dealTitle = `Ремонт: ${payload.equipment_brand} ${payload.equipment_model}`;
        const dealDesc = `Приёмка оборудования в ремонт ${ticketNumber}: ${payload.equipment_type} ${payload.equipment_brand} ${payload.equipment_model}${payload.equipment_serial ? ` (S/N: ${payload.equipment_serial})` : ""}.\nНеисправность: ${payload.defect_description}`;

        const newDeal = await tx.queryOneOrThrow<{ id: string }>(
          `INSERT INTO deals (tenant_id, pipeline_id, stage_id, contact_id, company_id, title, description, budget, currency, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RUB', $9)
           RETURNING id`,
          [
            tenantId,
            pipelineRow.id,
            stageRow.id,
            customerId,
            companyId,
            dealTitle,
            dealDesc,
            payload.estimated_cost,
            author.id,
          ],
        );
        dealId = newDeal.id;
      }

      const row = await tx.queryOneOrThrow<RepairOrderRow>(
        `INSERT INTO repair_orders
           (tenant_id, ticket_number, deal_id, customer_id, customer_name, customer_phone,
            equipment_type, equipment_brand, equipment_model, equipment_serial,
            package_contents, appearance, defect_description, defect_photos,
            status, priority, master_id, master_name, estimated_cost, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 'intake', $15, $16, $17, $18, $19)
         RETURNING ${ORDER_COLUMNS}`,
        [
          tenantId,
          ticketNumber,
          dealId || null,
          customerId,
          payload.customer_name,
          payload.customer_phone,
          payload.equipment_type,
          payload.equipment_brand,
          payload.equipment_model,
          payload.equipment_serial ?? "",
          payload.package_contents ?? "",
          payload.appearance ?? "",
          payload.defect_description,
          photos,
          payload.priority,
          payload.master_id,
          payload.master_name,
          payload.estimated_cost,
          payload.notes ?? "",
        ],
      );

      for (const url of photos) {
        await tx.query(
          `INSERT INTO repair_photos (tenant_id, repair_order_id, url, caption, uploaded_by)
           VALUES ($1, $2, $3, '', $4)`,
          [tenantId, row.id, url, author.id],
        );
      }

      await tx.query(
        `INSERT INTO repair_notes
           (tenant_id, repair_order_id, author_id, author_name, kind, content, to_status)
         VALUES ($1, $2, $3, $4, 'status', $5, 'intake')`,
        [tenantId, row.id, author.id, author.name, `Order ${ticketNumber} registered at intake`],
      );

      // Keep the catalogue of serviced devices current for autocomplete.
      await tx.query(
        `INSERT INTO device_models (tenant_id, equipment_type, brand, model)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, brand, model) DO NOTHING`,
        [tenantId, payload.equipment_type, payload.equipment_brand, payload.equipment_model],
      );

      return toRepairOrderDTO(row);
    });
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdateRepairPayload,
  ): Promise<RepairOrderDTO | null> {
    const assignments: string[] = [];
    const params: SqlParam[] = [tenantId, id];

    const push = (column: string, value: SqlParam): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (payload.customer_name !== undefined) push("customer_name", payload.customer_name);
    if (payload.customer_phone !== undefined) push("customer_phone", payload.customer_phone);
    if (payload.equipment_type !== undefined) push("equipment_type", payload.equipment_type);
    if (payload.equipment_brand !== undefined) push("equipment_brand", payload.equipment_brand);
    if (payload.equipment_model !== undefined) push("equipment_model", payload.equipment_model);
    if (payload.equipment_serial !== undefined) push("equipment_serial", payload.equipment_serial);
    if (payload.package_contents !== undefined) push("package_contents", payload.package_contents);
    if (payload.appearance !== undefined) push("appearance", payload.appearance);
    if (payload.defect_description !== undefined) {
      push("defect_description", payload.defect_description);
    }
    if (payload.priority !== undefined) push("priority", payload.priority);
    if (payload.master_id !== undefined) {
      const masterId = nullIfBlank(payload.master_id);
      if (masterId !== null) push("master_id", masterId);
    }
    if (payload.master_name !== undefined && payload.master_name !== "") {
      push("master_name", payload.master_name);
    }
    if (payload.estimated_cost !== undefined) push("estimated_cost", payload.estimated_cost);
    if (payload.final_cost !== undefined) push("final_cost", payload.final_cost);
    if (payload.notes !== undefined) push("notes", payload.notes);

    if (assignments.length === 0) {
      return this.get(tenantId, id);
    }

    const row = await queryOne<RepairOrderRow>(
      `UPDATE repair_orders SET ${assignments.join(", ")}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING ${ORDER_COLUMNS}`,
      params,
    );

    return row === null ? null : toRepairOrderDTO(row);
  }

  // -------------------------------------------------------------------------
  // Status workflow
  // -------------------------------------------------------------------------

  /**
   * Advances the order through the workflow. Validates the transition, requires
   * diagnostics before approval, stamps completed_at/delivered_at, freezes
   * final_cost on issue and appends a log entry.
   */
  async changeStatus(
    tenantId: string,
    id: string,
    author: { id: string; name: string },
    payload: ChangeStatusPayload,
  ): Promise<RepairOrderDTO | null> {
    return withTenant(tenantId, async (tx) => {
      const current = await tx.queryOne<RepairOrderRow>(
        `SELECT ${ORDER_COLUMNS}
         FROM repair_orders
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [tenantId, id],
      );

      if (current === null) return null;

      const from = current.status;
      const to = payload.status;

      if (from === to) {
        return toRepairOrderDTO(current);
      }

      if (!canTransition(from, to)) {
        throw new InvalidStatusTransitionError(from, to);
      }

      // Diagnostics must exist before the quote can go to the customer.
      const hasStoredDiagnostics = current.diagnostics !== null;
      if (to === "approval" && payload.diagnostics === undefined && !hasStoredDiagnostics) {
        throw new ValidationError("Diagnostics are required before requesting approval", {
          diagnostics: ["Provide findings and recommended_action"],
        });
      }

      const assignments: string[] = ["status = $3"];
      const params: SqlParam[] = [tenantId, id, to];

      if (payload.diagnostics !== undefined) {
        const diagnostics = {
          performed_at: new Date().toISOString(),
          performed_by: author.name,
          findings: payload.diagnostics.findings,
          recommended_action: payload.diagnostics.recommended_action,
          condition_notes: payload.diagnostics.condition_notes ?? "",
        };
        params.push(JSON.stringify(diagnostics));
        assignments.push(`diagnostics = $${params.length}::jsonb`);
      }

      if (to === "ready") {
        assignments.push("completed_at = COALESCE(completed_at, now())");
      }

      if (to === "issued") {
        assignments.push("delivered_at = COALESCE(delivered_at, now())");
        // Freeze the amount actually charged from the works + parts totals.
        const totals = await this.totalsInTx(tx, tenantId, id);
        params.push(totals.grandTotal);
        assignments.push(`final_cost = $${params.length}`);
      }

      const row = await tx.queryOneOrThrow<RepairOrderRow>(
        `UPDATE repair_orders SET ${assignments.join(", ")}
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${ORDER_COLUMNS}`,
        params,
      );

      const comment = nullIfBlank(payload.comment) ?? `Status changed: ${from} → ${to}`;

      await tx.query(
        `INSERT INTO repair_notes
           (tenant_id, repair_order_id, author_id, author_name, kind, content, from_status, to_status)
         VALUES ($1, $2, $3, $4, 'status', $5, $6, $7)`,
        [tenantId, id, author.id, author.name, comment, from, to],
      );

      return toRepairOrderDTO(row);
    });
  }

  /** Totals computed inside an open transaction (used when issuing). */
  private async totalsInTx(tx: TransactionClient, tenantId: string, orderId: string) {
    const workRows = await tx.query<RepairWorkRow>(
      `SELECT ${WORK_COLUMNS} FROM repair_works WHERE tenant_id = $1 AND repair_order_id = $2`,
      [tenantId, orderId],
    );
    const partRows = await tx.query<RepairPartRow>(
      `SELECT ${PART_COLUMNS} FROM repair_parts WHERE tenant_id = $1 AND repair_order_id = $2`,
      [tenantId, orderId],
    );

    return calculateTotals(workRows.map(toRepairWorkDTO), partRows.map(toRepairPartDTO));
  }

  /** Rejects that the order exists and is still editable. */
  private async assertEditable(tenantId: string, orderId: string): Promise<void> {
    const row = await queryOne<{ status: RepairStatus }>(
      `SELECT status FROM repair_orders
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, orderId],
    );

    if (row === null) {
      throw new NotFoundError("Repair order not found");
    }

    if (row.status === "issued" || row.status === "rejected") {
      throw new AppError(
        409,
        "REPAIR_ORDER_CLOSED",
        `Repair order is ${row.status} and can no longer be modified`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Works
  // -------------------------------------------------------------------------

  async addWork(
    tenantId: string,
    orderId: string,
    payload: CreateWorkPayload,
  ): Promise<RepairWorkDTO> {
    await this.assertEditable(tenantId, orderId);

    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOneOrThrow<RepairWorkRow>(
        `INSERT INTO repair_works
           (tenant_id, repair_order_id, description, master_id, master_name, cost)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${WORK_COLUMNS}`,
        [
          tenantId,
          orderId,
          payload.description,
          payload.master_id,
          payload.master_name,
          payload.cost,
        ],
      );

      return toRepairWorkDTO(row);
    });
  }

  async updateWork(
    tenantId: string,
    orderId: string,
    workId: string,
    payload: UpdateWorkPayload,
  ): Promise<RepairWorkDTO | null> {
    const assignments: string[] = [];
    const params: SqlParam[] = [tenantId, orderId, workId];

    const push = (column: string, value: SqlParam): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (payload.description !== undefined) push("description", payload.description);
    if (payload.master_id !== undefined) push("master_id", payload.master_id);
    if (payload.master_name !== undefined) push("master_name", payload.master_name);
    if (payload.cost !== undefined) push("cost", payload.cost);

    if (assignments.length === 0) {
      const existing = await queryOne<RepairWorkRow>(
        `SELECT ${WORK_COLUMNS} FROM repair_works
         WHERE tenant_id = $1 AND repair_order_id = $2 AND id = $3`,
        [tenantId, orderId, workId],
      );
      return existing === null ? null : toRepairWorkDTO(existing);
    }

    const row = await queryOne<RepairWorkRow>(
      `UPDATE repair_works SET ${assignments.join(", ")}
       WHERE tenant_id = $1 AND repair_order_id = $2 AND id = $3
       RETURNING ${WORK_COLUMNS}`,
      params,
    );

    return row === null ? null : toRepairWorkDTO(row);
  }

  async deleteWork(tenantId: string, orderId: string, workId: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `DELETE FROM repair_works
       WHERE tenant_id = $1 AND repair_order_id = $2 AND id = $3
       RETURNING id`,
      [tenantId, orderId, workId],
    );

    return row !== null;
  }

  // -------------------------------------------------------------------------
  // Parts
  // -------------------------------------------------------------------------

  async addPart(
    tenantId: string,
    orderId: string,
    payload: CreatePartPayload,
  ): Promise<RepairPartDTO> {
    await this.assertEditable(tenantId, orderId);

    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOneOrThrow<RepairPartRow>(
        `INSERT INTO repair_parts
           (tenant_id, repair_order_id, name, article, quantity, retail_price, cost_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${PART_COLUMNS}`,
        [
          tenantId,
          orderId,
          payload.name,
          payload.article ?? "",
          payload.quantity,
          payload.retail_price,
          payload.cost_price,
        ],
      );

      return toRepairPartDTO(row);
    });
  }

  async updatePart(
    tenantId: string,
    orderId: string,
    partId: string,
    payload: UpdatePartPayload,
  ): Promise<RepairPartDTO | null> {
    const assignments: string[] = [];
    const params: SqlParam[] = [tenantId, orderId, partId];

    const push = (column: string, value: SqlParam): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (payload.name !== undefined) push("name", payload.name);
    if (payload.article !== undefined) push("article", payload.article);
    if (payload.quantity !== undefined) push("quantity", payload.quantity);
    if (payload.retail_price !== undefined) push("retail_price", payload.retail_price);
    if (payload.cost_price !== undefined) push("cost_price", payload.cost_price);

    if (assignments.length === 0) {
      const existing = await queryOne<RepairPartRow>(
        `SELECT ${PART_COLUMNS} FROM repair_parts
         WHERE tenant_id = $1 AND repair_order_id = $2 AND id = $3`,
        [tenantId, orderId, partId],
      );
      return existing === null ? null : toRepairPartDTO(existing);
    }

    const row = await queryOne<RepairPartRow>(
      `UPDATE repair_parts SET ${assignments.join(", ")}
       WHERE tenant_id = $1 AND repair_order_id = $2 AND id = $3
       RETURNING ${PART_COLUMNS}`,
      params,
    );

    return row === null ? null : toRepairPartDTO(row);
  }

  async deletePart(tenantId: string, orderId: string, partId: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `DELETE FROM repair_parts
       WHERE tenant_id = $1 AND repair_order_id = $2 AND id = $3
       RETURNING id`,
      [tenantId, orderId, partId],
    );

    return row !== null;
  }

  // -------------------------------------------------------------------------
  // Notes & photos
  // -------------------------------------------------------------------------

  async addNote(
    tenantId: string,
    orderId: string,
    author: { id: string; name: string },
    payload: CreateNotePayload,
  ) {
    return withTenant(tenantId, async (tx) => {
      const order = await tx.queryOne<{ id: string }>(
        `SELECT id FROM repair_orders
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, orderId],
      );

      if (order === null) {
        throw new NotFoundError("Repair order not found");
      }

      const row = await tx.queryOneOrThrow<RepairNoteRow>(
        `INSERT INTO repair_notes
           (tenant_id, repair_order_id, author_id, author_name, kind, content)
         VALUES ($1, $2, $3, $4, 'note', $5)
         RETURNING ${NOTE_COLUMNS}`,
        [tenantId, orderId, author.id, author.name, payload.content],
      );

      return toRepairNoteDTO(row);
    });
  }

  async addPhoto(
    tenantId: string,
    orderId: string,
    uploadedBy: string,
    payload: CreatePhotoPayload,
  ) {
    return withTenant(tenantId, async (tx) => {
      const order = await tx.queryOne<{ id: string }>(
        `SELECT id FROM repair_orders
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, orderId],
      );

      if (order === null) {
        throw new NotFoundError("Repair order not found");
      }

      const row = await tx.queryOneOrThrow<RepairPhotoRow>(
        `INSERT INTO repair_photos (tenant_id, repair_order_id, url, caption, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${PHOTO_COLUMNS}`,
        [tenantId, orderId, payload.url, payload.caption ?? "", uploadedBy],
      );

      // Mirror the url into the denormalised array the list view reads.
      await tx.query(
        `UPDATE repair_orders
         SET defect_photos = array_append(defect_photos, $3)
         WHERE tenant_id = $1 AND id = $2 AND NOT ($3 = ANY(defect_photos))`,
        [tenantId, orderId, payload.url],
      );

      return toRepairPhotoDTO(row);
    });
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `UPDATE repair_orders SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, id],
    );

    return row !== null;
  }
}
