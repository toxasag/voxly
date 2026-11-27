import { nullIfBlank } from "../../../lib/string.utils.js";
import {
  appendExcludedIdsCondition,
  buildSortOrderBy,
  nullableTextExpr,
  type SortDirection,
} from "../../../lib/table-query.js";
import type {
  CreateDealItemPayload,
  CreateDealMessagePayload,
  CreateDealPayload,
  CreateStagePayload,
  DealContactHistoryDTO,
  DealContactSummaryDTO,
  DealContactTimelineItemDTO,
  DealDTO,
  DealItemBatchAllocationDTO,
  DealItemCostSource,
  DealItemDTO,
  DealItemRow,
  DealMessageDTO,
  DealMessageRow,
  DealOtherDealItemDTO,
  DealRow,
  DeliveryStatus,
  KanbanColumn,
  PipelineDTO,
  StageColor,
  StageRow,
  UpdateDealItemPayload,
  UpdateDealPayload,
  UpdateStagePayload,
} from "./deals.types.js";
import { stageColorSchema, toDealDTO, toDealMessageDTO } from "./deals.types.js";
import { query, queryOne, withTenant, type SqlParam, type TransactionClient } from "../../../db/client.js";
import { NotFoundError, ValidationError, UnprocessableEntityError } from "../../../plugins/errorHandler.js";
import { leadNotificationQueue } from "../leads/lead-notification.queue.js";
import { notificationQueue } from "../../notifications/notification.queue.js";
import { conversionDispatcher } from "../../analytics/conversion-dispatcher.service.js";
import { ContactActivityService } from "../contacts/contact-activity.service.js";
import { messageTranslationService } from "../translation/message-translation.service.js";
import { chatEventBus } from "../chat/chat-events.js";
import { warehouseService } from "../../warehouse/warehouse.service.js";
import type { BulkActionPayload } from "../shared/bulk-action.types.js";

const DEAL_COLUMNS = `
  id, tenant_id, pipeline_id, stage_id, contact_id, company_id, source_widget_id, title, description,
  budget, currency, custom_fields, source_metadata, created_by, owner_id, close_date, position,
  closed_at, lead_notified_at, created_at, updated_at, chat_thread_id, status
`;

/**
 * Те же колонки с префиксом и подписями связей.
 *
 * JOIN'ы вместо отдельных запросов на строку: таблица записей рисует чипы
 * компании, контактного лица и ответственного в каждой строке, и без этого
 * список из 50 сделок стоил бы 150 дополнительных запросов.
 */
const DEAL_COLUMNS_WITH_LABELS = `
  d.id, d.tenant_id, d.pipeline_id, d.stage_id, d.contact_id, d.company_id, d.source_widget_id, d.title,
  d.description, d.budget, d.currency, d.custom_fields, d.source_metadata, d.created_by, d.owner_id,
  d.close_date, d.position, d.closed_at, d.lead_notified_at, d.created_at, d.updated_at,
  d.chat_thread_id, d.status,
  co.name AS company_name,
  co.phone AS company_phone,
  co.email AS company_email,
  co.domain_name AS company_domain_name,
  co.address_city AS company_city,
  ct.first_name AS contact_first_name,
  ct.last_name AS contact_last_name,
  ct.phone AS contact_phone,
  ct.email AS contact_email,
  ct.job_title AS contact_job_title,
  ct.is_personal AS contact_is_personal,
  ct.socials AS contact_socials,
  ct.channel AS contact_channel,
  ct.telegram_username AS contact_telegram_username,
  ct.whatsapp AS contact_whatsapp,
  ca.channel AS source_channel,
  ca.label AS source_channel_label,
  ow.name AS owner_name,
  ln.body AS latest_note_body,
  COALESCE(tk.total_tasks_count, 0) AS tasks_count,
  COALESCE(tk.pending_tasks_count, 0) AS pending_tasks_count,
  tk.next_task_title,
  tk.next_task_due_date
`;

/**
 * Каждый JOIN ограничен арендатором сделки.
 *
 * Не «на всякий случай»: `deals.contact_id` и `company_id` до сих пор без FK, а
 * `users` вообще не входит в список таблиц под RLS (см. schema.sql, блок
 * `tenant_isolation`) — суперпользователь и роль-владелец её политиками не
 * ограничены, да и политики для неё нет. Поэтому чужой идентификатор,
 * оказавшийся в `owner_id` или `company_id`, без этих предикатов подставил бы в
 * ответ имя пользователя или название компании другого арендатора.
 */
const DEAL_LABEL_JOINS = `
  LEFT JOIN companies co
    ON co.id = d.company_id AND co.tenant_id = d.tenant_id AND co.deleted_at IS NULL
  LEFT JOIN contacts ct
    ON ct.id = d.contact_id AND ct.tenant_id = d.tenant_id AND ct.deleted_at IS NULL
  LEFT JOIN channel_accounts ca
    ON ca.id = d.source_widget_id AND ca.tenant_id = d.tenant_id AND ca.deleted_at IS NULL
  LEFT JOIN users ow
    ON ow.id = d.owner_id AND ow.tenant_id = d.tenant_id AND ow.deleted_at IS NULL
  LEFT JOIN users cr
    ON cr.id = d.created_by AND cr.tenant_id = d.tenant_id AND cr.deleted_at IS NULL
  LEFT JOIN stages st
    ON st.id = d.stage_id
  LEFT JOIN LATERAL (
    SELECT n.body
    FROM notes n
    WHERE n.deal_id = d.id AND n.tenant_id = d.tenant_id AND n.deleted_at IS NULL
    ORDER BY n.created_at DESC
    LIMIT 1
  ) ln ON true
  LEFT JOIN LATERAL (
    SELECT 
      COUNT(*)::int AS total_tasks_count,
      COUNT(*) FILTER (WHERE t.status != 'done')::int AS pending_tasks_count,
      (
        SELECT t2.title 
        FROM crm_tasks t2 
        WHERE t2.deal_id = d.id AND t2.tenant_id = d.tenant_id AND t2.deleted_at IS NULL AND t2.status != 'done'
        ORDER BY t2.due_date ASC NULLS LAST, t2.created_at DESC 
        LIMIT 1
      ) AS next_task_title,
      (
        SELECT t2.due_date 
        FROM crm_tasks t2 
        WHERE t2.deal_id = d.id AND t2.tenant_id = d.tenant_id AND t2.deleted_at IS NULL AND t2.status != 'done'
        ORDER BY t2.due_date ASC NULLS LAST, t2.created_at DESC 
        LIMIT 1
      ) AS next_task_due_date
    FROM crm_tasks t
    WHERE t.deal_id = d.id AND t.tenant_id = d.tenant_id AND t.deleted_at IS NULL
  ) tk ON true
`;

const MESSAGE_COLUMNS = `
  id, tenant_id, deal_id, channel_account_id, source, direction, sender_name, content, channel,
  attachment, attachment_type, delivery_status, delivery_error, metadata, delivered_at, read_at, created_at
`;

export type DealWonHandler = (payload: { tenantId: string; dealId: string }) => void | Promise<void>;
const dealWonHandlers: DealWonHandler[] = [];

export type DealStageChangedHandler = (payload: { tenantId: string; dealId: string; stageId: string }) => void | Promise<void>;
const dealStageChangedHandlers: DealStageChangedHandler[] = [];

/**
 * Регистрация слушателя успешного закрытия сделки.
 * Позволяет внешним модулям (например, AI SalesLearnService) обучаться на
 * выигранных сделках без жесткой циклической связи с CRM-ядром.
 */
export function onDealWon(handler: DealWonHandler): () => void {
  dealWonHandlers.push(handler);
  return () => {
    const idx = dealWonHandlers.indexOf(handler);
    if (idx !== -1) dealWonHandlers.splice(idx, 1);
  };
}

/**
 * Регистрация слушателя перехода сделки на этап (для автоворонок StageRules).
 */
export function onDealStageChanged(handler: DealStageChangedHandler): () => void {
  dealStageChangedHandlers.push(handler);
  return () => {
    const idx = dealStageChangedHandlers.indexOf(handler);
    if (idx !== -1) dealStageChangedHandlers.splice(idx, 1);
  };
}

/**
 * Оповещение слушателей о смене этапа сделки (StageRules, ConversionDispatcher и др.)
 */
export function notifyDealStageChanged(payload: { tenantId: string; dealId: string; stageId: string }): void {
  for (const handler of dealStageChangedHandlers) {
    Promise.resolve(handler(payload)).catch(() => undefined);
  }
}

/**
 * Оповещение слушателей о выигрыше сделки (SalesLearnService и др.)
 */
export function notifyDealWon(payload: { tenantId: string; dealId: string }): void {
  for (const handler of dealWonHandlers) {
    Promise.resolve(handler(payload)).catch(() => undefined);
  }
}

/** Treats "" from form payloads as "no value". */
export type DealPresetFilter = "all" | "active" | "high_value" | "won";

export interface ListDealsOptions {
  pipelineId?: string;
  stageId?: string;
  status?: "active" | "won" | "lost" | "all";
  preset?: DealPresetFilter;
  search?: string;
  /** Секция «Сделки» на карточке контакта. */
  contactId?: string;
  /** Секция «Сделки» на карточке компании. */
  companyId?: string;
  limit: number;
  offset: number;
  sortBy?: string;
  sortDir?: SortDirection;
}

