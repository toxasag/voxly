import type {
  CreateDealMessagePayload,
  CreateDealPayload,
  CreateStagePayload,
  DealContactHistoryDTO,
  DealContactSummaryDTO,
  DealContactTimelineItemDTO,
  DealDTO,
  DealMessageDTO,
  DealMessageRow,
  DealOtherDealItemDTO,
  DealRow,
  DeliveryStatus,
  KanbanColumn,
  PipelineDTO,
  StageColor,
  StageRow,
  UpdateDealPayload,
  UpdateStagePayload,
} from "./deals.types.js";
import { stageColorSchema, toDealDTO, toDealMessageDTO } from "./deals.types.js";
import { query, queryOne, withTenant, type SqlParam } from "../../../db/client.js";
import { NotFoundError, ValidationError } from "../../../plugins/errorHandler.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { leadNotificationQueue } from "../leads/lead-notification.queue.js";

const DEAL_COLUMNS = `
  id, tenant_id, pipeline_id, stage_id, contact_id, company_id, title, description,
  budget, currency, custom_fields, created_by, owner_id, close_date, position,
  closed_at, lead_notified_at, created_at, updated_at
`;

/**
 * Те же колонки с префиксом и подписями связей.
 *
 * JOIN'ы вместо отдельных запросов на строку: таблица записей рисует чипы
 * компании, контактного лица и ответственного в каждой строке, и без этого
 * список из 50 сделок стоил бы 150 дополнительных запросов.
 */
