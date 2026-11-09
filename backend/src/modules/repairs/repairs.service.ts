import type {
  ChangeStatusPayload,
  ClientLookupDealDTO,
  ClientLookupResultDTO,
  CreateBatchRepairPayload,
  CreateNotePayload,
  CreatePartPayload,
  CreatePhotoPayload,
  CreateRepairPayload,
  CreateRepairServiceCatalogPayload,
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
  RepairServiceCatalogItemDTO,
  RepairServiceCatalogRow,
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
  toIso,
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

function nullIfBlank(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

export interface ListRepairsOptions {
  dealId?: string;
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
    const conditions: string[] = ["ro.tenant_id = $1", "ro.deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    if (options.dealId !== undefined) {
      params.push(options.dealId);
      conditions.push(`ro.deal_id = $${params.length}`);
    }

    if (options.status !== undefined) {
      params.push(options.status);
      conditions.push(`ro.status = $${params.length}`);
    }

    if (options.priority !== undefined) {
      params.push(options.priority);
      conditions.push(`ro.priority = $${params.length}`);
    }

    if (options.masterId !== undefined) {
      params.push(options.masterId);
      conditions.push(`ro.master_id = $${params.length}`);
    }

    if (options.customerId !== undefined) {
      params.push(options.customerId);
      conditions.push(`ro.customer_id = $${params.length}`);
    }

    if (options.search !== undefined && options.search.length > 0) {
      params.push(`%${options.search}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(ro.ticket_number ILIKE ${placeholder}
          OR ro.customer_name ILIKE ${placeholder}
          OR ro.customer_phone ILIKE ${placeholder}
          OR ro.equipment_brand ILIKE ${placeholder}
          OR ro.equipment_model ILIKE ${placeholder}
          OR ro.equipment_serial ILIKE ${placeholder})`,
      );
    }

    const where = conditions.join(" AND ");

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM repair_orders ro WHERE ${where}`,
      params,
    );

    params.push(options.limit, options.offset);

    const rows = await query<RepairOrderRow>(
      `SELECT
         ro.id, ro.tenant_id, ro.ticket_number, ro.deal_id, ro.customer_id, ro.customer_name, ro.customer_phone,
         ro.equipment_type, ro.equipment_brand, ro.equipment_model, ro.equipment_serial,
         ro.package_contents, ro.package_contents_items, ro.appearance, ro.defect_description, ro.malfunctions, ro.defect_photos,
         ro.additional_contacts, ro.status, ro.priority, ro.master_id, ro.master_name, ro.estimated_cost, ro.final_cost,
         ro.notes, ro.diagnostics, ro.received_at, ro.completed_at, ro.delivered_at, ro.created_at, ro.updated_at,
         d.title AS deal_title,
         d.budget AS deal_budget,
         st.name AS deal_stage_name,
         COALESCE((SELECT body FROM notes WHERE deal_id = d.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1), NULLIF(d.description, ''), '') AS deal_notes,
         c.id AS company_id,
         c.name AS company_name,
         c.inn AS company_inn,
         ct.email AS customer_email
       FROM repair_orders ro
       LEFT JOIN deals d ON d.id = ro.deal_id AND d.tenant_id = ro.tenant_id AND d.deleted_at IS NULL
       LEFT JOIN stages st ON st.id = d.stage_id
       LEFT JOIN contacts ct ON ct.id = ro.customer_id AND ct.tenant_id = ro.tenant_id
       LEFT JOIN companies c ON c.id = COALESCE(d.company_id, ct.company_id) AND c.tenant_id = ro.tenant_id
       WHERE ${where}
       ORDER BY
         CASE ro.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC,
         ro.received_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: rows.map(toRepairOrderDTO), total: Number(countRow?.total ?? 0) };
  }

  async syncDealBudgetFromRepairs(tenantId: string, dealId: string | null | undefined): Promise<void> {
    if (!dealId) return;
    try {
      await withTenant(tenantId, async (tx) => {
        const sumRows = await tx.query<{ total: string }>(
          `WITH order_totals AS (
             SELECT
               ro.id,
               ro.final_cost,
               ro.estimated_cost,
               COALESCE((SELECT SUM(cost) FROM repair_works WHERE repair_order_id = ro.id), 0) +
               COALESCE((SELECT SUM(retail_price * quantity) FROM repair_parts WHERE repair_order_id = ro.id), 0) AS calc_total
             FROM repair_orders ro
             WHERE ro.tenant_id = $1 AND ro.deal_id = $2 AND ro.deleted_at IS NULL
           )
           SELECT COALESCE(SUM(
             CASE
               WHEN final_cost IS NOT NULL AND final_cost > 0 THEN final_cost
               WHEN calc_total > 0 THEN calc_total
               ELSE COALESCE(estimated_cost, 0)
             END
           ), 0)::text AS total
           FROM order_totals`,
          [tenantId, dealId],
        );

        const totalBudget = parseFloat(sumRows[0]?.total ?? "0") || 0;

        await tx.query(
          `UPDATE deals
           SET budget = $1, updated_at = NOW()
           WHERE tenant_id = $2 AND id = $3`,
          [totalBudget, tenantId, dealId],
        );
      });
    } catch (err) {
      console.error("[repairs.service] Failed to sync deal budget:", err);
    }
  }

  private async getOrderDealId(tenantId: string, orderId: string): Promise<string | null> {
    const row = await queryOne<{ deal_id: string | null }>(
      `SELECT deal_id FROM repair_orders WHERE tenant_id = $1 AND id = $2`,
      [tenantId, orderId],
    );
    return row?.deal_id ?? null;
  }

  async get(tenantId: string, id: string): Promise<RepairOrderDTO | null> {
    const row = await queryOne<RepairOrderRow>(
      `SELECT
         ro.id, ro.tenant_id, ro.ticket_number, ro.deal_id, ro.customer_id, ro.customer_name, ro.customer_phone,
         ro.equipment_type, ro.equipment_brand, ro.equipment_model, ro.equipment_serial,
         ro.package_contents, ro.package_contents_items, ro.appearance, ro.defect_description, ro.malfunctions, ro.defect_photos,
         ro.additional_contacts, ro.status, ro.priority, ro.master_id, ro.master_name, ro.estimated_cost, ro.final_cost,
         ro.notes, ro.diagnostics, ro.received_at, ro.completed_at, ro.delivered_at, ro.created_at, ro.updated_at,
         d.title AS deal_title,
         d.budget AS deal_budget,
         st.name AS deal_stage_name,
         COALESCE((SELECT body FROM notes WHERE deal_id = d.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1), NULLIF(d.description, ''), '') AS deal_notes,
         c.id AS company_id,
         c.name AS company_name,
         c.inn AS company_inn,
         ct.email AS customer_email
       FROM repair_orders ro
       LEFT JOIN deals d ON d.id = ro.deal_id AND d.tenant_id = ro.tenant_id AND d.deleted_at IS NULL
       LEFT JOIN stages st ON st.id = d.stage_id
       LEFT JOIN contacts ct ON ct.id = ro.customer_id AND ct.tenant_id = ro.tenant_id
       LEFT JOIN companies c ON c.id = COALESCE(d.company_id, ct.company_id) AND c.tenant_id = ro.tenant_id
       WHERE ro.tenant_id = $1 AND ro.id = $2 AND ro.deleted_at IS NULL`,
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

      const masterId = payload.master_id && payload.master_id.trim() ? payload.master_id.trim() : author.id;
      const masterName = payload.master_name && payload.master_name.trim() ? payload.master_name.trim() : author.name;

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
          masterId,
          masterName,
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

      const dto = toRepairOrderDTO(row);
      if (dto.dealId) void this.syncDealBudgetFromRepairs(tenantId, dto.dealId);
      return dto;
    });
  }


  /**
   * Batch creates multiple repair orders in a single transaction,
   * linked to the same customer and single CRM deal.
   */
  async createBatch(
    tenantId: string,
    author: { id: string; name: string },
    payload: CreateBatchRepairPayload,
  ): Promise<RepairOrderDTO[]> {
    return withTenant(tenantId, async (tx) => {
      let customerId = payload.customer_id ? payload.customer_id.trim() : "";
      let dealId = payload.deal_id ? payload.deal_id.trim() : "";
      let companyId: string | null = payload.company_id ? payload.company_id.trim() : null;

      // 0. Обработка компании
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
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Создана автоматически при пакетной приёмке оборудования')
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

      // 1. Клиент
      if (!customerId) {
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

        if (!customerId) {
          const rawName = payload.customer_name.trim();
          const parts = rawName.split(/\s+/);
          const firstName = parts[0] || rawName;
          const lastName = parts.slice(1).join(" ");

          const newContact = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO contacts (tenant_id, first_name, last_name, phone, email, company_name, company_id, channel, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'direct', 'Создан автоматически при пакетной приёмке', $8)
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
      } else if (!companyId) {
        const existingContact = await tx.queryOne<{ id: string; company_id: string | null }>(
          `SELECT id, company_id FROM contacts WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, customerId],
        );
        if (existingContact?.company_id) {
          companyId = existingContact.company_id;
        }
      }

      // 2. Сделка
      if (dealId) {
        const deal = await tx.queryOne<{ id: string; contact_id: string | null; company_id: string | null }>(
          `SELECT id, contact_id, company_id FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, dealId],
        );
        if (!deal) throw new NotFoundError("Выбранная сделка не найдена");
      } else {
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

        const totalCost = payload.equipments.reduce((sum, e) => sum + (e.estimated_cost || 0), 0) || (payload.estimated_cost ?? 0);
        const firstEq = payload.equipments[0];
        const dealTitle = payload.equipments.length === 1 && firstEq
          ? `Ремонт: ${firstEq.equipment_brand} ${firstEq.equipment_model}`
          : `Пакетный ремонт (${payload.equipments.length} шт.): ${firstEq ? `${firstEq.equipment_brand} ${firstEq.equipment_model}` : "Оборудование"}`;

        const dealDesc = `Пакетная приёмка (${payload.equipments.length} шт.):\n` +
          payload.equipments.map((e, idx) => `${idx + 1}. ${e.equipment_type} ${e.equipment_brand} ${e.equipment_model}${e.equipment_serial ? ` (S/N: ${e.equipment_serial})` : ""}. Неисправность: ${e.defect_description || e.malfunctions?.join(", ") || "—"}`).join("\n");

        const newDeal = await tx.queryOneOrThrow<{ id: string }>(
          `INSERT INTO deals (tenant_id, pipeline_id, stage_id, contact_id, company_id, title, description, budget, currency, owner_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RUB', $9, $9)
           RETURNING id`,
          [
            tenantId,
            pipelineRow.id,
            stageRow.id,
            customerId,
            companyId,
            dealTitle,
            dealDesc,
            totalCost,
            author.id,
          ],
        );
        dealId = newDeal.id;

        if (payload.notes && payload.notes.trim()) {
          await tx.query(
            `INSERT INTO notes (tenant_id, deal_id, title, body, created_by)
             VALUES ($1, $2, 'Заметка к приёмке', $3, $4)`,
            [tenantId, dealId, payload.notes.trim(), author.id],
          );
        }
      }

      // 3. Создаем наряд-заказ на каждую единицу оборудования
      const createdOrders: RepairOrderDTO[] = [];
      const defaultMasterId = payload.master_id && payload.master_id.trim() ? payload.master_id.trim() : author.id;
      const defaultMasterName = payload.master_name && payload.master_name.trim() ? payload.master_name.trim() : author.name;

      for (const eq of payload.equipments) {
        const ticketNumber = await this.allocateTicketNumber(tx, tenantId);
        const packageContents = (eq.package_contents ?? "").trim();
        const packageContentsItems = eq.package_contents_items ?? (packageContents ? packageContents.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean) : []);
        const defectDescription = (eq.defect_description ?? "").trim();
        const malfunctions = eq.malfunctions ?? (defectDescription ? [defectDescription] : []);
        const defectPhotos = eq.defect_photos ?? payload.defect_photos ?? [];

        const additionalContactsJson = JSON.stringify(payload.additional_contacts ?? []);
        const itemMasterId = (eq.master_id && eq.master_id.trim()) || defaultMasterId;
        const itemMasterName = (eq.master_name && eq.master_name.trim()) || defaultMasterName;

        const row = await tx.queryOneOrThrow<RepairOrderRow>(
          `INSERT INTO repair_orders (
             tenant_id, ticket_number, deal_id, customer_id, customer_name, customer_phone,
             equipment_type, equipment_brand, equipment_model, equipment_serial,
             package_contents, package_contents_items, appearance, defect_description, malfunctions,
             defect_photos, status, priority, master_id, master_name, estimated_cost, notes, additional_contacts, received_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13, $14, $15,
             $16, 'intake', $17, $18, $19, $20, $21, $22, now()
           )
           RETURNING ${ORDER_COLUMNS}`,
          [
            tenantId,
            ticketNumber,
            dealId,
            customerId,
            payload.customer_name.trim(),
            payload.customer_phone.trim(),
            eq.equipment_type.trim(),
            eq.equipment_brand.trim(),
            eq.equipment_model.trim(),
            (eq.equipment_serial ?? "").trim(),
            packageContents,
            packageContentsItems,
            (eq.appearance ?? "").trim(),
            defectDescription,
            malfunctions,
            defectPhotos,
            payload.priority ?? "normal",
            itemMasterId,
            itemMasterName,
            eq.estimated_cost ?? 0,
            payload.notes ?? "",
            additionalContactsJson,
          ],
        );

        await tx.query(
          `INSERT INTO repair_notes
             (tenant_id, repair_order_id, author_id, author_name, kind, content, from_status, to_status)
           VALUES ($1, $2, $3, $4, 'status', 'Приёмка оборудования (пакетная)', null, 'intake')`,
          [tenantId, row.id, author.id, author.name],
        );

        if (eq.equipment_type.trim()) {
          await tx.query(
            `INSERT INTO equipment_types (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`,
            [tenantId, eq.equipment_type.trim()],
          ).catch(() => {});
        }
        if (eq.equipment_brand.trim()) {
          await tx.query(
            `INSERT INTO equipment_brands (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING`,
            [tenantId, eq.equipment_brand.trim()],
          ).catch(() => {});
        }
        if (eq.equipment_model.trim()) {
          await tx.query(
            `INSERT INTO equipment_models (tenant_id, brand_name, name) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, brand_name, name) DO NOTHING`,
            [tenantId, eq.equipment_brand.trim(), eq.equipment_model.trim()],
          ).catch(() => {});
        }
        for (const m of malfunctions) {
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

        createdOrders.push(toRepairOrderDTO(row));
      }

      return createdOrders;
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
    if (payload.deal_id !== undefined) {
      push("deal_id", nullIfBlank(payload.deal_id));
    }
    if (payload.customer_id !== undefined) {
      const custId = nullIfBlank(payload.customer_id);
      if (custId !== null) push("customer_id", custId);
    }
    if (payload.equipment_type !== undefined) push("equipment_type", payload.equipment_type);
    if (payload.equipment_brand !== undefined) push("equipment_brand", payload.equipment_brand);
    if (payload.equipment_model !== undefined) push("equipment_model", payload.equipment_model);
    if (payload.equipment_serial !== undefined) push("equipment_serial", payload.equipment_serial);
    if (payload.package_contents !== undefined) push("package_contents", payload.package_contents);
    if (payload.package_contents_items !== undefined) {
      params.push(payload.package_contents_items);
      assignments.push(`package_contents_items = $${params.length}`);
    }
    if (payload.appearance !== undefined) push("appearance", payload.appearance);
    if (payload.defect_description !== undefined) {
      push("defect_description", payload.defect_description);
    }
    if (payload.malfunctions !== undefined) {
      params.push(payload.malfunctions);
      assignments.push(`malfunctions = $${params.length}`);
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

    if (assignments.length > 0) {
      await query(
        `UPDATE repair_orders SET ${assignments.join(", ")}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        params,
      );
    }

    const current = await this.get(tenantId, id);
    if (!current) return null;

    // Синхронизация данных связанного контакта
    if (current.customerId && (payload.customer_name || payload.customer_phone || payload.customer_email !== undefined)) {
      const contactAssignments: string[] = [];
      const contactParams: SqlParam[] = [tenantId, current.customerId];
      if (payload.customer_name) {
        const parts = payload.customer_name.trim().split(/\s+/);
        contactParams.push(parts[0] || payload.customer_name);
        contactAssignments.push(`first_name = $${contactParams.length}`);
        contactParams.push(parts.slice(1).join(" "));
        contactAssignments.push(`last_name = $${contactParams.length}`);
      }
      if (payload.customer_phone) {
        contactParams.push(payload.customer_phone.trim());
        contactAssignments.push(`phone = $${contactParams.length}`);
      }
      if (payload.customer_email !== undefined) {
        contactParams.push(payload.customer_email.trim() || null);
        contactAssignments.push(`email = $${contactParams.length}`);
      }
      if (contactAssignments.length > 0) {
        await query(
          `UPDATE contacts SET ${contactAssignments.join(", ")} WHERE tenant_id = $1 AND id = $2`,
          contactParams,
        ).catch(() => {});
      }
    }

    // Синхронизация данных компании
    if (payload.company_name !== undefined || payload.company_inn !== undefined) {
      if (current.companyId) {
        const compAssignments: string[] = [];
        const compParams: SqlParam[] = [tenantId, current.companyId];
        if (payload.company_name !== undefined) {
          compParams.push(payload.company_name.trim());
          compAssignments.push(`name = $${compParams.length}`);
        }
        if (payload.company_inn !== undefined) {
          compParams.push(payload.company_inn.trim());
          compAssignments.push(`inn = $${compParams.length}`);
        }
        if (compAssignments.length > 0) {
          await query(
            `UPDATE companies SET ${compAssignments.join(", ")} WHERE tenant_id = $1 AND id = $2`,
            compParams,
          ).catch(() => {});
        }
      } else if (payload.company_name && payload.company_name.trim()) {
        const newComp = await queryOne<{ id: string }>(
          `INSERT INTO companies (tenant_id, name, inn) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, payload.company_name.trim(), payload.company_inn?.trim() ?? ""],
        ).catch(() => null);
        if (newComp && current.customerId) {
          await query(
            `UPDATE contacts SET company_id = $1, company_name = $2 WHERE tenant_id = $3 AND id = $4`,
            [newComp.id, payload.company_name.trim(), tenantId, current.customerId],
          ).catch(() => {});
        }
      }
    }

    // Синхронизация названия и заметки сделки CRM
    if (current.dealId && payload.deal_title && payload.deal_title.trim()) {
      await query(
        `UPDATE deals SET title = $1 WHERE tenant_id = $2 AND id = $3`,
        [payload.deal_title.trim(), tenantId, current.dealId],
      ).catch(() => {});
    }

    if (current.dealId && payload.deal_note && payload.deal_note.trim()) {
      await query(
        `INSERT INTO notes (tenant_id, deal_id, title, body)
         VALUES ($1, $2, 'Заметка к заказу', $3)`,
        [tenantId, current.dealId, payload.deal_note.trim()],
      ).catch(() => {});
    }

    const updated = await this.get(tenantId, id);
    if (updated?.dealId) void this.syncDealBudgetFromRepairs(tenantId, updated.dealId);
    return updated;
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

      const dto = toRepairOrderDTO(row);
      if (dto.dealId) void this.syncDealBudgetFromRepairs(tenantId, dto.dealId);
      return dto;
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

      const result = toRepairWorkDTO(row);
      void this.getOrderDealId(tenantId, orderId).then((dealId) => {
        if (dealId) void this.syncDealBudgetFromRepairs(tenantId, dealId);
      });
      return result;
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

    if (row !== null) {
      void this.getOrderDealId(tenantId, orderId).then((dealId) => {
        if (dealId) void this.syncDealBudgetFromRepairs(tenantId, dealId);
      });
    }

    return row === null ? null : toRepairWorkDTO(row);
  }

  async deleteWork(tenantId: string, orderId: string, workId: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `DELETE FROM repair_works
       WHERE tenant_id = $1 AND repair_order_id = $2 AND id = $3
       RETURNING id`,
      [tenantId, orderId, workId],
    );

    if (row !== null) {
      void this.getOrderDealId(tenantId, orderId).then((dealId) => {
        if (dealId) void this.syncDealBudgetFromRepairs(tenantId, dealId);
      });
    }

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

      const result = toRepairPartDTO(row);
      void this.getOrderDealId(tenantId, orderId).then((dealId) => {
        if (dealId) void this.syncDealBudgetFromRepairs(tenantId, dealId);
      });
      return result;
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

    if (row !== null) {
      void this.getOrderDealId(tenantId, orderId).then((dealId) => {
        if (dealId) void this.syncDealBudgetFromRepairs(tenantId, dealId);
      });
    }

    return row === null ? null : toRepairPartDTO(row);
  }

  async deletePart(tenantId: string, orderId: string, partId: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `DELETE FROM repair_parts
       WHERE tenant_id = $1 AND repair_order_id = $2 AND id = $3
       RETURNING id`,
      [tenantId, orderId, partId],
    );

    if (row !== null) {
      void this.getOrderDealId(tenantId, orderId).then((dealId) => {
        if (dealId) void this.syncDealBudgetFromRepairs(tenantId, dealId);
      });
    }

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
   * Пакетное удаление наряд-заказов (soft-delete).
   */
  async batchDelete(tenantId: string, ids: string[]): Promise<{ count: number; ids: string[] }> {
    if (ids.length === 0) return { count: 0, ids: [] };
    const rows = await query<{ id: string }>(
      `UPDATE repair_orders SET deleted_at = now()
       WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, ids],
    );
    return { count: rows.length, ids: rows.map((r) => r.id) };
  }

  /**
   * Пакетная смена статуса наряд-заказов.
   */
  async batchUpdateStatus(
    tenantId: string,
    ids: string[],
    status: RepairStatus,
    author: { id: string; name: string },
    comment?: string,
  ): Promise<{ updated: number; ids: string[]; errors: { id: string; error: string }[] }> {
    const updatedIds: string[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const id of ids) {
      try {
        await this.changeStatus(tenantId, id, author, {
          status,
          comment: comment || `Пакетное изменение статуса на «${status}»`,
        });
        updatedIds.push(id);
      } catch {
        // Если штатный FSM-переход требует промежуточных этапов,
        // администратор/менеджер в пакете переводит принудительно с сохранением аудита
        try {
          await withTenant(tenantId, async (tx) => {
            const current = await tx.queryOne<RepairOrderRow>(
              `SELECT ${ORDER_COLUMNS} FROM repair_orders WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
              [tenantId, id],
            );
            if (!current) return;

            const from = current.status;
            if (from === status) {
              updatedIds.push(id);
              return;
            }

            const row = await tx.queryOne<RepairOrderRow>(
              `UPDATE repair_orders
               SET status = $3,
                   completed_at = CASE WHEN $3 = 'ready' THEN COALESCE(completed_at, now()) ELSE completed_at END,
                   delivered_at = CASE WHEN $3 = 'issued' THEN COALESCE(delivered_at, now()) ELSE delivered_at END
               WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
               RETURNING ${ORDER_COLUMNS}`,
              [tenantId, id, status],
            );

            if (row) {
              await tx.query(
                `INSERT INTO repair_notes
                   (tenant_id, repair_order_id, author_id, author_name, kind, content, from_status, to_status)
                 VALUES ($1, $2, $3, $4, 'status', $5, $6, $7)`,
                [
                  tenantId,
                  id,
                  author.id,
                  author.name,
                  comment || `Пакетное обновление статуса: ${from} → ${status}`,
                  from,
                  status,
                ],
              );
              updatedIds.push(id);
            }
          });
        } catch (fallbackErr: unknown) {
          const msg = fallbackErr instanceof Error ? fallbackErr.message : "Не удалось обновить статус";
          errors.push({ id, error: msg });
        }
      }
    }

    return { updated: updatedIds.length, ids: updatedIds, errors };
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
   * Translates category slug to actual table name
   */
  private getDictionaryTable(category: string): string {
    switch (category.toLowerCase()) {
      case "type":
      case "types":
        return "equipment_types";
      case "brand":
      case "brands":
        return "equipment_brands";
      case "model":
      case "models":
        return "equipment_models";
      case "accessory":
      case "accessories":
        return "equipment_accessories";
      case "malfunction":
      case "malfunctions":
        return "equipment_malfunctions";
      default:
        throw new ValidationError(`Unknown dictionary category: ${category}`, {});
    }
  }

  /**
   * Retrieves all dictionary items for the tenant: types, brands, models, accessories, malfunctions.
   */
  async getDictionaries(tenantId: string): Promise<ServiceDictionariesDTO> {
    return withTenant(tenantId, async (tx) => {
      const types = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM equipment_types WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      const brands = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      const models = await tx.query<{ id: string; name: string; brand_id: string; brand_name: string }>(
        `SELECT em.id, em.name, em.brand_id, COALESCE(eb.name, em.brand_name) AS brand_name
         FROM equipment_models em
         LEFT JOIN equipment_brands eb ON em.brand_id = eb.id
         WHERE em.tenant_id = $1
         ORDER BY em.name ASC`,
        [tenantId],
      );
      const accessories = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM equipment_accessories WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      const malfunctions = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM equipment_malfunctions WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );

      return {
        types: types.map((r) => ({ id: r.id, name: r.name })),
        brands: brands.map((r) => ({ id: r.id, name: r.name })),
        models: models.map((r) => ({ id: r.id, name: r.name, brandId: r.brand_id, brandName: r.brand_name })),
        accessories: accessories.map((r) => ({ id: r.id, name: r.name })),
        malfunctions: malfunctions.map((r) => ({ id: r.id, name: r.name })),
      };
    });
  }

  /**
   * Retrieves all equipment brands for the tenant.
   */
  async listBrands(tenantId: string): Promise<Array<{ id: string; name: string }>> {
    return withTenant(tenantId, async (tx) => {
      return tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
    });
  }

  /**
   * Creates a new brand for the tenant.
   */
  async createBrand(tenantId: string, name: string): Promise<{ id: string; name: string }> {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("Brand name cannot be empty", {});

    return withTenant(tenantId, async (tx) => {
      return tx.queryOneOrThrow<{ id: string; name: string }>(
        `INSERT INTO equipment_brands (tenant_id, name)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name`,
        [tenantId, trimmed],
      );
    });
  }

  /**
   * Retrieves models for a specific brand in the tenant.
   */
  async listBrandModels(
    tenantId: string,
    brandId: string,
  ): Promise<Array<{ id: string; name: string; brandId: string; brandName: string }>> {
    return withTenant(tenantId, async (tx) => {
      const brand = await tx.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 AND id = $2`,
        [tenantId, brandId],
      );
      if (!brand) {
        throw new NotFoundError("Бренд не найден");
      }

      const rows = await tx.query<{ id: string; name: string; brand_id: string }>(
        `SELECT id, name, brand_id
         FROM equipment_models
         WHERE tenant_id = $1 AND brand_id = $2
         ORDER BY name ASC`,
        [tenantId, brandId],
      );

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        brandId: r.brand_id,
        brandName: brand.name,
      }));
    });
  }

  /**
   * Creates a model under a specific brand.
   */
  async createBrandModel(
    tenantId: string,
    brandId: string,
    name: string,
  ): Promise<{ id: string; name: string; brandId: string; brandName: string }> {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("Model name cannot be empty", {});

    return withTenant(tenantId, async (tx) => {
      const brand = await tx.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 AND id = $2`,
        [tenantId, brandId],
      );
      if (!brand) {
        throw new NotFoundError("Бренд не найден");
      }

      const row = await tx.queryOneOrThrow<{ id: string; name: string; brand_id: string }>(
        `INSERT INTO equipment_models (tenant_id, brand_id, brand_name, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, brand_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name, brand_id`,
        [tenantId, brand.id, brand.name, trimmed],
      );

      return {
        id: row.id,
        name: row.name,
        brandId: row.brand_id,
        brandName: brand.name,
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
    brandId?: string,
  ): Promise<{ id: string; name: string; brandId?: string; brandName?: string }> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new ValidationError("Name cannot be empty", {});

    return withTenant(tenantId, async (tx) => {
      const table = this.getDictionaryTable(category);

      if (table === "equipment_models") {
        let targetBrandId = brandId;
        let targetBrandName = brandName?.trim();

        if (targetBrandId) {
          const brandRow = await tx.queryOne<{ id: string; name: string }>(
            `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 AND id = $2`,
            [tenantId, targetBrandId],
          );
          if (!brandRow) {
            throw new NotFoundError("Указанный бренд не найден");
          }
          targetBrandName = brandRow.name;
        } else if (targetBrandName) {
          let brandRow = await tx.queryOne<{ id: string; name: string }>(
            `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 AND lower(name) = lower($2)`,
            [tenantId, targetBrandName],
          );
          if (!brandRow) {
            brandRow = await tx.queryOneOrThrow<{ id: string; name: string }>(
              `INSERT INTO equipment_brands (tenant_id, name)
               VALUES ($1, $2)
               ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
               RETURNING id, name`,
              [tenantId, targetBrandName],
            );
          }
          targetBrandId = brandRow.id;
          targetBrandName = brandRow.name;
        } else {
          throw new ValidationError("Для добавления модели необходимо указать бренд", {});
        }

        const row = await tx.queryOneOrThrow<{ id: string; name: string; brand_id: string }>(
          `INSERT INTO equipment_models (tenant_id, brand_id, brand_name, name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, brand_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, name, brand_id`,
          [tenantId, targetBrandId, targetBrandName, trimmedName],
        );
        return {
          id: row.id,
          name: row.name,
          brandId: row.brand_id,
          brandName: targetBrandName,
        };
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
   * Renames an existing dictionary item.
   */
  async renameDictionaryItem(
    tenantId: string,
    category: string,
    id: string,
    newName: string,
  ): Promise<{ id: string; name: string }> {
    const trimmed = newName.trim();
    if (!trimmed) throw new ValidationError("Name cannot be empty", {});

    return withTenant(tenantId, async (tx) => {
      const table = this.getDictionaryTable(category);

      if (table === "equipment_brands") {
        const row = await tx.queryOne<{ id: string; name: string }>(
          `UPDATE equipment_brands SET name = $1 WHERE tenant_id = $2 AND id = $3 RETURNING id, name`,
          [trimmed, tenantId, id],
        );
        if (!row) {
          throw new NotFoundError("Элемент справочника не найден");
        }
        await tx.query(
          `UPDATE equipment_models SET brand_name = $1 WHERE tenant_id = $2 AND brand_id = $3`,
          [trimmed, tenantId, id],
        );
        return row;
      }

      const row = await tx.queryOne<{ id: string; name: string }>(
        `UPDATE ${table} SET name = $1 WHERE tenant_id = $2 AND id = $3 RETURNING id, name`,
        [trimmed, tenantId, id],
      );
      if (!row) {
        throw new NotFoundError("Элемент справочника не найден");
      }
      return row;
    });
  }

  /**
   * Deletes a dictionary item with integrity protection:
   * Rejects with 409 Conflict if used in any existing repair order.
   */
  async deleteDictionaryItem(
    tenantId: string,
    category: string,
    id: string,
  ): Promise<{ success: boolean; id: string }> {
    return withTenant(tenantId, async (tx) => {
      const table = this.getDictionaryTable(category);
      const existing = await tx.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM ${table} WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!existing) {
        throw new NotFoundError("Элемент справочника не найден");
      }

      const itemName = existing.name;
      let count = 0;

      const normCategory = category.toLowerCase();
      if (normCategory === "type" || normCategory === "types") {
        const res = await tx.queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM repair_orders WHERE tenant_id = $1 AND equipment_type = $2 AND deleted_at IS NULL`,
          [tenantId, itemName],
        );
        count = Number(res?.count ?? 0);
      } else if (normCategory === "brand" || normCategory === "brands") {
        const res = await tx.queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM repair_orders WHERE tenant_id = $1 AND equipment_brand = $2 AND deleted_at IS NULL`,
          [tenantId, itemName],
        );
        count = Number(res?.count ?? 0);
      } else if (normCategory === "model" || normCategory === "models") {
        const res = await tx.queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM repair_orders WHERE tenant_id = $1 AND equipment_model = $2 AND deleted_at IS NULL`,
          [tenantId, itemName],
        );
        count = Number(res?.count ?? 0);
      } else if (normCategory === "accessory" || normCategory === "accessories") {
        const res = await tx.queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM repair_orders
           WHERE tenant_id = $1 AND ($2 = ANY(package_contents_items) OR package_contents ILIKE '%' || $2 || '%') AND deleted_at IS NULL`,
          [tenantId, itemName],
        );
        count = Number(res?.count ?? 0);
      } else if (normCategory === "malfunction" || normCategory === "malfunctions") {
        const res = await tx.queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM repair_orders
           WHERE tenant_id = $1 AND ($2 = ANY(malfunctions) OR defect_description ILIKE '%' || $2 || '%') AND deleted_at IS NULL`,
          [tenantId, itemName],
        );
        count = Number(res?.count ?? 0);
      }

      if (count > 0) {
        throw new AppError(
          409,
          "DICTIONARY_ITEM_IN_USE",
          `Нельзя удалить, так как используется в ${count} ремонтах. Переименуйте или отвяжите от оборудования.`,
          { count: [String(count)], name: [itemName] },
        );
      }

      await tx.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      return { success: true, id };
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
        deal_id: string | null;
        deal_title: string | null;
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
        works: { id: string; description: string; cost: number; masterName: string }[] | null;
      }>(
        `SELECT
           ro.id, ro.ticket_number, ro.deal_id, d.title AS deal_title,
           ro.customer_id, ro.customer_name, ro.customer_phone,
           ro.equipment_type, ro.equipment_brand, ro.equipment_model, ro.equipment_serial,
           ro.package_contents, ro.package_contents_items, ro.defect_description, ro.malfunctions,
           ro.status, ro.master_name, ro.estimated_cost, ro.final_cost,
           ro.received_at, ro.completed_at, ro.delivered_at,
           COALESCE(
             (SELECT json_agg(json_build_object('id', rw.id, 'description', rw.description, 'cost', rw.cost, 'masterName', rw.master_name))
              FROM repair_works rw WHERE rw.repair_order_id = ro.id),
             '[]'::json
           ) AS works
         FROM repair_orders ro
         LEFT JOIN deals d ON d.id = ro.deal_id AND d.tenant_id = ro.tenant_id
         WHERE ro.tenant_id = $1
           AND lower(btrim(ro.equipment_serial)) = lower($2)
           AND ro.deleted_at IS NULL
         ORDER BY ro.received_at DESC
         LIMIT 20`,
        [tenantId, trimmedSerial],
      );

      const latest = rows[0];
      if (!latest) {
        return { found: false, equipment: null, customer: null, historyCount: 0, history: [] };
      }

      const history: EquipmentHistoryItemDTO[] = rows.map((r) => ({
        id: r.id,
        ticketNumber: r.ticket_number,
        dealId: r.deal_id ?? null,
        dealTitle: r.deal_title ?? null,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        receivedAt: r.received_at instanceof Date ? r.received_at.toISOString() : String(r.received_at),
        completedAt: r.completed_at ? (r.completed_at instanceof Date ? r.completed_at.toISOString() : String(r.completed_at)) : null,
        deliveredAt: r.delivered_at ? (r.delivered_at instanceof Date ? r.delivered_at.toISOString() : String(r.delivered_at)) : null,
        status: r.status,
        defectDescription: r.defect_description,
        malfunctions: Array.isArray(r.malfunctions) ? r.malfunctions : [],
        estimatedCost: typeof r.estimated_cost === "number" ? r.estimated_cost : (parseFloat(String(r.estimated_cost || 0)) || 0),
        finalCost: r.final_cost !== null ? (typeof r.final_cost === "number" ? r.final_cost : parseFloat(String(r.final_cost))) : null,
        masterName: r.master_name,
        works: Array.isArray(r.works) ? r.works : [],
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

  // -------------------------------------------------------------------------
  // Services Catalog
  // -------------------------------------------------------------------------

  async listServicesCatalog(tenantId: string): Promise<RepairServiceCatalogItemDTO[]> {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query<RepairServiceCatalogRow>(
        `SELECT id, tenant_id, name, default_price, created_at
         FROM repair_services_catalog
         WHERE tenant_id = $1
         ORDER BY name ASC`,
        [tenantId],
      );

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        defaultPrice: Number(r.default_price),
        createdAt: toIso(r.created_at),
      }));
    });
  }

  async addServiceToCatalog(
    tenantId: string,
    payload: CreateRepairServiceCatalogPayload,
  ): Promise<RepairServiceCatalogItemDTO> {
    const trimmed = payload.name.trim();
    if (!trimmed) throw new ValidationError("Название услуги не может быть пустым", {});

    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOneOrThrow<RepairServiceCatalogRow>(
        `INSERT INTO repair_services_catalog (tenant_id, name, default_price)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name)
         DO UPDATE SET default_price = EXCLUDED.default_price
         RETURNING id, tenant_id, name, default_price, created_at`,
        [tenantId, trimmed, payload.default_price ?? 0],
      );

      return {
        id: row.id,
        name: row.name,
        defaultPrice: Number(row.default_price),
        createdAt: toIso(row.created_at),
      };
    });
  }

  async deleteServiceFromCatalog(
    tenantId: string,
    id: string,
  ): Promise<{ success: boolean; id: string }> {
    return withTenant(tenantId, async (tx) => {
      await tx.query(
        `DELETE FROM repair_services_catalog WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return { success: true, id };
    });
  }
}