export class DealsService {
  private buildDealsWhereClause(
    tenantId: string,
    options: {
      pipelineId?: string;
      stageId?: string;
      status?: "active" | "won" | "lost" | "all";
      preset?: DealPresetFilter;
      search?: string;
      contactId?: string;
      companyId?: string;
      excludedIds?: string[];
    },
  ): { where: string; params: SqlParam[] } {
    const conditions: string[] = ["d.tenant_id = $1", "d.deleted_at IS NULL"];
    if (options.status !== "all") {
      conditions.push("(d.status IS NULL OR d.status != 'duplicate')");
    }
    const params: SqlParam[] = [tenantId];

    if (options.pipelineId !== undefined && options.pipelineId.trim().length > 0) {
      params.push(options.pipelineId.trim());
      conditions.push(`d.pipeline_id = $${params.length}`);
    }

    if (options.stageId !== undefined && options.stageId.trim().length > 0) {
      params.push(options.stageId.trim());
      conditions.push(`d.stage_id = $${params.length}`);
    }

    if (options.status === "active") {
      conditions.push("d.closed_at IS NULL");
    } else if (options.status === "won" || options.status === "lost") {
      conditions.push("d.closed_at IS NOT NULL");
    }

    if (options.preset === "active") {
      conditions.push(`NOT (COALESCE(st.is_won, false) OR COALESCE(st.is_lost, false))`);
    } else if (options.preset === "high_value") {
      conditions.push(`d.budget >= 100000`);
    } else if (options.preset === "won") {
      conditions.push(`COALESCE(st.is_won, false) = true`);
    }

    if (options.search !== undefined && options.search.trim().length > 0) {
      params.push(`%${options.search.trim()}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(d.title ILIKE ${placeholder}
          OR d.description ILIKE ${placeholder}
          OR EXISTS (
            SELECT 1 FROM contacts ct
            WHERE ct.id = d.contact_id AND ct.tenant_id = d.tenant_id AND ct.deleted_at IS NULL
              AND (
                ct.first_name ILIKE ${placeholder}
                OR ct.last_name ILIKE ${placeholder}
                OR ct.phone ILIKE ${placeholder}
              )
          )
          OR EXISTS (
            SELECT 1 FROM companies co
            WHERE co.id = d.company_id AND co.tenant_id = d.tenant_id AND co.deleted_at IS NULL
              AND (co.name ILIKE ${placeholder} OR co.phone ILIKE ${placeholder})
          ))`,
      );
    }

    if (options.contactId !== undefined) {
      params.push(options.contactId);
      conditions.push(`d.contact_id = $${params.length}`);
    }

    if (options.companyId !== undefined) {
      params.push(options.companyId);
      conditions.push(`d.company_id = $${params.length}`);
    }

    appendExcludedIdsCondition(conditions, params, "d.id", options.excludedIds);
    return { where: conditions.join(" AND "), params };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    tenantId: string,
    options: ListDealsOptions,
  ): Promise<{ items: DealDTO[]; total: number }> {
    const { where, params } = this.buildDealsWhereClause(tenantId, options);

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM deals d
       LEFT JOIN stages st ON st.id = d.stage_id
       WHERE ${where}`,
      params,
    );

    params.push(options.limit, options.offset);

    const orderBy = buildSortOrderBy({
      sortBy: options.sortBy,
      sortDir: options.sortDir,
      columns: {
        title: nullableTextExpr("d.title"),
        budget: "d.budget",
        created: "d.created_at",
        created_at: "d.created_at",
        closeDate: { expr: "d.close_date", nullable: true },
        close_date: { expr: "d.close_date", nullable: true },
        company: { expr: nullableTextExpr("co.name"), nullable: true },
        contact: {
          expr: nullableTextExpr("ct.first_name"),
          secondaryExpr: nullableTextExpr("ct.last_name"),
          nullable: true,
        },
        stage: { expr: "st.sort_order", nullable: true },
        owner: { expr: nullableTextExpr("ow.name"), nullable: true },
        updatedAt: "d.updated_at",
        updated_at: "d.updated_at",
        last_message: "d.updated_at",
        last_event: "d.updated_at",
        closedAt: { expr: "d.closed_at", nullable: true },
        closed_at: { expr: "d.closed_at", nullable: true },
        createdBy: { expr: nullableTextExpr("cr.name"), nullable: true },
        created_by: { expr: nullableTextExpr("cr.name"), nullable: true },
        description: { expr: nullableTextExpr("d.description"), nullable: true },
        currency: "d.currency",
      },
      defaultOrderBy: "d.created_at DESC",
      tieBreaker: "d.id DESC",
    });

    const rows = await query<DealRow>(
      `SELECT ${DEAL_COLUMNS_WITH_LABELS}
       FROM deals d
       ${DEAL_LABEL_JOINS}
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: rows.map(toDealDTO), total: Number(countRow?.total ?? 0) };
  }

  async get(tenantId: string, id: string): Promise<DealDTO | null> {
    const row = await queryOne<DealRow>(
      `SELECT ${DEAL_COLUMNS_WITH_LABELS}
       FROM deals d
       ${DEAL_LABEL_JOINS}
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, id],
    );

    return row === null ? null : toDealDTO(row);
  }

  /**
   * Pipeline catalog for the current tenant.
   *
   * `GET /deals/kanban` and `POST /deals` both require a pipeline UUID. The
   * project previously exposed neither the IDs nor a list endpoint, forcing
   * the UI to keep a fake hardcoded board. This intentionally returns only
   * pipeline metadata; stages and deals remain the Kanban projection's job.
   */
  async listPipelines(tenantId: string): Promise<PipelineDTO[]> {
    const rows = await query<{ id: string; name: string; sort_order: number }>(
      `SELECT id, name, sort_order
       FROM pipelines
       WHERE tenant_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [tenantId],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
    }));
  }

  /**
   * Kanban projection: every stage of the pipeline with its deals, count and
   * budget total. Empty stages are returned so the board renders all columns.
   */
  async kanban(
    tenantId: string,
    pipelineId: string,
    options?: { maxDeals?: number },
  ): Promise<KanbanColumn[]> {
    const maxDeals = Math.min(Math.max(options?.maxDeals ?? 2000, 1), 5000);
    const stages = await query<StageRow>(
      `SELECT s.id, s.pipeline_id, s.name, s.sort_order, s.is_won, s.is_lost, s.is_system, s.color
       FROM stages s
       JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.pipeline_id = $1 AND p.tenant_id = $2
       ORDER BY s.sort_order ASC`,
      [pipelineId, tenantId],
    );

    if (stages.length === 0) {
      throw new NotFoundError("Pipeline not found or has no stages");
    }

    // Порядок внутри колонки: сначала position (ручное перетаскивание), затем
    // дата — у сделок, созданных до появления поля, position одинаковый.
    // Защитный LIMIT исключает OOM на сверхкрупных воронках.
    const rows = await query<DealRow>(
      `SELECT ${DEAL_COLUMNS_WITH_LABELS}
       FROM deals d
       ${DEAL_LABEL_JOINS}
       WHERE d.tenant_id = $1 AND d.pipeline_id = $2 AND d.deleted_at IS NULL
         AND (d.status IS NULL OR d.status != 'duplicate')
       ORDER BY d.position ASC, d.created_at DESC
       LIMIT $3`,
      [tenantId, pipelineId, maxDeals],
    );

    const grouped = new Map<string, DealDTO[]>();
    for (const row of rows) {
      const dto = toDealDTO(row);
      const bucket = grouped.get(dto.stageId);
      if (bucket === undefined) {
        grouped.set(dto.stageId, [dto]);
      } else {
        bucket.push(dto);
      }
    }

    return stages.map((stage) => {
      const deals = grouped.get(stage.id) ?? [];
      return {
        stageId: stage.id,
        stageName: stage.name,
        sortOrder: stage.sort_order,
        isWon: stage.is_won,
        isLost: stage.is_lost,
        isSystem: stage.is_system,
        stageColor: stage.color,
        dealCount: deals.length,
        budgetTotal: deals.reduce((sum, deal) => sum + deal.budget, 0),
        deals,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(
    tenantId: string,
    createdBy: string,
    payload: CreateDealPayload,
  ): Promise<DealDTO> {
    const created = await withTenant(tenantId, async (tx) => {
      return this.createInTx(tx, tenantId, createdBy, payload);
    });

    void leadNotificationQueue.checkAndTriggerNotification(tenantId, created.id);
    void notificationQueue.dispatchLeadCreated({ tenantId, dealId: created.id });
    void conversionDispatcher.handleDealCreated({ tenantId, dealId: created.id });
    if (created.contactId) {
      const contactId = created.contactId;
      void import("../enrichment.service.js")
        .then(({ CrmEnrichmentService }) =>
          new CrmEnrichmentService().enrichContact(tenantId, contactId, {
            dealId: created.id,
            skipIfAlreadyChecked: true,
          }),
        )
        .catch(() => {});
    }
    return created;
  }

  async createInTx(
    tx: import("../../../db/client.js").TransactionClient,
    tenantId: string,
    createdBy: string,
    payload: CreateDealPayload,
  ): Promise<DealDTO> {
      // The stage must belong to the pipeline, and the pipeline to this tenant.
      const stage = await tx.queryOne<{ id: string }>(
        `SELECT s.id
         FROM stages s
         JOIN pipelines p ON p.id = s.pipeline_id
         WHERE s.id = $1 AND s.pipeline_id = $2 AND p.tenant_id = $3`,
        [payload.stage_id, payload.pipeline_id, tenantId],
      );

      if (stage === null) {
        throw new ValidationError("stage_id does not belong to the given pipeline", {
          stage_id: ["Unknown stage for this pipeline"],
        });
      }

      // Новая карточка встаёт первой в своей колонке: менеджер только что её
      // завёл и ждёт увидеть её сверху, а не в хвосте после старых сделок.
      const first = await tx.queryOne<{ position: number | null }>(
        `SELECT MIN(position) AS position FROM deals
         WHERE tenant_id = $1 AND stage_id = $2 AND deleted_at IS NULL`,
        [tenantId, payload.stage_id],
      );

      // Валидация контакта: проверка принадлежности и запрет создания сделок с поставщиками
      const contactId = nullIfBlank(payload.contact_id);
      let contactInfo: { channel: string; socials: Array<{ kind: string }> } | null = null;
      if (contactId) {
        const contact = await tx.queryOne<{ id: string; contact_type: string; channel: string; socials: Array<{ kind: string }> }>(
          `SELECT id, contact_type, channel, socials FROM contacts
           WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [contactId, tenantId],
        );
        if (contact === null) {
          throw new ValidationError("contact_id does not belong to this tenant", {
            contact_id: ["Unknown contact"],
          });
        }
        if (contact.contact_type === "vendor") {
          throw new UnprocessableEntityError("Нельзя создать сделку с поставщиком", {
            contact_id: ["Сделка не может быть создана с контактом в статусе 'Поставщик'"],
          });
        }
        contactInfo = contact;
      }

      // Разрешение источника/канала коммуникации (source_widget_id)
      let resolvedSourceWidgetId = nullIfBlank(payload.source_widget_id);
      if (!resolvedSourceWidgetId && contactInfo) {
        const preferredChannel = contactInfo.socials?.find((s) => s.kind === "max")
          ? "max"
          : contactInfo.channel !== "phone"
            ? contactInfo.channel
            : null;
        if (preferredChannel) {
          const acc = await tx.queryOne<{ id: string }>(
            `SELECT id FROM channel_accounts WHERE tenant_id = $1 AND channel = $2 AND status = 'connected' AND deleted_at IS NULL LIMIT 1`,
            [tenantId, preferredChannel],
          );
          if (acc) resolvedSourceWidgetId = acc.id;
        }
      }
      if (!resolvedSourceWidgetId) {
        const defAcc = await tx.queryOne<{ id: string }>(
          `SELECT id FROM channel_accounts WHERE tenant_id = $1 AND channel IN ('max', 'telegram', 'whatsapp') AND status = 'connected' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
          [tenantId],
        );
        if (defAcc) resolvedSourceWidgetId = defAcc.id;
      }

      const row = await tx.queryOneOrThrow<DealRow>(
        `INSERT INTO deals
           (tenant_id, pipeline_id, stage_id, contact_id, company_id, title, description,
            budget, currency, custom_fields, source_metadata, created_by, owner_id, close_date, position, source_widget_id, chat_thread_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17, $18)
         RETURNING ${DEAL_COLUMNS}`,
        [
          tenantId,
          payload.pipeline_id,
          payload.stage_id,
          nullIfBlank(payload.contact_id),
          nullIfBlank(payload.company_id),
          payload.title,
          payload.description ?? "",
          payload.budget,
          payload.currency,
          JSON.stringify(payload.custom_fields ?? {}),
          JSON.stringify(payload.source_metadata ?? {}),
          createdBy,
          // Ответственный по умолчанию — создатель: сделка без владельца
          // выпадает из отчётов по менеджерам.
          nullIfBlank(payload.owner_id) ?? createdBy,
          nullIfBlank(payload.close_date),
          (first?.position ?? 1) - 1,
          resolvedSourceWidgetId,
          payload.chat_thread_id ?? null,
          payload.status ?? "active",
        ],
      );

      await tx.query(
        `INSERT INTO deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, changed_by)
         VALUES ($1, $2, NULL, $3, $4)`,
        [tenantId, row.id, payload.stage_id, createdBy],
      );

      return toDealDTO(row);
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdateDealPayload,
    updatedBy?: string | null,
  ): Promise<DealDTO | null> {
    // Каждая переданная ссылка проверяется на принадлежность арендатору.
    //
    // `createInTx` и `moveStage` это делали, а `update` — нет: он писал
    // `stage_id`, `contact_id`, `company_id` и `owner_id` прямо из тела запроса.
    // FK здесь не страховка — у `deals.contact_id` и `company_id` его нет вовсе,
    // а `stages.id` и `users.id` уникальны глобально, без привязки к арендатору.
    // Поэтому `PATCH /deals/:id` позволял привязать свою сделку к стадии,
    // контакту, компании или ответственному другого арендатора, попутно обходя
    // проверку «стадия принадлежит воронке сделки», которую делает `moveStage`.
    await this.assertOwnedReferences(tenantId, id, payload);

    const assignments: string[] = [];
    const params: SqlParam[] = [tenantId, id];

    const push = (column: string, value: SqlParam): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (payload.title !== undefined) push("title", payload.title);
    if (payload.description !== undefined) push("description", payload.description);
    if (payload.budget !== undefined) push("budget", payload.budget);
    if (payload.currency !== undefined) push("currency", payload.currency);
    if (payload.stage_id !== undefined) push("stage_id", payload.stage_id);
    if (payload.contact_id !== undefined) push("contact_id", nullIfBlank(payload.contact_id));
    if (payload.company_id !== undefined) push("company_id", nullIfBlank(payload.company_id));
    if (payload.owner_id !== undefined) push("owner_id", nullIfBlank(payload.owner_id));
    if (payload.close_date !== undefined) push("close_date", nullIfBlank(payload.close_date));
    if (payload.position !== undefined) push("position", payload.position);
    if (payload.chat_thread_id !== undefined) push("chat_thread_id", nullIfBlank(payload.chat_thread_id));
    if (payload.status !== undefined) push("status", payload.status);

    if (payload.custom_fields !== undefined) {
      params.push(JSON.stringify(payload.custom_fields));
      assignments.push(`custom_fields = $${params.length}::jsonb`);
    }

    if (payload.closed_at !== undefined) {
      const closedAt = nullIfBlank(payload.closed_at);
      push("closed_at", closedAt === null ? null : new Date(closedAt).toISOString());
    }

    if (payload.created_at !== undefined) {
      const createdAt = nullIfBlank(payload.created_at);
      if (createdAt) {
        push("created_at", new Date(createdAt).toISOString());
      }
    }

    if (assignments.length === 0) {
      return this.get(tenantId, id);
    }

    const row = await queryOne<{ id: string }>(
      `UPDATE deals SET ${assignments.join(", ")}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      params,
    );

    if (row === null) return null;

    // Если стадия сменилась через PATCH /deals/:id — уведомляем слушателей (автоворонки, сквозная аналитика)
    if (payload.stage_id !== undefined) {
      notifyDealStageChanged({ tenantId, dealId: id, stageId: payload.stage_id });

      const targetStage = await queryOne<{ is_won: boolean }>(
        `SELECT is_won FROM stages WHERE id = $1`,
        [payload.stage_id],
      );
      if (targetStage?.is_won) {
        notifyDealWon({ tenantId, dealId: id });
        await withTenant(tenantId, async (tx) => {
          if (payload.closed_at === undefined) {
            await tx.query(
              `UPDATE deals SET closed_at = COALESCE(closed_at, now()) WHERE tenant_id = $1 AND id = $2`,
              [tenantId, id],
            );
          }
          await warehouseService.consumeDealItemsInTx(tx, tenantId, id, updatedBy ?? null);
        });
      }
    }

    // Перечитываем через get: RETURNING не отдаёт подписи связей (они приходят
    // JOIN'ами), и ответ на inline-правку обнулял бы чипы в таблице.
    const updated = await this.get(tenantId, id);
    if (updated) {
      void leadNotificationQueue.checkAndTriggerNotification(tenantId, id);
    }
    return updated;
  }

  /**
   * Отклоняет ссылки на записи чужого арендатора.
   *
   * Пустая строка означает «снять связь» и проверки не требует. Стадия
   * сверяется не просто по арендатору, а по воронке самой сделки: сделка не может
   * стоять в стадии другой воронки, и `moveStage` это уже гарантирует.
   */
  private async assertOwnedReferences(
    tenantId: string,
    dealId: string,
    payload: UpdateDealPayload,
  ): Promise<void> {
    const contactId = nullIfBlank(payload.contact_id);
    if (contactId !== null) {
      const contact = await queryOne<{ id: string; contact_type: string }>(
        `SELECT id, contact_type FROM contacts
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [contactId, tenantId],
      );

      if (contact === null) {
        throw new ValidationError("contact_id does not belong to this tenant", {
          contact_id: ["Unknown contact"],
        });
      }

      if (contact.contact_type === "vendor") {
        throw new UnprocessableEntityError("Нельзя связать сделку с поставщиком", {
          contact_id: ["Сделка не может быть создана или связана с контактом в статусе 'Поставщик'"],
        });
      }
    }

    const companyId = nullIfBlank(payload.company_id);
    if (companyId !== null) {
      const company = await queryOne<{ id: string }>(
        `SELECT id FROM companies
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [companyId, tenantId],
      );

      if (company === null) {
        throw new ValidationError("company_id does not belong to this tenant", {
          company_id: ["Unknown company"],
        });
      }
    }

    const ownerId = nullIfBlank(payload.owner_id);
    if (ownerId !== null) {
      const owner = await queryOne<{ id: string }>(
        `SELECT id FROM users
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [ownerId, tenantId],
      );

      if (owner === null) {
        throw new ValidationError("owner_id does not belong to this tenant", {
          owner_id: ["Unknown user"],
        });
      }
    }

    if (payload.stage_id !== undefined) {
      const stage = await queryOne<{ id: string }>(
        `SELECT s.id
         FROM stages s
         JOIN pipelines p ON p.id = s.pipeline_id
         JOIN deals d ON d.pipeline_id = s.pipeline_id
         WHERE s.id = $1
           AND p.tenant_id = $2
           AND d.id = $3
           AND d.tenant_id = $2
           AND d.deleted_at IS NULL`,
        [payload.stage_id, tenantId, dealId],
      );

      if (stage === null) {
        throw new ValidationError("stage_id does not belong to the deal's pipeline", {
          stage_id: ["Unknown stage for this pipeline"],
        });
      }
    }
  }

  /**
   * Internal transactional stage mover.
   */
  async moveStageInTx(
    tx: import("../../../db/client.js").TransactionClient,
    tenantId: string,
    id: string,
    stageId: string,
    changedBy: string,
    targetIndex?: number,
  ): Promise<DealDTO | null> {
    const deal = await tx.queryOne<{ stage_id: string; pipeline_id: string }>(
      `SELECT stage_id, pipeline_id
       FROM deals
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [tenantId, id],
    );

    if (deal === null) return null;

    const stage = await tx.queryOne<{ is_won: boolean; is_lost: boolean }>(
      `SELECT s.is_won, s.is_lost
       FROM stages s
       JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.id = $1 AND s.pipeline_id = $2 AND p.tenant_id = $3`,
      [stageId, deal.pipeline_id, tenantId],
    );

    if (stage === null) {
      throw new ValidationError("Target stage does not belong to the deal's pipeline", {
        stage_id: ["Unknown stage for this pipeline"],
      });
    }

    const isTerminal = stage.is_won || stage.is_lost;
    const position = await this.positionForIndex(tx, tenantId, stageId, id, targetIndex);

    await tx.query(
      `UPDATE deals
       SET stage_id = $3,
           position = $5,
           closed_at = CASE WHEN $4::boolean THEN COALESCE(closed_at, now()) ELSE NULL END
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, stageId, isTerminal, position],
    );

    if (deal.stage_id !== stageId) {
      await tx.query(
        `INSERT INTO deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, id, deal.stage_id, stageId, changedBy],
      );

      for (const handler of dealStageChangedHandlers) {
        Promise.resolve(handler({ tenantId, dealId: id, stageId })).catch(() => undefined);
      }

      if (stage.is_won) {
        // Атомарное FIFO-списание товаров сделки со склада + автозаявки при дефиците
        await warehouseService.consumeDealItemsInTx(tx, tenantId, id, changedBy);
        for (const handler of dealWonHandlers) {
          Promise.resolve(handler({ tenantId, dealId: id })).catch(() => undefined);
        }
      }
    }

    const row = await tx.queryOneOrThrow<DealRow>(
      `SELECT ${DEAL_COLUMNS_WITH_LABELS}
       FROM deals d
       ${DEAL_LABEL_JOINS}
       WHERE d.tenant_id = $1 AND d.id = $2`,
      [tenantId, id],
    );

    void leadNotificationQueue.checkAndTriggerNotification(tenantId, id);

    return toDealDTO(row);
  }

  /**
   * Moves a deal to another stage inside its own pipeline and records the
   * transition. Reaching a won/lost stage stamps `closed_at`; moving back out
   * clears it.
   */
  async moveStage(
    tenantId: string,
    id: string,
    stageId: string,
    changedBy: string,
    /**
     * Позиция внутри целевой колонки: индекс места, куда карточку отпустили.
     * Не передан — карточка встаёт первой (обычный переход стрелками).
     */
    targetIndex?: number,
  ): Promise<DealDTO | null> {
    return withTenant(tenantId, async (tx) => {
      return this.moveStageInTx(tx, tenantId, id, stageId, changedBy, targetIndex);
    });
  }

  /**
   * При приёмке оборудования переводит связанную сделку в этап «В работе»,
   * если сделка активна, не закрыта и находится на более раннем этапе воронки.
   * Выполняется в переданной транзакции tx (в единой транзакции приёмки наряда).
   */
  async advanceDealToInProgressInTx(
    tx: import("../../../db/client.js").TransactionClient,
    tenantId: string,
    dealId: string | null | undefined,
    authorId?: string | null,
  ): Promise<DealDTO | null> {
    if (!dealId) return null;

    const deal = await tx.queryOne<{
      id: string;
      pipeline_id: string;
      stage_id: string;
      status: string;
      created_by: string;
      owner_id: string | null;
      sort_order: number;
      is_won: boolean;
      is_lost: boolean;
    }>(
      `SELECT d.id, d.pipeline_id, d.stage_id, d.status, d.created_by, d.owner_id,
              s.sort_order, s.is_won, s.is_lost
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL
       FOR UPDATE`,
      [tenantId, dealId],
    );

    // Защита: если сделка не найдена, не активна или уже выиграна/проиграна — не трогаем
    if (!deal || deal.status !== "active" || deal.is_won || deal.is_lost) {
      return null;
    }

    // Ищем этап «В работе» динамически в воронке сделки
    const inProgressStage = await tx.queryOne<{ id: string; sort_order: number }>(
      `SELECT s.id, s.sort_order
       FROM stages s
       JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.pipeline_id = $1 AND p.tenant_id = $2
         AND s.is_won = false AND s.is_lost = false
         AND (
           lower(btrim(s.name)) = 'в работе'
           OR lower(btrim(s.name)) = 'in progress'
           OR lower(btrim(s.name)) = 'in_progress'
           OR lower(btrim(s.name)) LIKE '%в работе%'
           OR lower(btrim(s.name)) LIKE '%in progress%'
         )
       ORDER BY s.sort_order ASC
       LIMIT 1`,
      [deal.pipeline_id, tenantId],
    );

    if (!inProgressStage) {
      return null;
    }

    // Защита от дублирования: если сделка уже на этом этапе — не дублируем переход
    if (deal.stage_id === inProgressStage.id) {
      return null;
    }

    // Защита от отката: переводим только если сделка находится на более раннем этапе воронки
    if (deal.sort_order >= inProgressStage.sort_order) {
      return null;
    }

    const changedBy = authorId || deal.owner_id || deal.created_by;
    return this.moveStageInTx(tx, tenantId, dealId, inProgressStage.id, changedBy);
  }

  /**
   * Обертка для вызова advanceDealToInProgress вне существующей транзакции.
   */
  async syncDealProgressFromRepairs(
    tenantId: string,
    dealId: string | null | undefined,
    authorId?: string | null,
  ): Promise<void> {
    if (!dealId) return;

    try {
      await withTenant(tenantId, async (tx) => {
        await this.advanceDealToInProgressInTx(tx, tenantId, dealId, authorId);
      });
    } catch (err) {
      console.error("[deals.service] Failed to sync deal progress from repairs:", { err, dealId });
    }
  }

  /**
   * Проверяет наряд-заказы, привязанные к сделке.
   * Если у сделки есть активные наряды и ВСЕ они имеют статус 'issued' (Выдан)
   * и статус оплаты 'paid' (Оплачен), автоматически переводит сделку в стадию
   * «Успешно реализовано» (is_won = true) с вызовом всех обработчиков и истории.
   */
  async syncDealCompletionFromRepairs(
    tenantId: string,
    dealId: string | null | undefined,
    authorId?: string | null,
  ): Promise<void> {
    if (!dealId) return;

    try {
      // 1. Проверяем, есть ли наряды у этой сделки и все ли они выданы и оплачены
      const stats = await queryOne<{
        total_orders: string;
        completed_paid_orders: string;
      }>(
        `SELECT
           COUNT(*)::text AS total_orders,
           COUNT(*) FILTER (WHERE status = 'issued' AND payment_status = 'paid')::text AS completed_paid_orders
         FROM repair_orders
         WHERE tenant_id = $1 AND deal_id = $2 AND deleted_at IS NULL`,
        [tenantId, dealId],
      );

      const total = parseInt(stats?.total_orders ?? "0", 10);
      const completedPaid = parseInt(stats?.completed_paid_orders ?? "0", 10);

      // Если нарядов нет или не все выданы и оплачены — завершать сделку нельзя
      if (total === 0 || total !== completedPaid) {
        return;
      }

      // 2. Получаем сделку и проверяем, не завершена ли она уже успешно
      const deal = await queryOne<{
        id: string;
        pipeline_id: string;
        stage_id: string;
        created_by: string;
        owner_id: string | null;
        is_won: boolean;
      }>(
        `SELECT d.id, d.pipeline_id, d.stage_id, d.created_by, d.owner_id, s.is_won
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
        [tenantId, dealId],
      );

      if (!deal || deal.is_won) {
        return;
      }

      // 3. Находим стадию «Успешно реализовано» (is_won = true) воронки сделки
      const wonStage = await queryOne<{ id: string }>(
        `SELECT id FROM stages
         WHERE pipeline_id = $1 AND is_won = true
         ORDER BY sort_order ASC
         LIMIT 1`,
        [deal.pipeline_id],
      );

      if (!wonStage || wonStage.id === deal.stage_id) {
        return;
      }

      const changedBy = authorId || deal.owner_id || deal.created_by;
      await this.moveStage(tenantId, dealId, wonStage.id, changedBy);
    } catch (err) {
      console.error("[deals.service] Failed to sync deal completion from repairs:", { err, dealId });
    }
  }

  /**
   * Позиция для вставки карточки на место `targetIndex` в колонке.
   *
   * Считается как среднее между соседями (дробный DOUBLE PRECISION), а не
   * пересчётом всех строк: перенумерация колонки означала бы UPDATE на каждую
   * карточку при каждом перетаскивании и конфликты при одновременной работе
   * двух менеджеров.
   */
  private async positionForIndex(
    tx: import("../../../db/client.js").TransactionClient,
    tenantId: string,
    stageId: string,
    excludeDealId: string,
    targetIndex?: number,
  ): Promise<number> {
    const rows = await tx.query<{ position: number }>(
      `SELECT position FROM deals
       WHERE tenant_id = $1 AND stage_id = $2 AND deleted_at IS NULL AND id <> $3
       ORDER BY position ASC`,
      [tenantId, stageId, excludeDealId],
    );

    if (rows.length === 0) return 0;

    const index = targetIndex ?? 0;
    const before = index > 0 ? rows[index - 1]?.position : undefined;
    const after = rows[index]?.position;

    if (before === undefined && after !== undefined) return after - 1;
    if (before !== undefined && after === undefined) return before + 1;
    if (before !== undefined && after !== undefined) return (before + after) / 2;

    return 0;
  }

  /** Soft delete — the row stays for audit and is filtered from every read. */
  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `UPDATE deals SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, id],
    );

    if (row !== null) {
      await query(
        `DELETE FROM deal_messages WHERE tenant_id = $1 AND deal_id = $2`,
        [tenantId, id],
      );
      await query(
        `DELETE FROM purchase_requests
         WHERE tenant_id = $1
           AND deal_id = $2
           AND status = 'pending'
           AND supplier_order_id IS NULL`,
        [tenantId, id],
      );
      return true;
    }

    return false;
  }

  async bulkDelete(tenantId: string, payload: BulkActionPayload): Promise<{ count: number }> {
    if (payload.mode === "ids") {
      const ids = payload.ids ?? [];
      if (ids.length === 0) return { count: 0 };
      const rows = await query<{ id: string }>(
        `UPDATE deals
         SET deleted_at = now()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
         RETURNING id`,
        [tenantId, ids],
      );
      if (rows.length > 0) {
        const deletedIds = rows.map((r) => r.id);
        await query(
          `DELETE FROM deal_messages WHERE tenant_id = $1 AND deal_id = ANY($2::uuid[])`,
          [tenantId, deletedIds],
        );
      }
      return { count: rows.length };
    }

    const filters = payload.filters ?? {};
    const validStatus =
      typeof filters.status === "string" && ["active", "won", "lost", "all"].includes(filters.status)
        ? (filters.status as "active" | "won" | "lost" | "all")
        : undefined;
    const validPreset =
      typeof filters.preset === "string" && ["all", "active", "high_value", "won"].includes(filters.preset)
        ? (filters.preset as DealPresetFilter)
        : undefined;

    const { where, params } = this.buildDealsWhereClause(tenantId, {
      pipelineId: typeof filters.pipeline_id === "string" ? filters.pipeline_id : undefined,
      stageId: typeof filters.stage_id === "string" ? filters.stage_id : undefined,
      status: validStatus,
      preset: validPreset,
      search: typeof filters.search === "string" ? filters.search : undefined,
      excludedIds: payload.excluded_ids,
    });

    const rows = await query<{ id: string }>(
      `UPDATE deals d
       SET deleted_at = now()
       FROM stages st
       WHERE d.stage_id = st.id AND ${where}
       RETURNING d.id`,
      params,
    );

    if (rows.length > 0) {
      const deletedIds = rows.map((r) => r.id);
      await query(
        `DELETE FROM deal_messages WHERE tenant_id = $1 AND deal_id = ANY($2::uuid[])`,
        [tenantId, deletedIds],
      );
    }

    return { count: rows.length };
  }

  async bulkMove(
    tenantId: string,
    payload: BulkActionPayload & { stage_id: string },
  ): Promise<{ count: number }> {
    if (payload.mode === "ids") {
      const ids = payload.ids ?? [];
      if (ids.length === 0) return { count: 0 };
      const rows = await query<{ id: string }>(
        `UPDATE deals
         SET stage_id = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
         RETURNING id`,
        [tenantId, ids, payload.stage_id],
      );
      return { count: rows.length };
    }

    const filters = payload.filters ?? {};
    const validStatus =
      typeof filters.status === "string" && ["active", "won", "lost", "all"].includes(filters.status)
        ? (filters.status as "active" | "won" | "lost" | "all")
        : undefined;
    const validPreset =
      typeof filters.preset === "string" && ["all", "active", "high_value", "won"].includes(filters.preset)
        ? (filters.preset as DealPresetFilter)
        : undefined;

    const { where, params } = this.buildDealsWhereClause(tenantId, {
      pipelineId: typeof filters.pipeline_id === "string" ? filters.pipeline_id : undefined,
      stageId: typeof filters.stage_id === "string" ? filters.stage_id : undefined,
      status: validStatus,
      preset: validPreset,
      search: typeof filters.search === "string" ? filters.search : undefined,
      excludedIds: payload.excluded_ids,
    });

    params.push(payload.stage_id);
    const stageParamIdx = params.length;

    const rows = await query<{ id: string }>(
      `UPDATE deals d
       SET stage_id = $${stageParamIdx}, updated_at = now()
       FROM stages st
       WHERE d.stage_id = st.id AND ${where}
       RETURNING d.id`,
      params,
    );

    return { count: rows.length };
  }

  // -------------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------------

  async listMessages(
    tenantId: string,
    dealId: string,
    options?: { limit?: number },
  ): Promise<DealMessageDTO[]> {
    const limit = Math.min(Math.max(options?.limit ?? 500, 1), 2000);
    // Берём последние `limit` сообщений по времени и возвращаем в хронологическом порядке (ASC),
    // чтобы длинные чаты на тысячи сообщений не создавали OOM и не тормозили карточку сделки.
    const rows = await query<DealMessageRow>(
      `SELECT *
       FROM (
         SELECT ${MESSAGE_COLUMNS}
         FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = $2
         ORDER BY created_at DESC
         LIMIT $3
       ) AS recent_messages
       ORDER BY created_at ASC`,
      [tenantId, dealId, limit],
    );

    return rows.map(toDealMessageDTO);
  }

  /**
   * Записывает строку в таймлайн.
   *
   * Отправкой в канал не занимается — это делает `DealMessagingService`, чтобы
   * запись и доставка оставались раздельными шагами: строка обязана появиться в
   * таймлайне даже при недоступном транспорте, иначе менеджер потеряет текст
   * ответа вместе с ошибкой сети.
   */
  async createMessage(
    tenantId: string,
    dealId: string,
    senderName: string,
    payload: CreateDealMessagePayload,
    deliveryStatus: DeliveryStatus = "neutral",
  ): Promise<DealMessageDTO> {
    const dto = await withTenant(tenantId, async (tx) => {
      const deal = await tx.queryOne<{ id: string }>(
        `SELECT id FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, dealId],
      );

      if (deal === null) {
        throw new NotFoundError("Deal not found");
      }

      const row = await tx.queryOneOrThrow<DealMessageRow>(
        `INSERT INTO deal_messages
           (tenant_id, deal_id, channel_account_id, source, direction, sender_name, content, channel,
            attachment, attachment_type, delivery_status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${MESSAGE_COLUMNS}`,
        [
          tenantId,
          dealId,
          nullIfBlank(payload.channel_account_id),
          payload.source,
          payload.direction,
          senderName,
          payload.content,
          payload.channel,
          nullIfBlank(payload.attachment),
          nullIfBlank(payload.attachment_type),
          deliveryStatus,
          payload.metadata ? JSON.stringify(payload.metadata) : "{}",
        ],
      );

      return toDealMessageDTO(row);
    });

    if (payload.direction === "inbound" && payload.content && dto.id) {
      messageTranslationService.autoTranslateIfForeign({
        tenantId,
        messageId: dto.id,
        content: payload.content,
      });
    }

    return dto;
  }

  /**
   * Отмечает результат доставки уже записанного сообщения.
   *
   * Отдельным запросом, а не полем при вставке: отправка идёт после коммита
   * строки, и держать транзакцию открытой на время сетевого вызова к Telegram
   * означало бы удерживать соединение пула секундами.
   */
  async markMessageDelivery(
    tenantId: string,
    messageId: string,
    status: DeliveryStatus,
    error: string | null = null,
  ): Promise<DealMessageDTO | null> {
    return withTenant(tenantId, async (tx) => {
      let extraSet = "";
      if (status === "delivered") {
        extraSet = ", delivered_at = COALESCE(delivered_at, now())";
      } else if (status === "read") {
        extraSet = ", read_at = COALESCE(read_at, now()), delivered_at = COALESCE(delivered_at, now())";
      }

      const row = await tx.queryOne<DealMessageRow>(
        `UPDATE deal_messages
         SET delivery_status = $3, delivery_error = $4${extraSet}
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${MESSAGE_COLUMNS}`,
        [tenantId, messageId, status, error],
      );

      return row === null ? null : toDealMessageDTO(row);
    });
  }

  /**
   * Отметка прочтения сообщений (Receipts state machine)
   */
  async markMessagesRead(
    tenantId: string,
    options: { dealId?: string; contactId?: string; messageIds?: string[] },
  ): Promise<{ updatedCount: number; messageIds: string[] }> {
    return withTenant(tenantId, async (tx) => {
      let rows: Array<{ id: string; deal_id: string }> = [];

      if (options.messageIds && options.messageIds.length > 0) {
        rows = await tx.query<{ id: string; deal_id: string }>(
          `UPDATE deal_messages
           SET delivery_status = 'read',
               read_at = COALESCE(read_at, now()),
               delivered_at = COALESCE(delivered_at, now())
           WHERE tenant_id = $1 AND id = ANY($2::uuid[])
             AND delivery_status != 'read'
           RETURNING id, deal_id`,
          [tenantId, options.messageIds],
        );
      } else if (options.dealId) {
        rows = await tx.query<{ id: string; deal_id: string }>(
          `UPDATE deal_messages
           SET delivery_status = 'read',
               read_at = COALESCE(read_at, now()),
               delivered_at = COALESCE(delivered_at, now())
           WHERE tenant_id = $1 AND deal_id = $2
             AND delivery_status != 'read'
           RETURNING id, deal_id`,
          [tenantId, options.dealId],
        );
      } else if (options.contactId) {
        rows = await tx.query<{ id: string; deal_id: string }>(
          `UPDATE deal_messages m
           SET delivery_status = 'read',
               read_at = COALESCE(read_at, now()),
               delivered_at = COALESCE(delivered_at, now())
           FROM deals d
           WHERE m.tenant_id = $1 AND d.id = m.deal_id AND d.contact_id = $2
             AND m.delivery_status != 'read'
           RETURNING m.id, m.deal_id`,
          [tenantId, options.contactId],
        );
      }

      const updatedIds = rows.map((r) => r.id);
      const dealId = rows[0]?.deal_id ?? options.dealId ?? "";

      if (updatedIds.length > 0) {
        chatEventBus.emitChatEvent({
          type: "delivery_updated",
          tenantId,
          dealId,
          data: {
            messageIds: updatedIds,
            status: "read",
            readAt: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        });
      }

      return { updatedCount: updatedIds.length, messageIds: updatedIds };
    });
  }

  // -------------------------------------------------------------------------
  // Stages (визуальный редактор воронки)
  // -------------------------------------------------------------------------

  /**
   * Новая стадия в конце воронки.
   *
   * Воронка проверяется на принадлежность арендатору до INSERT: иначе UUID
   * чужой воронки дал бы ошибку внешнего ключа вместо честного 404.
   */
  async createStage(
    tenantId: string,
    pipelineId: string,
    payload: CreateStagePayload,
  ): Promise<KanbanColumn> {
    return withTenant(tenantId, async (tx) => {
      const pipeline = await tx.queryOne<{ id: string }>(
        `SELECT id FROM pipelines WHERE tenant_id = $1 AND id = $2`,
        [tenantId, pipelineId],
      );

      if (pipeline === null) {
        throw new NotFoundError("Pipeline not found");
      }

      // Новый этап встаёт ПЕРЕД закрывающими, а не в самый конец: «успех» и
      // «провал» обязаны оставаться предпоследним и последним. Иначе созданный
      // этап оказывался после «Закрыто и не реализовано», и порядок воронки
      // терял смысл.
      const lastOpen = await tx.queryOne<{ sort_order: number }>(
        `SELECT sort_order FROM stages
         WHERE pipeline_id = $1 AND is_won = false AND is_lost = false
         ORDER BY sort_order DESC LIMIT 1`,
        [pipelineId],
      );
      const insertOrder = (lastOpen?.sort_order ?? -1) + 1;

      // Закрывающие сдвигаются вправо, чтобы освободить номер.
      await tx.query(
        `UPDATE stages SET sort_order = sort_order + 1
         WHERE pipeline_id = $1 AND sort_order >= $2 AND (is_won = true OR is_lost = true)`,
        [pipelineId, insertOrder],
      );

      const row = await tx.queryOneOrThrow<StageRow>(
        `INSERT INTO stages (pipeline_id, name, sort_order, color)
         VALUES ($1, $2, $3, $4)
         RETURNING id, pipeline_id, name, sort_order, is_won, is_lost, is_system, color`,
        [pipelineId, payload.name, insertOrder, payload.color],
      );

      return {
        stageId: row.id,
        stageName: row.name,
        sortOrder: row.sort_order,
        isWon: row.is_won,
        isLost: row.is_lost,
        isSystem: row.is_system,
        stageColor: row.color,
        dealCount: 0,
        budgetTotal: 0,
        deals: [],
      };
    });
  }

  /**
   * Переименование, смена цвета и перестановка стадии.
   *
   * Перестановка (`sort_order`) — присвоение нового номера без пересчёта
   * соседей: фронтенд отправляет целевые номера для обеих переставляемых
   * стадий двумя запросами, а полный реордер одной транзакцией не нужен для
   * обмена двух колонок.
   */
  async updateStage(
    tenantId: string,
    pipelineId: string,
    stageId: string,
    payload: UpdateStagePayload,
  ): Promise<KanbanColumn | null> {
    return withTenant(tenantId, async (tx) => {
      // Системный этап не правится: на входе стоит попадание сделки в воронку,
      // на терминальных — семантика закрытия и агрегаты. Проверка на сервере, а
      // не только в UI: кнопок в интерфейсе нет, но запрос отправить можно.
      const existing = await tx.queryOne<{ is_system: boolean }>(
        `SELECT s.is_system
         FROM stages s
         JOIN pipelines p ON p.id = s.pipeline_id
         WHERE s.id = $1 AND s.pipeline_id = $2 AND p.tenant_id = $3`,
        [stageId, pipelineId, tenantId],
      );

      if (existing === null) return null;

      if (existing.is_system) {
        throw new ValidationError("Cannot modify a system stage", {
          stage_id: ["Системный этап нельзя переименовать, перекрасить или переместить"],
        });
      }

      const assignments: string[] = [];
      const params: SqlParam[] = [tenantId, pipelineId, stageId];

      const push = (column: string, value: SqlParam): void => {
        params.push(value);
        assignments.push(`${column} = $${params.length}`);
      };

      if (payload.name !== undefined) push("name", payload.name);
      if (payload.color !== undefined) push("color", payload.color);
      if (payload.sort_order !== undefined) push("sort_order", payload.sort_order);

      if (assignments.length === 0) return this.kanbanStage(tx, tenantId, pipelineId, stageId);

      const row = await tx.queryOne<StageRow>(
        `UPDATE stages s SET ${assignments.join(", ")}
         FROM pipelines p
         WHERE s.id = $3 AND s.pipeline_id = $2 AND p.tenant_id = $1
         RETURNING s.id, s.pipeline_id, s.name, s.sort_order, s.is_won, s.is_lost, s.is_system, s.color`,
        params,
      );

      if (row === null) return null;
      return this.kanbanStage(tx, tenantId, pipelineId, row.id);
    });
  }

  /**
   * Удаление пустой пользовательской стадии.
   *
   * Стадии «успех» и «провал» удалить нельзя: на них держится семантика
   * закрытия сделок и агрегаты воронки. Непустая стадия удаляется только после
   * переноса или удаления сделок — молча раскидывать сделки по соседям опасно:
   * часть воронки исчезла бы незаметно для менеджера.
   */
  async deleteStage(tenantId: string, pipelineId: string, stageId: string): Promise<boolean> {
    return withTenant(tenantId, async (tx) => {
      const stage = await tx.queryOne<{ is_won: boolean; is_lost: boolean; is_system: boolean }>(
        `SELECT s.is_won, s.is_lost, s.is_system
         FROM stages s
         JOIN pipelines p ON p.id = s.pipeline_id
         WHERE s.id = $1 AND s.pipeline_id = $2 AND p.tenant_id = $3`,
        [stageId, pipelineId, tenantId],
      );

      if (stage === null) return false;

      // Помимо терминальных защищён и вход в воронку: без первого этапа новой
      // сделке некуда попасть.
      if (stage.is_system) {
        throw new ValidationError("Cannot delete a system stage", {
          stage_id: ["Системный этап удалить нельзя"],
        });
      }

      const occupied = await tx.queryOne<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM deals
         WHERE tenant_id = $1 AND stage_id = $2 AND deleted_at IS NULL`,
        [tenantId, stageId],
      );

      if (Number(occupied?.total ?? 0) > 0) {
        throw new ValidationError("Stage is not empty", {
          stage_id: ["Сначала перенесите или удалите сделки этой стадии"],
        });
      }

      const deleted = await tx.queryOne<{ id: string }>(
        `DELETE FROM stages s
         USING pipelines p
         WHERE s.pipeline_id = p.id AND s.id = $1 AND s.pipeline_id = $2 AND p.tenant_id = $3
         RETURNING s.id`,
        [stageId, pipelineId, tenantId],
      );

      return deleted !== null;
    });
  }

  /** Проекция одной стадии в форме колонки канбана (для ответов PATCH). */
  private async kanbanStage(
    tx: import("../../../db/client.js").TransactionClient,
    tenantId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<KanbanColumn> {
    const stage = await tx.queryOneOrThrow<StageRow>(
      `SELECT s.id, s.pipeline_id, s.name, s.sort_order, s.is_won, s.is_lost, s.is_system, s.color
       FROM stages s
       JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.id = $1 AND s.pipeline_id = $2 AND p.tenant_id = $3`,
      [stageId, pipelineId, tenantId],
    );

    const rows = await tx.query<DealRow>(
      `SELECT ${DEAL_COLUMNS_WITH_LABELS}
       FROM deals d
       ${DEAL_LABEL_JOINS}
       WHERE d.tenant_id = $1 AND d.stage_id = $2 AND d.deleted_at IS NULL
         AND (d.status IS NULL OR d.status != 'duplicate')
       ORDER BY d.position ASC, d.created_at DESC`,
      [tenantId, stageId],
    );

    const deals = rows.map(toDealDTO);
    return {
      stageId: stage.id,
      stageName: stage.name,
      sortOrder: stage.sort_order,
      isWon: stage.is_won,
      isLost: stage.is_lost,
      isSystem: stage.is_system,
      stageColor: stage.color,
      dealCount: deals.length,
      budgetTotal: deals.reduce((sum, deal) => sum + deal.budget, 0),
      deals,
    };
  }

  /**
   * Помечает контакт по сделке как личный контакт:
   * 1. Устанавливает contacts.is_personal = true и contacts.suppress_deal_creation = true.
   * 2. Переводит сделку в этап с is_lost = true (Отказ / Закрыто и не реализовано).
   * 3. Устанавливает closed_at = now() и ai_paused_until = '2099-01-01'.
   * 4. Добавляет системное сообщение в deal_messages.
   */
  async markPersonal(
    tenantId: string,
    dealId: string,
    changedBy: string,
  ): Promise<{ dealId: string; contactId: string | null; stageId: string }> {
    return withTenant(tenantId, async (tx) => {
      const deal = await tx.queryOne<{
        id: string;
        stage_id: string;
        pipeline_id: string;
        contact_id: string | null;
      }>(
        `SELECT id, stage_id, pipeline_id, contact_id
         FROM deals
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [tenantId, dealId],
      );

      if (deal === null) {
        throw new NotFoundError("Deal not found");
      }

      let lostStage = await tx.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM stages
         WHERE pipeline_id = $1 AND is_lost = true
         ORDER BY sort_order DESC
         LIMIT 1`,
        [deal.pipeline_id],
      );

      if (!lostStage) {
        lostStage = await tx.queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM stages
           WHERE pipeline_id = $1
           ORDER BY sort_order DESC
           LIMIT 1`,
          [deal.pipeline_id],
        );
      }

      if (!lostStage) {
        throw new ValidationError("No stages found for pipeline", {});
      }

      if (deal.contact_id) {
        await tx.query(
          `UPDATE contacts
           SET is_personal = true,
               suppress_deal_creation = true,
               updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, deal.contact_id],
        );
      }

      await tx.query(
        `UPDATE deals
         SET stage_id = $1,
             closed_at = COALESCE(closed_at, now()),
             ai_paused_until = '9999-12-31 23:59:59+00'::timestamptz,
             updated_at = now()
         WHERE tenant_id = $2 AND id = $3`,
        [lostStage.id, tenantId, deal.id],
      );

      if (deal.stage_id !== lostStage.id) {
        await tx.query(
          `INSERT INTO deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id, changed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, deal.id, deal.stage_id, lostStage.id, changedBy],
        );
      }

      // Системное уведомление в переписке сделки
      await tx.query(
        `INSERT INTO deal_messages
           (tenant_id, deal_id, source, direction, sender_name, content, channel, delivery_status)
         VALUES ($1, $2, 'system', 'neutral', 'Система', $3, 'system', 'neutral')`,
        [
          tenantId,
          deal.id,
          `Контакт помечен как личный. Сделка переведена в «${lostStage.name}», новые сделки не создаются, а сообщения больше не читаются и не сохраняются в CRM.`,
        ],
      );

      return {
        dealId: deal.id,
        contactId: deal.contact_id,
        stageId: lostStage.id,
      };
    });
  }

  /**
   * Снимает пометку личного контакта (возврат в рабочие).
   */
  async unmarkPersonal(
    tenantId: string,
    dealId: string,
    _changedBy: string,
  ): Promise<{ dealId: string; contactId: string | null }> {
    return withTenant(tenantId, async (tx) => {
      const deal = await tx.queryOne<{ id: string; contact_id: string | null }>(
        `SELECT id, contact_id FROM deals
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [tenantId, dealId],
      );

      if (deal === null) throw new NotFoundError("Deal not found");

      if (deal.contact_id) {
        await tx.query(
          `UPDATE contacts
           SET is_personal = false,
               suppress_deal_creation = false,
               updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, deal.contact_id],
        );
      }

      await tx.query(
        `UPDATE deals
         SET ai_paused_until = NULL,
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, deal.id],
      );

      await tx.query(
        `INSERT INTO deal_messages
           (tenant_id, deal_id, source, direction, sender_name, content, channel, delivery_status)
         VALUES ($1, $2, 'system', 'neutral', 'Система', 'Контакт возвращён в категорию рабочих.', 'system', 'neutral')`,
        [tenantId, deal.id],
      );

      return { dealId: deal.id, contactId: deal.contact_id };
    });
  }

  /**
   * Сквозная история контакта для карточки сделки (1 контакт : N сделок).
   *
   * Возвращает профиль контакта, агрегированные LTV-метрики, список других
   * сделок этого контакта и объединённый таймлайн активности.
   */
  async getContactHistory(tenantId: string, dealId: string): Promise<DealContactHistoryDTO> {
    const deal = await queryOne<{
      id: string;
      contact_id: string | null;
      budget: string;
      currency: string;
      is_won: boolean;
      is_lost: boolean;
    }>(
      `SELECT d.id, d.contact_id, d.budget::text, d.currency, s.is_won, s.is_lost
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, dealId],
    );

    if (!deal) {
      throw new NotFoundError("Сделка не найдена");
    }

    if (!deal.contact_id) {
      const contactCandidate = await queryOne<{ id: string }>(
        `SELECT c.id FROM contacts c
         JOIN deal_messages m ON m.deal_id = $2 AND m.tenant_id = $1
         WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
           AND (
             (c.phone IS NOT NULL AND c.phone != '' AND (m.sender_name ILIKE '%' || c.phone || '%' OR m.content ILIKE '%' || c.phone || '%'))
             OR (m.channel_account_id IS NOT NULL AND c.custom_fields->>'chat_id' = m.sender_name)
           )
         LIMIT 1`,
        [tenantId, dealId],
      );
      if (contactCandidate) {
        deal.contact_id = contactCandidate.id;
        await withTenant(tenantId, async (tx) => {
          await tx.query(`UPDATE deals SET contact_id = $1 WHERE id = $2 AND tenant_id = $3`, [contactCandidate.id, dealId, tenantId]);
        }).catch(() => {});
      }
    }

    if (!deal.contact_id) {
      const b = Number(deal.budget || 0);
      return {
        dealId,
        contact: null,
        metrics: {
          totalDeals: 1,
          wonDeals: deal.is_won ? 1 : 0,
          lostDeals: deal.is_lost ? 1 : 0,
          activeDeals: (!deal.is_won && !deal.is_lost) ? 1 : 0,
          totalLtv: deal.is_won ? b : 0,
          avgCheck: b,
          isRepeatClient: false,
        },
        otherDeals: [],
        timeline: [],
      };
    }

    // 1. Профиль контакта
    interface ContactRow {
      id: string;
      first_name: string;
      last_name: string;
      email: string | null;
      phone: string | null;
      company_id: string | null;
      company_name: string | null;
      custom_fields: Record<string, unknown> | null;
      created_at: Date | string;
    }

    const contactRow = await queryOne<ContactRow>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.company_id,
              co.name AS company_name, c.custom_fields, c.created_at
       FROM contacts c
       LEFT JOIN companies co ON co.id = c.company_id AND co.tenant_id = c.tenant_id
       WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [tenantId, deal.contact_id],
    );

    const contactSummary: DealContactSummaryDTO | null = contactRow
      ? {
          id: contactRow.id,
          firstName: contactRow.first_name,
          lastName: contactRow.last_name,
          email: contactRow.email,
          phone: contactRow.phone,
          companyId: contactRow.company_id,
          companyName: contactRow.company_name,
          customFields: (contactRow.custom_fields as Record<string, unknown>) || {},
          createdAt:
            contactRow.created_at instanceof Date
              ? contactRow.created_at.toISOString()
              : String(contactRow.created_at),
        }
      : null;

    // 2. Все сделки контакта
    interface DealRowItem {
      id: string;
      title: string;
      budget: string;
      currency: string;
      stage_id: string;
      stage_name: string;
      stage_color: string;
      is_won: boolean;
      is_lost: boolean;
      created_at: Date | string;
      closed_at: Date | string | null;
    }

    const contactDeals = await query<DealRowItem>(
      `SELECT d.id, d.title, d.budget::text, d.currency, d.stage_id,
              s.name AS stage_name, COALESCE(s.color, 'slate') AS stage_color, s.is_won, s.is_lost,
              d.created_at, d.closed_at
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1 AND d.contact_id = $2 AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC`,
      [tenantId, deal.contact_id],
    );

    const totalDeals = contactDeals.length;
    let wonDeals = 0;
    let lostDeals = 0;
    let totalLtv = 0;
    let totalBudget = 0;

    for (const d of contactDeals) {
      const b = Number(d.budget || 0);
      totalBudget += b;
      if (d.is_won) {
        wonDeals++;
        totalLtv += b;
      } else if (d.is_lost) {
        lostDeals++;
      }
    }

    const activeDeals = Math.max(0, totalDeals - (wonDeals + lostDeals));
    const avgCheck =
      wonDeals > 0
        ? Math.round(totalLtv / wonDeals)
        : totalDeals > 0
          ? Math.round(totalBudget / totalDeals)
          : 0;

    const otherDeals: DealOtherDealItemDTO[] = contactDeals
      .filter((d) => d.id !== dealId)
      .map((d) => {
        const colorParsed = stageColorSchema.safeParse(d.stage_color);
        const stageColor: StageColor = colorParsed.success ? colorParsed.data : "slate";

        return {
          id: d.id,
          title: d.title,
          budget: Number(d.budget || 0),
          currency: d.currency,
          stageId: d.stage_id,
          stageName: d.stage_name,
          stageColor,
          isWon: d.is_won,
          isLost: d.is_lost,
          createdAt:
            d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at),
          closedAt: d.closed_at
            ? d.closed_at instanceof Date
              ? d.closed_at.toISOString()
              : String(d.closed_at)
            : null,
        };
      });

    // 3. Сквозной таймлайн активности контакта
    const activityService = new ContactActivityService();
    const activitiesResponse = await activityService.listContactActivities(
      tenantId,
      deal.contact_id,
      {
        limit: 50,
        offset: 0,
      },
    );

    const timeline: DealContactTimelineItemDTO[] = activitiesResponse.items.map((ev) => ({
      id: ev.id,
      type: ev.activityKind,
      dealId: ev.dealId,
      dealTitle: ev.dealTitle,
      timestamp: ev.timestamp,
      title: ev.title,
      description: ev.description,
      authorName: ev.authorName,
      activityChannel: ev.activityChannel,
      activityKind: ev.activityKind,
      direction: ev.direction,
      payload: ev.payload,
      metadata: ev.payload,
    }));

    return {
      dealId,
      contact: contactSummary,
      metrics: {
        totalDeals,
        wonDeals,
        lostDeals,
        activeDeals,
        totalLtv,
        avgCheck,
        isRepeatClient: totalDeals > 1,
      },
      otherDeals,
      timeline,
    };
  }

  // ---------------------------------------------------------------------------
  // Deal Items (Услуги и Товары в сделке)
  // ---------------------------------------------------------------------------

  async listDealItems(
    tenantId: string,
    dealId: string,
  ): Promise<{ items: DealItemDTO[]; totalBudget: number }> {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query<DealItemRow>(
        `SELECT id, tenant_id, deal_id, item_type, item_id, name, description, sku, price,
                cost_price, cost_source, consumed_at, quantity,
                unit, discount_percent, discount_amount, total_amount, sort_order, created_at, updated_at
         FROM deal_items
         WHERE tenant_id = $1 AND deal_id = $2
         ORDER BY sort_order ASC, created_at ASC`,
        [tenantId, dealId],
      );

      // Подтягиваем партионные аллокации FIFO по позициям сделки
      const allocRows = await tx.query<{
        deal_item_id: string;
        batch_id: string | null;
        batch_number: string | null;
        supplier_name: string | null;
        quantity: string | number;
        unit_cost: string | number;
        total_cost: string | number;
      }>(
        `SELECT a.deal_item_id, a.batch_id, b.batch_number, b.supplier_name,
                a.quantity, a.unit_cost, a.total_cost
         FROM deal_item_batch_allocations a
         LEFT JOIN warehouse_batches b ON b.id = a.batch_id AND b.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.deal_id = $2
         ORDER BY a.created_at ASC`,
        [tenantId, dealId],
      );

      const allocMap = new Map<string, DealItemBatchAllocationDTO[]>();
      for (const a of allocRows) {
        const list = allocMap.get(a.deal_item_id) ?? [];
        list.push({
          batchId: a.batch_id,
          batchNumber: a.batch_number ?? "",
          supplierName: a.supplier_name ?? "",
          quantity: Number(a.quantity),
          unitCost: Number(a.unit_cost),
          totalCost: Number(a.total_cost),
        });
        allocMap.set(a.deal_item_id, list);
      }

      // Подтягиваем связанные заявки на закупку по позициям сделки
      const prRows = await tx.query<{
        id: string;
        deal_item_id: string;
        status: string;
      }>(
        `SELECT id, deal_item_id, status
         FROM purchase_requests
         WHERE tenant_id = $1 AND deal_id = $2 AND deal_item_id IS NOT NULL
         ORDER BY created_at DESC`,
        [tenantId, dealId],
      );
      const prMap = new Map<string, { id: string; status: string }>();
      for (const pr of prRows) {
        if (!prMap.has(pr.deal_item_id)) {
          prMap.set(pr.deal_item_id, { id: pr.id, status: pr.status });
        }
      }

      const items = rows.map((r) =>
        toDealItemDTO(r, allocMap.get(r.id), prMap.get(r.id) ?? null),
      );

      // Also fetch works from linked repair orders
      const repairWorks = await tx.query<{
        id: string;
        order_id: string;
        ticket_number: string;
        description: string;
        quantity: string | number;
        unit_price: string | number;
        cost: string | number;
        created_at: Date;
      }>(
        `SELECT rw.id, ro.id AS order_id, ro.ticket_number, rw.description, rw.quantity, rw.unit_price, rw.cost, rw.created_at
         FROM repair_works rw
         JOIN repair_orders ro ON ro.id = rw.repair_order_id AND ro.tenant_id = rw.tenant_id
         WHERE ro.tenant_id = $1 AND ro.deal_id = $2 AND ro.deleted_at IS NULL
         ORDER BY rw.created_at ASC`,
        [tenantId, dealId],
      );

      const workItems: DealItemDTO[] = repairWorks.map((rw) => {
        const qty = Number(rw.quantity ?? 1);
        const cost = Number(rw.cost ?? 0);
        const unitPrice = Number(rw.unit_price ?? 0) || (qty > 0 ? cost / qty : cost);
        return {
          id: `repair-work-${rw.id}`,
          dealId,
          itemType: "service",
          itemId: rw.id,
          name: rw.description,
          description: `Работа по наряду ${rw.ticket_number}`,
          sku: "",
          price: unitPrice,
          costPrice: 0,
          quantity: qty,
          unit: "усл",
          discountPercent: 0,
          discountAmount: 0,
          totalAmount: cost,
          sortOrder: 100,
          createdAt: rw.created_at instanceof Date ? rw.created_at.toISOString() : String(rw.created_at),
        };
      });

      // Also fetch parts from linked repair orders
      const repairParts = await tx.query<{
        id: string;
        order_id: string;
        ticket_number: string;
        name: string;
        article: string;
        quantity: string | number;
        retail_price: string | number;
        cost_price: string | number;
        created_at: Date;
      }>(
        `SELECT rp.id, ro.id AS order_id, ro.ticket_number, rp.name, rp.article, rp.quantity, rp.retail_price, rp.cost_price, rp.created_at
         FROM repair_parts rp
         JOIN repair_orders ro ON ro.id = rp.repair_order_id AND ro.tenant_id = rp.tenant_id
         WHERE ro.tenant_id = $1 AND ro.deal_id = $2 AND ro.deleted_at IS NULL
         ORDER BY rp.created_at ASC`,
        [tenantId, dealId],
      );

      const partItems: DealItemDTO[] = repairParts.map((rp) => {
        const qty = Number(rp.quantity ?? 1);
        const retail = Number(rp.retail_price ?? 0);
        const total = retail * qty;
        return {
          id: `repair-part-${rp.id}`,
          dealId,
          itemType: "product",
          itemId: rp.id,
          name: rp.name,
          description: `Запчасть по наряду ${rp.ticket_number}`,
          sku: rp.article ?? "",
          price: retail,
          costPrice: Number(rp.cost_price ?? 0),
          quantity: qty,
          unit: "шт",
          discountPercent: 0,
          discountAmount: 0,
          totalAmount: total,
          sortOrder: 200,
          createdAt: rp.created_at instanceof Date ? rp.created_at.toISOString() : String(rp.created_at),
        };
      });

      const allItems = [...items, ...workItems, ...partItems];
      const totalBudget = allItems.reduce((acc, curr) => acc + curr.totalAmount, 0);
      return { items: allItems, totalBudget };
    });
  }

  private async recalculateDealBudgetInTx(
    tx: TransactionClient,
    tenantId: string,
    dealId: string,
  ): Promise<number> {
    const budgetRow = await tx.queryOne<{ total: string }>(
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
       SELECT (
         COALESCE((SELECT SUM(total_amount) FROM deal_items WHERE tenant_id = $1 AND deal_id = $2), 0) +
         COALESCE((
           SELECT SUM(
             CASE
               WHEN final_cost IS NOT NULL AND final_cost > 0 THEN final_cost
               WHEN calc_total > 0 THEN calc_total
               ELSE COALESCE(estimated_cost, 0)
             END
           )
           FROM order_totals
         ), 0)
       )::text AS total`,
      [tenantId, dealId],
    );
    const totalBudget = Number(budgetRow?.total ?? 0);

    await tx.query(
      `UPDATE deals SET budget = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, dealId, totalBudget],
    );

    return totalBudget;
  }

  async addDealItem(
    tenantId: string,
    dealId: string,
    payload: CreateDealItemPayload,
    userId?: string | null,
  ): Promise<{ item: DealItemDTO; totalBudget: number }> {
    return withTenant(tenantId, async (tx) => {
      const deal = await tx.queryOne<{ id: string; title: string }>(
        `SELECT id, title FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, dealId],
      );
      if (!deal) throw new NotFoundError("Сделка не найдена");

      const trimmedName = payload.name.trim();
      const trimmedSku = payload.sku?.trim() ?? "";
      const trimmedUnit = payload.unit?.trim() || (payload.item_type === "product" ? "шт" : "усл");
      const trimmedDescription = payload.description?.trim() ?? "";

      const price = Number(payload.price ?? 0);
      const quantity = Number(payload.quantity ?? 1);
      const discountPercent = Number(payload.discount_percent ?? 0);
      const discountAmount = Number(payload.discount_amount ?? 0);
      const totalAmount = calculateItemTotal(price, quantity, discountPercent, discountAmount);

      let resolvedItemId: string | null = payload.item_id ?? null;
      let costPrice = payload.cost_price !== undefined ? Number(payload.cost_price) : 0;
      let costSource: DealItemCostSource = "manual";

      if (payload.item_type === "product") {
        // Автопривязка к номенклатуре склада по артикулу или точному наименованию (как в СЦ)
        if (!resolvedItemId && trimmedSku && trimmedSku.toUpperCase() !== "Б/А") {
          const existingBySku = await tx.queryOne<{ id: string }>(
            `SELECT id FROM warehouse_items
             WHERE tenant_id = $1 AND lower(btrim(sku)) = lower(btrim($2)) AND deleted_at IS NULL
             ORDER BY updated_at DESC
             LIMIT 1`,
            [tenantId, trimmedSku],
          );
          if (existingBySku) {
            resolvedItemId = existingBySku.id;
          }
        }

        if (!resolvedItemId && trimmedName) {
          const existingByName = await tx.queryOne<{ id: string }>(
            `SELECT id FROM warehouse_items
             WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) AND deleted_at IS NULL
             ORDER BY updated_at DESC
             LIMIT 1`,
            [tenantId, trimmedName],
          );
          if (existingByName) {
            resolvedItemId = existingByName.id;
          }
        }

        if (payload.save_to_catalog && !resolvedItemId && trimmedName) {
          const newWarehouseRow = await tx.queryOne<{ id: string }>(
            `INSERT INTO warehouse_items
               (tenant_id, sku, name, unit, retail_price, cost_price)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
              tenantId,
              trimmedSku.toUpperCase() === "Б/А" ? "" : trimmedSku,
              trimmedName,
              trimmedUnit,
              price,
              costPrice,
            ],
          );
          if (newWarehouseRow) {
            resolvedItemId = newWarehouseRow.id;
          }
        }

        if (resolvedItemId) {
          const fifoEst = await warehouseService.estimateFifoUnitCost(tx, tenantId, resolvedItemId, quantity);
          if (payload.cost_price === undefined) {
            costPrice = fifoEst.unitCost;
          }
          costSource = fifoEst.hasBatches ? "estimated_fifo" : "manual";
        }
      } else if (payload.item_type === "service" && payload.save_to_catalog && !resolvedItemId && trimmedName) {
        const savedService = await tx.queryOne<{ id: string }>(
          `INSERT INTO repair_services_catalog (tenant_id, name, description, default_price, unit, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (tenant_id, name)
           DO UPDATE SET default_price = EXCLUDED.default_price,
                         description = EXCLUDED.description,
                         unit = EXCLUDED.unit,
                         updated_at = now()
           RETURNING id`,
          [tenantId, trimmedName, trimmedDescription, price, trimmedUnit],
        );
        if (savedService) {
          resolvedItemId = savedService.id;
        }
      }

      const row = await tx.queryOneOrThrow<DealItemRow>(
        `INSERT INTO deal_items
           (tenant_id, deal_id, item_type, item_id, name, description, sku, price, cost_price, cost_source, quantity,
            unit, discount_percent, discount_amount, total_amount, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
         RETURNING id, tenant_id, deal_id, item_type, item_id, name, description, sku, price,
                   cost_price, cost_source, consumed_at, quantity,
                   unit, discount_percent, discount_amount, total_amount, sort_order, created_at, updated_at`,
        [
          tenantId,
          dealId,
          payload.item_type,
          resolvedItemId,
          trimmedName,
          trimmedDescription,
          trimmedSku,
          price,
          costPrice,
          costSource,
          quantity,
          trimmedUnit,
          discountPercent,
          discountAmount,
          totalAmount,
          payload.sort_order ?? 0,
        ],
      );

      let createdPurchaseReq: { id: string; status: string } | null = null;
      if (payload.item_type === "product" && payload.add_to_purchase_request) {
        let reqQty = quantity;
        if (resolvedItemId) {
          const stockRow = await tx.queryOne<{ available: string }>(
            `SELECT (
               COALESCE((SELECT SUM(b.remaining_quantity) FROM warehouse_batches b WHERE b.tenant_id = $1 AND b.item_id = $2), 0)
               - COALESCE((SELECT SUM(r.quantity) FROM warehouse_reservations r WHERE r.tenant_id = $1 AND r.item_id = $2 AND r.status = 'reserved'), 0)
             )::numeric(10,2)::text AS available`,
            [tenantId, resolvedItemId],
          );
          const avail = Math.max(0, Number(stockRow?.available ?? 0));
          const shortage = Math.round((quantity - avail) * 100) / 100;
          if (shortage > 0) {
            reqQty = shortage;
          }
        }

        const pr = await tx.queryOneOrThrow<{ id: string; status: string }>(
          `INSERT INTO purchase_requests
             (tenant_id, deal_id, deal_item_id, item_id, item_name, sku, quantity, unit, estimated_price, status, comment, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11)
           RETURNING id, status`,
          [
            tenantId,
            dealId,
            row.id,
            resolvedItemId,
            trimmedName,
            trimmedSku,
            reqQty,
            trimmedUnit,
            costPrice,
            `Заявка из сделки «${deal.title}»`,
            userId ?? null,
          ],
        );
        createdPurchaseReq = pr;
      }

      const totalBudget = await this.recalculateDealBudgetInTx(tx, tenantId, dealId);

      return { item: toDealItemDTO(row, undefined, createdPurchaseReq), totalBudget };
    });
  }

  async updateDealItem(
    tenantId: string,
    dealId: string,
    itemId: string,
    payload: UpdateDealItemPayload,
  ): Promise<{ item: DealItemDTO; totalBudget: number }> {
    if (itemId.startsWith("repair-")) {
      throw new ValidationError("Услуги и запчасти из наряда редактируются в наряде СЦ", {});
    }
    return withTenant(tenantId, async (tx) => {
      const existing = await tx.queryOne<DealItemRow>(
        `SELECT * FROM deal_items WHERE tenant_id = $1 AND deal_id = $2 AND id = $3`,
        [tenantId, dealId, itemId],
      );
      if (!existing) throw new NotFoundError("Позиция не найдена");

      const price = payload.price !== undefined ? Number(payload.price) : Number(existing.price);
      const quantity = payload.quantity !== undefined ? Number(payload.quantity) : Number(existing.quantity);
      const discountPercent = payload.discount_percent !== undefined ? Number(payload.discount_percent) : Number(existing.discount_percent);
      const discountAmount = payload.discount_amount !== undefined ? Number(payload.discount_amount) : Number(existing.discount_amount);
      const totalAmount = calculateItemTotal(price, quantity, discountPercent, discountAmount);

      let costPrice =
        payload.cost_price !== undefined ? Number(payload.cost_price) : Number(existing.cost_price ?? 0);
      if (
        payload.cost_price === undefined &&
        payload.quantity !== undefined &&
        existing.item_type === "product" &&
        existing.item_id &&
        !existing.consumed_at
      ) {
        const fifoEst = await warehouseService.estimateFifoUnitCost(tx, tenantId, existing.item_id, quantity);
        if (fifoEst.hasBatches) {
          costPrice = fifoEst.unitCost;
        }
      }

      const name = payload.name !== undefined ? payload.name.trim() : existing.name;
      const description = payload.description !== undefined ? payload.description.trim() : (existing.description ?? "");
      const sku = payload.sku !== undefined ? payload.sku.trim() : (existing.sku ?? "");
      const unit = payload.unit !== undefined ? payload.unit.trim() : (existing.unit ?? "шт");
      const sortOrder = payload.sort_order !== undefined ? payload.sort_order : existing.sort_order;

      const row = await tx.queryOneOrThrow<DealItemRow>(
        `UPDATE deal_items
         SET name = $4, description = $5, sku = $6, price = $7, cost_price = $8, quantity = $9,
             unit = $10, discount_percent = $11, discount_amount = $12, total_amount = $13,
             sort_order = $14, updated_at = now()
         WHERE tenant_id = $1 AND deal_id = $2 AND id = $3
         RETURNING id, tenant_id, deal_id, item_type, item_id, name, description, sku, price,
                   cost_price, cost_source, consumed_at, quantity,
                   unit, discount_percent, discount_amount, total_amount, sort_order, created_at, updated_at`,
        [
          tenantId,
          dealId,
          itemId,
          name,
          description,
          sku,
          price,
          costPrice,
          quantity,
          unit,
          discountPercent,
          discountAmount,
          totalAmount,
          sortOrder,
        ],
      );

      // Синхронизируем связанную ожидающую заявку на закупку при изменении позиции сделки
      let linkedPurchaseReq: { id: string; status: string } | null = null;
      if (row.item_type === "product") {
        const pendingPr = await tx.queryOne<{ id: string }>(
          `SELECT id
           FROM purchase_requests
           WHERE tenant_id = $1
             AND deal_id = $2
             AND deal_item_id = $3
             AND status = 'pending'
             AND supplier_order_id IS NULL
           ORDER BY created_at DESC
           LIMIT 1`,
          [tenantId, dealId, itemId],
        );

        if (pendingPr) {
          let reqQty = quantity;
          if (row.item_id) {
            const stockRow = await tx.queryOne<{ available: string }>(
              `SELECT (
                 COALESCE((SELECT SUM(b.remaining_quantity) FROM warehouse_batches b WHERE b.tenant_id = $1 AND b.item_id = $2), 0)
                 - COALESCE((SELECT SUM(r.quantity) FROM warehouse_reservations r WHERE r.tenant_id = $1 AND r.item_id = $2 AND r.status = 'reserved'), 0)
               )::numeric(10,2)::text AS available`,
              [tenantId, row.item_id],
            );
            const avail = Math.max(0, Number(stockRow?.available ?? 0));
            const shortage = Math.round((quantity - avail) * 100) / 100;
            if (shortage > 0) {
              reqQty = shortage;
            }
          }

          const updatedPr = await tx.queryOne<{ id: string; status: string }>(
            `UPDATE purchase_requests
             SET item_name = $3,
                 sku = $4,
                 quantity = $5,
                 unit = $6,
                 estimated_price = $7,
                 updated_at = now()
             WHERE tenant_id = $1 AND id = $2
             RETURNING id, status`,
            [tenantId, pendingPr.id, name, sku, reqQty, unit, costPrice],
          );
          linkedPurchaseReq = updatedPr ?? null;
        } else {
          const latestPr = await tx.queryOne<{ id: string; status: string }>(
            `SELECT id, status
             FROM purchase_requests
             WHERE tenant_id = $1 AND deal_id = $2 AND deal_item_id = $3
             ORDER BY created_at DESC
             LIMIT 1`,
            [tenantId, dealId, itemId],
          );
          linkedPurchaseReq = latestPr ?? null;
        }
      }

      const totalBudget = await this.recalculateDealBudgetInTx(tx, tenantId, dealId);

      return { item: toDealItemDTO(row, undefined, linkedPurchaseReq), totalBudget };
    });
  }

  async deleteDealItem(
    tenantId: string,
    dealId: string,
    itemId: string,
  ): Promise<{ success: boolean; totalBudget: number }> {
    if (itemId.startsWith("repair-")) {
      throw new ValidationError("Услуги и запчасти из наряда удаляются в наряде СЦ", {});
    }
    return withTenant(tenantId, async (tx) => {
      // Удаляем связанные не заказанные заявки на закупку до удаления позиции сделки
      await tx.query(
        `DELETE FROM purchase_requests
         WHERE tenant_id = $1
           AND deal_id = $2
           AND deal_item_id = $3
           AND status = 'pending'
           AND supplier_order_id IS NULL`,
        [tenantId, dealId, itemId],
      );

      await tx.query(
        `DELETE FROM deal_items WHERE tenant_id = $1 AND deal_id = $2 AND id = $3`,
        [tenantId, dealId, itemId],
      );

      const totalBudget = await this.recalculateDealBudgetInTx(tx, tenantId, dealId);

      return { success: true, totalBudget };
    });
  }
}