const DEAL_COLUMNS_WITH_LABELS = `
  d.id, d.tenant_id, d.pipeline_id, d.stage_id, d.contact_id, d.company_id, d.title,
  d.description, d.budget, d.currency, d.custom_fields, d.created_by, d.owner_id,
  d.close_date, d.position, d.closed_at, d.lead_notified_at, d.created_at, d.updated_at,
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
  LEFT JOIN users ow
    ON ow.id = d.owner_id AND ow.tenant_id = d.tenant_id AND ow.deleted_at IS NULL
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
  attachment, attachment_type, delivery_status, delivery_error, created_at
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

/** Treats "" from form payloads as "no value". */
function nullIfBlank(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  return value;
}

export interface ListDealsOptions {
  pipelineId?: string;
  stageId?: string;
  search?: string;
  /** Секция «Сделки» на карточке контакта. */
  contactId?: string;
  /** Секция «Сделки» на карточке компании. */
  companyId?: string;
  limit: number;
  offset: number;
}

export class DealsService {
  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    tenantId: string,
    options: ListDealsOptions,
  ): Promise<{ items: DealDTO[]; total: number }> {
    const conditions: string[] = ["d.tenant_id = $1", "d.deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    if (options.pipelineId !== undefined) {
      params.push(options.pipelineId);
      conditions.push(`d.pipeline_id = $${params.length}`);
    }

    if (options.stageId !== undefined) {
      params.push(options.stageId);
      conditions.push(`d.stage_id = $${params.length}`);
    }

    if (options.search !== undefined && options.search.length > 0) {
      params.push(`%${options.search}%`);
      conditions.push(`(d.title ILIKE $${params.length} OR d.description ILIKE $${params.length})`);
    }

    if (options.contactId !== undefined) {
      params.push(options.contactId);
      conditions.push(`d.contact_id = $${params.length}`);
    }

    if (options.companyId !== undefined) {
      params.push(options.companyId);
      conditions.push(`d.company_id = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM deals d WHERE ${where}`,
      params,
    );

    params.push(options.limit, options.offset);

    const rows = await query<DealRow>(
      `SELECT ${DEAL_COLUMNS_WITH_LABELS}
       FROM deals d
       ${DEAL_LABEL_JOINS}
       WHERE ${where}
       ORDER BY d.created_at DESC
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
  async kanban(tenantId: string, pipelineId: string): Promise<KanbanColumn[]> {
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
    const rows = await query<DealRow>(
      `SELECT ${DEAL_COLUMNS_WITH_LABELS}
       FROM deals d
       ${DEAL_LABEL_JOINS}
       WHERE d.tenant_id = $1 AND d.pipeline_id = $2 AND d.deleted_at IS NULL
       ORDER BY d.position ASC, d.created_at DESC`,
      [tenantId, pipelineId],
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

      const row = await tx.queryOneOrThrow<DealRow>(
        `INSERT INTO deals
           (tenant_id, pipeline_id, stage_id, contact_id, company_id, title, description,
            budget, currency, custom_fields, created_by, owner_id, close_date, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
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
          createdBy,
          // Ответственный по умолчанию — создатель: сделка без владельца
          // выпадает из отчётов по менеджерам.
          nullIfBlank(payload.owner_id) ?? createdBy,
          nullIfBlank(payload.close_date),
          (first?.position ?? 1) - 1,
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

    if (payload.custom_fields !== undefined) {
      params.push(JSON.stringify(payload.custom_fields));
      assignments.push(`custom_fields = $${params.length}::jsonb`);
    }

    if (payload.closed_at !== undefined) {
      const closedAt = nullIfBlank(payload.closed_at);
      push("closed_at", closedAt === null ? null : new Date(closedAt).toISOString());
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
      const contact = await queryOne<{ id: string }>(
        `SELECT id FROM contacts
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [contactId, tenantId],
      );

      if (contact === null) {
        throw new ValidationError("contact_id does not belong to this tenant", {
          contact_id: ["Unknown contact"],
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
    });
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

    return row !== null;
  }

  // -------------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------------

  async listMessages(tenantId: string, dealId: string): Promise<DealMessageDTO[]> {
    const rows = await query<DealMessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
       FROM deal_messages
       WHERE tenant_id = $1 AND deal_id = $2
       ORDER BY created_at ASC`,
      [tenantId, dealId],
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
    return withTenant(tenantId, async (tx) => {
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
            attachment, attachment_type, delivery_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        ],
      );

      return toDealMessageDTO(row);
    });
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
      const row = await tx.queryOne<DealMessageRow>(
        `UPDATE deal_messages
         SET delivery_status = $3, delivery_error = $4
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${MESSAGE_COLUMNS}`,
        [tenantId, messageId, status, error],
      );

      return row === null ? null : toDealMessageDTO(row);
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

    // 3. Сквозной таймлайн
    const timelineService = new TimelineService();
    const timelineResponse = await timelineService.getTimeline(
      tenantId,
      "contact",
      deal.contact_id,
      50,
      0,
    );

    const timeline: DealContactTimelineItemDTO[] = timelineResponse.items.map((ev) => {
      let title = "Событие";
      let description: string | undefined = undefined;
      const dId = ev.data?.dealId as string | undefined;
      const dTitle = ev.data?.dealTitle as string | undefined;

      if (ev.type === "note") {
        title = (ev.data?.title as string) || "Заметка";
        description = ev.data?.body as string | undefined;
      } else if (ev.type === "message") {
        title =
          ev.data?.channel === "webchat"
            ? "Онлайн-чат"
            : (ev.data?.channel as string) || "Сообщение";
        description = (ev.data?.content || ev.data?.text) as string | undefined;
      } else if (ev.type === "stage_change") {
        title = `Смена этапа${dTitle ? ` в «${dTitle}»` : ""}: ${ev.data?.toStageName || ""}`;
      } else if (ev.type === "task") {
        title = (ev.data?.title as string) || "Задача";
        description = ev.data?.description as string | undefined;
      }

      return {
        id: ev.id,
        type: ev.type,
        dealId: dId,
        dealTitle: dTitle,
        timestamp: ev.createdAt,
        title,
        description,
        authorName: ev.authorName || undefined,
        metadata: ev.data,
      };
    });

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
}
