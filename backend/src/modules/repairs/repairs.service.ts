import type {
  ChangeStatusPayload,
  ClientLookupDealDTO,
  ClientLookupResultDTO,
  CreateNotePayload,
  CreatePartPayload,
  CreatePhotoPayload,
  CreateRepairPayload,
  CreateWorkPayload,
  EquipmentHistoryItemDTO,
  EquipmentSearchSerialResultDTO,
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
  ServiceDictionariesDTO,
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
  package_contents, package_contents_items, appearance, defect_description, malfunctions, defect_photos,
  additional_contacts, status, priority, master_id, master_name, estimated_cost, final_cost,
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
      let companyId: string | null = payload.company_id ? payload.company_id.trim() : null;

      // 0. Обработка реквизитов компании (дедупликация по ИНН или названию)
      if (!companyId && payload.company_inn && payload.company_inn.trim()) {
        const inn = payload.company_inn.trim();
        const existingByInn = await tx.queryOne<{ id: string }>(
          `SELECT id FROM companies WHERE tenant_id = $1 AND inn = $2 AND deleted_at IS NULL LIMIT 1`,
          [tenantId, inn],
        );
        if (existingByInn) {
          companyId = existingByInn.id;
        }
      }

      if (!companyId && payload.company_name && payload.company_name.trim()) {
        const compName = payload.company_name.trim();
        const existingComp = await tx.queryOne<{ id: string }>(
          `SELECT id FROM companies WHERE tenant_id = $1 AND lower(btrim(name)) = lower($2) AND deleted_at IS NULL LIMIT 1`,
          [tenantId, compName],
        );
        if (existingComp) {
          companyId = existingComp.id;
        } else {
          const newComp = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO companies (tenant_id, name, inn, ogrn, bik, account_number, legal_address, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Создана автоматически при приёмке оборудования в ремонт')
             RETURNING id`,
            [
              tenantId,
              compName,
              payload.company_inn?.trim() ?? "",
              payload.company_ogrn?.trim() ?? "",
              payload.company_bik?.trim() ?? "",
              payload.company_account_number?.trim() ?? "",
              payload.company_legal_address?.trim() ?? "",
            ],
          );
          companyId = newComp.id;
        }
      }

      // 1. Если передана сделка (Режим 1: Выбор существующей активной сделки)
      if (dealId) {
        const deal = await tx.queryOne<{ id: string; contact_id: string | null; company_id: string | null }>(
          `SELECT id, contact_id, company_id FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, dealId],
        );
        if (deal === null) throw new NotFoundError("Выбранная сделка не найдена");
        dealId = deal.id;
        if (!companyId && deal.company_id) {
          companyId = deal.company_id;
        }
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
            if (!companyId && existingContact.company_id) companyId = existingContact.company_id;
          }
        }

        // Если контакт так и не найден — создаём новый контакт
        if (!customerId) {
          const rawName = payload.customer_name.trim();
          const parts = rawName.split(/\s+/);
          const firstName = parts[0] || rawName;
          const lastName = parts.slice(1).join(" ");

          const newContact = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO contacts (tenant_id, first_name, last_name, phone, email, company_name, company_id, channel, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'direct', 'Создан автоматически при приёмке оборудования в ремонт', $8)
             RETURNING id`,
            [
              tenantId,
              firstName,
              lastName,
              canonicalPhone || payload.customer_phone,
              payload.customer_email || null,
              payload.company_name ?? "",
              companyId,
              author.id,
            ],
          );
          customerId = newContact.id;
        }
      } else {
        // Если клиент передан явно, проверяем его компанию
        if (!companyId) {
          const existingContact = await tx.queryOne<{ id: string; company_id: string | null }>(
            `SELECT id, company_id FROM contacts WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [tenantId, customerId],
          );
          if (existingContact?.company_id) {
            companyId = existingContact.company_id;
          }
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

        const defectDesc =
          (payload.defect_description && payload.defect_description.trim()) ||
          (payload.malfunctions && payload.malfunctions.length > 0
            ? payload.malfunctions.join(", ")
            : "Заявленная неисправность");

        const dealTitle = `Ремонт: ${payload.equipment_brand} ${payload.equipment_model}`;
        const dealDesc = `Приёмка оборудования в ремонт ${ticketNumber}: ${payload.equipment_type} ${payload.equipment_brand} ${payload.equipment_model}${payload.equipment_serial ? ` (S/N: ${payload.equipment_serial})` : ""}.\nНеисправность: ${defectDesc}`;

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

      const finalDefectDescription =
        (payload.defect_description && payload.defect_description.trim()) ||
        (payload.malfunctions && payload.malfunctions.length > 0
          ? payload.malfunctions.join(", ")
          : "Заявленная неисправность");

      const finalPackageContents =
        (payload.package_contents && payload.package_contents.trim()) ||
        (payload.package_contents_items && payload.package_contents_items.length > 0
          ? payload.package_contents_items.join(", ")
          : "");

      const additionalContactsJson = JSON.stringify(payload.additional_contacts ?? []);
      const packageContentsItems = payload.package_contents_items ?? [];
      const malfunctionsItems = payload.malfunctions ?? [];

      const row = await tx.queryOneOrThrow<RepairOrderRow>(
        `INSERT INTO repair_orders
           (tenant_id, ticket_number, deal_id, customer_id, customer_name, customer_phone,
            equipment_type, equipment_brand, equipment_model, equipment_serial,
            package_contents, package_contents_items, appearance, defect_description, malfunctions, defect_photos,
            additional_contacts, status, priority, master_id, master_name, estimated_cost, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, 'intake', $18, $19, $20, $21, $22)
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
          finalPackageContents,
          packageContentsItems,
          payload.appearance ?? "",
          finalDefectDescription,
          malfunctionsItems,
          photos,
          additionalContactsJson,
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
      ).catch(() => {});

      // Автопополнение справочников тенанта
      if (payload.equipment_type) {
        await tx.query(
          `INSERT INTO equipment_types (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`,
          [tenantId, payload.equipment_type.trim()],
        ).catch(() => {});
      }
      if (payload.equipment_brand) {
        await tx.query(
          `INSERT INTO equipment_brands (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`,
          [tenantId, payload.equipment_brand.trim()],
        ).catch(() => {});
      }
      if (payload.equipment_model) {
        await tx.query(
          `INSERT INTO equipment_models (tenant_id, brand_name, name) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, brand_name, name) DO NOTHING`,
          [tenantId, payload.equipment_brand.trim(), payload.equipment_model.trim()],
        ).catch(() => {});
      }
      for (const m of malfunctionsItems) {
        if (m.trim()) {
          await tx.query(
            `INSERT INTO equipment_malfunctions (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`,
            [tenantId, m.trim()],
          ).catch(() => {});
        }
      }
      for (const a of packageContentsItems) {
        if (a.trim()) {
          await tx.query(
            `INSERT INTO equipment_accessories (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`,
            [tenantId, a.trim()],
          ).catch(() => {});
        }
      }

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

  /**
   * Reactive lookup for customer identification during repair intake.
   * Searches contacts by phone (normalized digits match) or query (name/company).
   * If customer found, also loads their company requisites and active CRM deals.
   */
  async clientLookup(
    tenantId: string,
    params: { phone?: string; query?: string },
  ): Promise<ClientLookupResultDTO> {
    return withTenant(tenantId, async (tx) => {
      const rawPhone = params.phone?.trim() ?? "";
      const rawQuery = params.query?.trim() ?? "";

      if (!rawPhone && !rawQuery) {
        return { found: false, client: null, company: null, activeDeals: [] };
      }

      let contact: {
        id: string;
        first_name: string;
        last_name: string | null;
        middle_name: string | null;
        phone: string | null;
        email: string | null;
        company_id: string | null;
        company_name: string | null;
      } | null = null;

      // 1. Try search by phone digits if phone is provided
      const phoneDigits = rawPhone.replace(/\D/g, "");
      if (phoneDigits.length >= 6) {
        const searchSuffix = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
        contact = await tx.queryOne<{
          id: string;
          first_name: string;
          last_name: string | null;
          middle_name: string | null;
          phone: string | null;
          email: string | null;
          company_id: string | null;
          company_name: string | null;
        }>(
          `SELECT id, first_name, last_name, middle_name, phone, email, company_id, company_name
           FROM contacts
           WHERE tenant_id = $1 AND deleted_at IS NULL
             AND (
               regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || $2
               OR additional_phones::text LIKE '%' || $2 || '%'
             )
           ORDER BY updated_at DESC
           LIMIT 1`,
          [tenantId, searchSuffix],
        );
      }

      // 2. If not found by phone and query is provided (or search by name)
      if (!contact && rawQuery.length >= 2) {
        contact = await tx.queryOne<{
          id: string;
          first_name: string;
          last_name: string | null;
          middle_name: string | null;
          phone: string | null;
          email: string | null;
          company_id: string | null;
          company_name: string | null;
        }>(
          `SELECT id, first_name, last_name, middle_name, phone, email, company_id, company_name
           FROM contacts
           WHERE tenant_id = $1 AND deleted_at IS NULL
             AND (
               first_name ILIKE '%' || $2 || '%'
               OR last_name ILIKE '%' || $2 || '%'
               OR (first_name || ' ' || COALESCE(last_name, '')) ILIKE '%' || $2 || '%'
               OR company_name ILIKE '%' || $2 || '%'
             )
           ORDER BY updated_at DESC
           LIMIT 1`,
          [tenantId, rawQuery],
        );
      }

      if (!contact) {
        return { found: false, client: null, company: null, activeDeals: [] };
      }

      // 3. Find company requisites if company_id is present
      let company: ClientLookupResultDTO["company"] = null;
      if (contact.company_id) {
        const compRow = await tx.queryOne<{
          id: string;
          name: string;
          inn: string | null;
          ogrn: string | null;
          bik: string | null;
          account_number: string | null;
          legal_address: string | null;
        }>(
          `SELECT id, name, inn, ogrn, bik, account_number, legal_address
           FROM companies
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, contact.company_id],
        );
        if (compRow) {
          company = {
            id: compRow.id,
            name: compRow.name,
            inn: compRow.inn ?? "",
            ogrn: compRow.ogrn ?? "",
            bik: compRow.bik ?? "",
            accountNumber: compRow.account_number ?? "",
            legalAddress: compRow.legal_address ?? "",
          };
        }
      }

      // 4. Find active deals associated with this contact or company
      // Active deals: is_won = false AND is_lost = false AND deleted_at IS NULL
      const dealRows = await tx.query<{
        id: string;
        title: string;
        description: string | null;
        budget: string | number | null;
        currency: string | null;
        stage_id: string;
        stage_name: string;
        stage_color: string | null;
        pipeline_id: string;
        pipeline_name: string;
        created_at: Date | string;
        owner_name: string | null;
      }>(
        `SELECT
           d.id,
           d.title,
           d.description,
           d.budget,
           d.currency,
           d.stage_id,
           s.name AS stage_name,
           s.color AS stage_color,
           d.pipeline_id,
           p.name AS pipeline_name,
           d.created_at,
           u.name AS owner_name
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         JOIN pipelines p ON p.id = d.pipeline_id
         LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.tenant_id = $1
           AND d.deleted_at IS NULL
           AND s.is_won = false
           AND s.is_lost = false
           AND (
             d.contact_id = $2
             ${contact.company_id ? "OR d.company_id = $3" : ""}
           )
         ORDER BY d.created_at DESC
         LIMIT 20`,
        contact.company_id ? [tenantId, contact.id, contact.company_id] : [tenantId, contact.id],
      );

      const activeDeals: ClientLookupDealDTO[] = dealRows.map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description ?? "",
        budget: typeof d.budget === "number" ? d.budget : (parseFloat(String(d.budget || 0)) || 0),
        currency: d.currency || "RUB",
        stageId: d.stage_id,
        stageName: d.stage_name,
        stageColor: d.stage_color || "#4a38f5",
        pipelineId: d.pipeline_id,
        pipelineName: d.pipeline_name,
        createdAt: d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at),
        ownerName: d.owner_name ?? null,
      }));

      return {
        found: true,
        client: {
          id: contact.id,
          firstName: contact.first_name,
          lastName: contact.last_name ?? "",
          middleName: contact.middle_name ?? "",
          phone: contact.phone ?? "",
          email: contact.email ?? null,
          companyId: contact.company_id ?? null,
          companyName: contact.company_name ?? null,
        },
        company,
        activeDeals,
      };
    });
  }

  /**
   * Retrieves all dictionary items for the tenant: types, brands, models, accessories, malfunctions.
   */
  async getDictionaries(tenantId: string): Promise<ServiceDictionariesDTO> {
    return withTenant(tenantId, async (tx) => {
      const types = await tx.query<{ name: string }>(
        `SELECT name FROM equipment_types WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      const brands = await tx.query<{ name: string }>(
        `SELECT name FROM equipment_brands WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      const models = await tx.query<{ name: string }>(
        `SELECT name FROM equipment_models WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      const accessories = await tx.query<{ name: string }>(
        `SELECT name FROM equipment_accessories WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      const malfunctions = await tx.query<{ name: string }>(
        `SELECT name FROM equipment_malfunctions WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );

      return {
        types: types.map((r) => r.name),
        brands: brands.map((r) => r.name),
        models: models.map((r) => r.name),
        accessories: accessories.map((r) => r.name),
        malfunctions: malfunctions.map((r) => r.name),
      };
    });
  }

  /**
   * Adds a new item to the tenant's dictionary.
   */
  async addDictionaryItem(
    tenantId: string,
    category: string,
    name: string,
    brandName?: string,
  ): Promise<{ id: string; name: string }> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new ValidationError("Name cannot be empty", {});

    return withTenant(tenantId, async (tx) => {
      let table = "";
      switch (category.toLowerCase()) {
        case "type":
        case "types":
          table = "equipment_types";
          break;
        case "brand":
        case "brands":
          table = "equipment_brands";
          break;
        case "model":
        case "models":
          table = "equipment_models";
          break;
        case "accessory":
        case "accessories":
          table = "equipment_accessories";
          break;
        case "malfunction":
        case "malfunctions":
          table = "equipment_malfunctions";
          break;
        default:
          throw new ValidationError(`Unknown dictionary category: ${category}`, {});
      }

      if (table === "equipment_models") {
        const row = await tx.queryOneOrThrow<{ id: string; name: string }>(
          `INSERT INTO equipment_models (tenant_id, brand_name, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, brand_name, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, name`,
          [tenantId, brandName?.trim() ?? "", trimmedName],
        );
        return row;
      }

      const row = await tx.queryOneOrThrow<{ id: string; name: string }>(
        `INSERT INTO ${table} (tenant_id, name)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name`,
        [tenantId, trimmedName],
      );
      return row;
    });
  }

  /**
   * Searches equipment by serial number across tenant's past repair orders.
   * If found, returns last known equipment details, customer, and full repair history.
   */
  async searchEquipmentBySerial(
    tenantId: string,
    serial: string,
  ): Promise<EquipmentSearchSerialResultDTO> {
    const trimmedSerial = serial.trim();
    if (!trimmedSerial || trimmedSerial.length < 3) {
      return { found: false, equipment: null, customer: null, historyCount: 0, history: [] };
    }

    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query<{
        id: string;
        ticket_number: string;
        customer_id: string;
        customer_name: string;
        customer_phone: string;
        equipment_type: string;
        equipment_brand: string;
        equipment_model: string;
        equipment_serial: string;
        package_contents: string;
        package_contents_items: string[] | null;
        defect_description: string;
        malfunctions: string[] | null;
        status: string;
        master_name: string;
        estimated_cost: number | string;
        final_cost: number | string | null;
        received_at: Date | string;
        completed_at: Date | string | null;
        delivered_at: Date | string | null;
      }>(
        `SELECT
           id, ticket_number, customer_id, customer_name, customer_phone,
           equipment_type, equipment_brand, equipment_model, equipment_serial,
           package_contents, package_contents_items, defect_description, malfunctions,
           status, master_name, estimated_cost, final_cost,
           received_at, completed_at, delivered_at
         FROM repair_orders
         WHERE tenant_id = $1
           AND lower(btrim(equipment_serial)) = lower($2)
           AND deleted_at IS NULL
         ORDER BY received_at DESC
         LIMIT 20`,
        [tenantId, trimmedSerial],
      );

      if (rows.length === 0) {
        return { found: false, equipment: null, customer: null, historyCount: 0, history: [] };
      }

      const latest = rows[0];
      const history: EquipmentHistoryItemDTO[] = rows.map((r) => ({
        id: r.id,
        ticketNumber: r.ticket_number,
        receivedAt: r.received_at instanceof Date ? r.received_at.toISOString() : String(r.received_at),
        completedAt: r.completed_at ? (r.completed_at instanceof Date ? r.completed_at.toISOString() : String(r.completed_at)) : null,
        deliveredAt: r.delivered_at ? (r.delivered_at instanceof Date ? r.delivered_at.toISOString() : String(r.delivered_at)) : null,
        status: r.status,
        defectDescription: r.defect_description,
        malfunctions: Array.isArray(r.malfunctions) ? r.malfunctions : [],
        estimatedCost: typeof r.estimated_cost === "number" ? r.estimated_cost : (parseFloat(String(r.estimated_cost || 0)) || 0),
        finalCost: r.final_cost !== null ? (typeof r.final_cost === "number" ? r.final_cost : parseFloat(String(r.final_cost))) : null,
        masterName: r.master_name,
      }));

      return {
        found: true,
        equipment: {
          type: latest.equipment_type,
          brand: latest.equipment_brand,
          model: latest.equipment_model,
          serial: latest.equipment_serial,
          packageContents: Array.isArray(latest.package_contents_items) && latest.package_contents_items.length > 0
            ? latest.package_contents_items
            : latest.package_contents ? latest.package_contents.split(/,\s*/).filter(Boolean) : [],
        },
        customer: {
          id: latest.customer_id,
          name: latest.customer_name,
          phone: latest.customer_phone,
        },
        historyCount: history.length,
        history,
      };
    });
  }
}