function toDealItemDTO(
  r: DealItemRow,
  batchAllocations?: DealItemBatchAllocationDTO[],
  purchaseRequest?: { id: string; status: string } | null,
): DealItemDTO {
  const qty = Number(r.quantity ?? 1);
  const totalAmount = Number(r.total_amount ?? 0);
  const costPrice = Number(r.cost_price ?? 0);
  const totalCost = Math.round(costPrice * qty * 100) / 100;
  const grossProfit = totalAmount - totalCost;
  const markupPercent =
    totalCost > 0 ? Math.round((grossProfit / totalCost) * 1000) / 10 : undefined;
  const marginPercent =
    totalAmount > 0 && costPrice > 0
      ? Math.round((grossProfit / totalAmount) * 1000) / 10
      : undefined;

  return {
    id: r.id,
    dealId: r.deal_id,
    itemType: r.item_type,
    itemId: r.item_id,
    name: r.name,
    description: r.description ?? "",
    sku: r.sku ?? "",
    price: Number(r.price ?? 0),
    costPrice,
    costSource: (r.cost_source as DealItemCostSource | undefined) ?? "manual",
    consumedAt: r.consumed_at
      ? r.consumed_at instanceof Date
        ? r.consumed_at.toISOString()
        : String(r.consumed_at)
      : null,
    batchAllocations: batchAllocations && batchAllocations.length > 0 ? batchAllocations : undefined,
    markupPercent,
    marginPercent,
    purchaseRequestId: purchaseRequest?.id ?? null,
    purchaseRequestStatus: purchaseRequest?.status ?? null,
    quantity: qty,
    unit: r.unit ?? "шт",
    discountPercent: Number(r.discount_percent ?? 0),
    discountAmount: Number(r.discount_amount ?? 0),
    totalAmount,
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at
      ? r.updated_at instanceof Date
        ? r.updated_at.toISOString()
        : String(r.updated_at)
      : undefined,
  };
}

function calculateItemTotal(
  price: number,
  quantity: number,
  discountPercent: number,
  discountAmount: number,
): number {
  const base = price * quantity;
  if (discountAmount > 0) {
    return Math.max(0, base - discountAmount);
  }
  if (discountPercent > 0) {
    return Math.max(0, base - (base * discountPercent) / 100);
  }
  return Math.max(0, base);
}

export const dealsService = new DealsService();

