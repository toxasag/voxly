import { nullIfBlank } from "../../../lib/string.utils.js";
import {
  appendExcludedIdsCondition,
  buildSortOrderBy,
  nullableTextExpr,
  type SortDirection,
} from "../../../lib/table-query.js";
import type {
  CreateTaskPayload,
  LinkedEntityType,
  TaskDTO,
  TaskPriority,
  TaskRow,
  TaskStatus,
  UpdateTaskPayload,
} from "./tasks.types.js";
import { toTaskDTO } from "./tasks.types.js";
import { query, queryOne, queryOneOrThrow, type SqlParam } from "../../../db/client.js";
import type { BulkActionPayload } from "../shared/bulk-action.types.js";

const TASK_COLUMNS = `
  id, tenant_id, deal_id, contact_id, company_id, title, description,
  priority, status, due_date, assignee_id, completed_at, created_at, updated_at,
  notify_telegram, remind_before_minutes, reminder_sent_at
`;

const TASK_COLUMNS_QUALIFIED = `
  crm_tasks.id, crm_tasks.tenant_id, crm_tasks.deal_id, crm_tasks.contact_id, crm_tasks.company_id,
  crm_tasks.title, crm_tasks.description, crm_tasks.priority, crm_tasks.status, crm_tasks.due_date,
  crm_tasks.assignee_id, crm_tasks.completed_at, crm_tasks.created_at, crm_tasks.updated_at,
  crm_tasks.notify_telegram, crm_tasks.remind_before_minutes, crm_tasks.reminder_sent_at
`;

export type TaskQuickFilter = "today" | "overdue" | "upcoming" | "my" | "unassigned";
export type TaskPresetFilter = "all" | "todo" | "in_progress" | "my" | "overdue" | "high_priority" | "done";

export interface ListTasksOptions {
  filter?: TaskQuickFilter;
  preset?: TaskPresetFilter;
  search?: string;
  assigneeId?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  linkedEntityType?: LinkedEntityType;
  linkedEntityId?: string;
  /** Caller id, used by the `my` quick filter. */
  currentUserId: string;
  limit: number;
  offset: number;
  sortBy?: string;
  sortDir?: SortDirection;
}

/** Maps a logical entity link onto the three nullable FK columns. */
function linkColumns(
  type: string | undefined,
  id: string | undefined,
): { dealId: string | null; contactId: string | null; companyId: string | null } {
  const entityId = nullIfBlank(id);

  if (entityId === null || type === undefined || type === "") {
    return { dealId: null, contactId: null, companyId: null };
  }

  return {
    dealId: type === "deal" ? entityId : null,
    contactId: type === "contact" ? entityId : null,
    companyId: type === "company" ? entityId : null,
  };
}

export class TasksService {
  private buildTasksWhereClause(
    tenantId: string,
    options: {
      filter?: TaskQuickFilter;
      preset?: TaskPresetFilter;
      search?: string;
      assigneeId?: string;
      priority?: TaskPriority;
      status?: TaskStatus;
      linkedEntityType?: LinkedEntityType;
      linkedEntityId?: string;
      currentUserId?: string;
      excludedIds?: string[];
    },
  ): { where: string; params: SqlParam[] } {
    const conditions: string[] = ["crm_tasks.tenant_id = $1", "crm_tasks.deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    switch (options.filter) {
      case "today":
        conditions.push("crm_tasks.due_date >= date_trunc('day', now())");
        conditions.push("crm_tasks.due_date < date_trunc('day', now()) + INTERVAL '1 day'");
        break;
      case "overdue":
        conditions.push("crm_tasks.due_date IS NOT NULL AND crm_tasks.due_date < now() AND crm_tasks.status <> 'done'");
        break;
      case "upcoming":
        conditions.push("crm_tasks.due_date IS NOT NULL AND crm_tasks.due_date >= now() AND crm_tasks.status <> 'done'");
        break;
      case "my":
        if (options.currentUserId) {
          params.push(options.currentUserId);
          conditions.push(`crm_tasks.assignee_id = $${params.length}`);
        }
        break;
      case "unassigned":
        conditions.push("crm_tasks.assignee_id IS NULL");
        break;
      default:
        break;
    }

    switch (options.preset) {
      case "todo":
        conditions.push("crm_tasks.status = 'todo'");
        break;
      case "in_progress":
        conditions.push("crm_tasks.status = 'in_progress'");
        break;
      case "done":
        conditions.push("crm_tasks.status = 'done'");
        break;
      case "my":
        if (options.currentUserId) {
          params.push(options.currentUserId);
          conditions.push(`crm_tasks.assignee_id = $${params.length} AND crm_tasks.status <> 'done'`);
        }
        break;
      case "overdue":
        conditions.push("crm_tasks.due_date IS NOT NULL AND crm_tasks.due_date < now() AND crm_tasks.status <> 'done'");
        break;
      case "high_priority":
        conditions.push("crm_tasks.priority = 'high' AND crm_tasks.status <> 'done'");
        break;
      default:
        break;
    }

    if (options.search !== undefined && options.search.trim().length > 0) {
      params.push(`%${options.search.trim()}%`);
      conditions.push(`(crm_tasks.title ILIKE $${params.length} OR crm_tasks.description ILIKE $${params.length})`);
    }

    if (options.assigneeId !== undefined) {
      params.push(options.assigneeId);
      conditions.push(`crm_tasks.assignee_id = $${params.length}`);
    }

    if (options.priority !== undefined) {
      params.push(options.priority);
      conditions.push(`crm_tasks.priority = $${params.length}`);
    }

    if (options.status !== undefined) {
      params.push(options.status);
      conditions.push(`crm_tasks.status = $${params.length}`);
    }

    if (options.linkedEntityType !== undefined && options.linkedEntityId !== undefined && options.linkedEntityId !== "") {
      params.push(options.linkedEntityId);
      const entityParam = `$${params.length}`;

      if (options.linkedEntityType === "deal") {
        params.push("deal");
        const typeParam = `$${params.length}`;
        conditions.push(`(crm_tasks.deal_id = ${entityParam} OR EXISTS (
          SELECT 1 FROM task_targets tt
          WHERE tt.tenant_id = crm_tasks.tenant_id AND tt.task_id = crm_tasks.id AND tt.target_type = ${typeParam} AND tt.target_id = ${entityParam}
        ))`);
      } else if (options.linkedEntityType === "contact") {
        params.push("contact", "deal");
        const typeParam = `$${params.length - 1}`;
        const dealTypeParam = `$${params.length}`;
        conditions.push(`(
          crm_tasks.contact_id = ${entityParam}
          OR EXISTS (
            SELECT 1 FROM task_targets tt
            WHERE tt.tenant_id = crm_tasks.tenant_id AND tt.task_id = crm_tasks.id AND tt.target_type = ${typeParam} AND tt.target_id = ${entityParam}
          )
          OR EXISTS (
            SELECT 1 FROM deals d
            WHERE d.tenant_id = crm_tasks.tenant_id AND d.contact_id = ${entityParam}
              AND (crm_tasks.deal_id = d.id OR EXISTS (
                SELECT 1 FROM task_targets tt_d
                WHERE tt_d.tenant_id = crm_tasks.tenant_id AND tt_d.task_id = crm_tasks.id AND tt_d.target_type = ${dealTypeParam} AND tt_d.target_id = d.id
              ))
          )
        )`);
      } else if (options.linkedEntityType === "company") {
        params.push("company", "deal");
        const typeParam = `$${params.length - 1}`;
        const dealTypeParam = `$${params.length}`;
        conditions.push(`(
          crm_tasks.company_id = ${entityParam}
          OR EXISTS (
            SELECT 1 FROM task_targets tt
            WHERE tt.tenant_id = crm_tasks.tenant_id AND tt.task_id = crm_tasks.id AND tt.target_type = ${typeParam} AND tt.target_id = ${entityParam}
          )
          OR EXISTS (
            SELECT 1 FROM deals d
            WHERE d.tenant_id = crm_tasks.tenant_id AND d.company_id = ${entityParam}
              AND (crm_tasks.deal_id = d.id OR EXISTS (
                SELECT 1 FROM task_targets tt_d
                WHERE tt_d.tenant_id = crm_tasks.tenant_id AND tt_d.task_id = crm_tasks.id AND tt_d.target_type = ${dealTypeParam} AND tt_d.target_id = d.id
              ))
          )
        )`);
      }
    }

    appendExcludedIdsCondition(conditions, params, "crm_tasks.id", options.excludedIds);
    return { where: conditions.join(" AND "), params };
  }

  async list(
    tenantId: string,
    options: ListTasksOptions,
  ): Promise<{
    items: TaskDTO[];
    total: number;
    presetCounts?: Record<TaskPresetFilter, number>;
  }> {
    const { where, params } = this.buildTasksWhereClause(tenantId, options);

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM crm_tasks WHERE ${where}`,
      params,
    );

    const presetCountRow = await queryOne<{
      all_cnt: string;
      todo_cnt: string;
      in_progress_cnt: string;
      my_cnt: string;
      overdue_cnt: string;
      high_priority_cnt: string;
      done_cnt: string;
    }>(
      `SELECT
         COUNT(*)::text AS all_cnt,
         COUNT(*) FILTER (WHERE status = 'todo')::text AS todo_cnt,
         COUNT(*) FILTER (WHERE status = 'in_progress')::text AS in_progress_cnt,
         COUNT(*) FILTER (WHERE assignee_id = $2 AND status <> 'done')::text AS my_cnt,
         COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < now() AND status <> 'done')::text AS overdue_cnt,
         COUNT(*) FILTER (WHERE priority = 'high' AND status <> 'done')::text AS high_priority_cnt,
         COUNT(*) FILTER (WHERE status = 'done')::text AS done_cnt
       FROM crm_tasks
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId, options.currentUserId],
    );

    params.push(options.limit, options.offset);

    const linkTypeExpr = `COALESCE(
      CASE
        WHEN crm_tasks.deal_id IS NOT NULL THEN 'deal'
        WHEN crm_tasks.contact_id IS NOT NULL THEN 'contact'
        WHEN crm_tasks.company_id IS NOT NULL THEN 'company'
        ELSE NULL
      END,
      (SELECT tt.target_type FROM task_targets tt WHERE tt.tenant_id = crm_tasks.tenant_id AND tt.task_id = crm_tasks.id LIMIT 1)
    )`;

    const orderBy = buildSortOrderBy({
      sortBy: options.sortBy,
      sortDir: options.sortDir,
      columns: {
        title: nullableTextExpr("crm_tasks.title"),
        priority: "CASE crm_tasks.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
        due: { expr: "crm_tasks.due_date", nullable: true },
        due_date: { expr: "crm_tasks.due_date", nullable: true },
        assignee: { expr: nullableTextExpr("u.name"), nullable: true },
        link: { expr: linkTypeExpr, nullable: true },
        status: "crm_tasks.status",
        created: "crm_tasks.created_at",
        created_at: "crm_tasks.created_at",
      },
      defaultOrderBy: `(crm_tasks.due_date IS NOT NULL AND crm_tasks.due_date < now() AND crm_tasks.status <> 'done') DESC,
        CASE crm_tasks.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
        crm_tasks.due_date ASC NULLS LAST,
        crm_tasks.created_at DESC`,
      tieBreaker: "crm_tasks.id DESC",
    });

    const rows = await query<TaskRow>(
      `SELECT ${TASK_COLUMNS_QUALIFIED}
       FROM crm_tasks
       LEFT JOIN users u ON u.id = crm_tasks.assignee_id AND u.tenant_id = crm_tasks.tenant_id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items: rows.map(toTaskDTO),
      total: Number(countRow?.total ?? 0),
      presetCounts: {
        all: Number(presetCountRow?.all_cnt ?? 0),
        todo: Number(presetCountRow?.todo_cnt ?? 0),
        in_progress: Number(presetCountRow?.in_progress_cnt ?? 0),
        my: Number(presetCountRow?.my_cnt ?? 0),
        overdue: Number(presetCountRow?.overdue_cnt ?? 0),
        high_priority: Number(presetCountRow?.high_priority_cnt ?? 0),
        done: Number(presetCountRow?.done_cnt ?? 0),
      },
    };
  }

  async get(tenantId: string, id: string): Promise<TaskDTO | null> {
    const row = await queryOne<TaskRow>(
      `SELECT ${TASK_COLUMNS}
       FROM crm_tasks
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );

    return row === null ? null : toTaskDTO(row);
  }

  async create(tenantId: string, payload: CreateTaskPayload): Promise<TaskDTO> {
    const link = linkColumns(payload.linked_entity_type, payload.linked_entity_id);
    let dealId = link.dealId ?? nullIfBlank(payload.deal_id);
    let contactId = link.contactId ?? nullIfBlank(payload.contact_id);
    let companyId = link.companyId ?? nullIfBlank(payload.company_id);

    // Если задача создаётся в сделке (или привязана к ней), проверяем,
    // прикреплены ли к этой сделке контакт и/или компания.
    // Если да — наследуем их связь, чтобы задача автоматически отображалась
    // и в карточке контакта, и в карточке компании.
    if (dealId !== null) {
      const dealRow = await queryOne<{ contact_id: string | null; company_id: string | null }>(
        `SELECT contact_id, company_id FROM deals WHERE id = $1 AND tenant_id = $2`,
        [dealId, tenantId],
      );
      if (dealRow !== null) {
        if (contactId === null && dealRow.contact_id !== null) {
          contactId = dealRow.contact_id;
        }
        if (companyId === null && dealRow.company_id !== null) {
          companyId = dealRow.company_id;
        }
      }
    }

    const row = await queryOneOrThrow<TaskRow>(
      `INSERT INTO crm_tasks
         (tenant_id, deal_id, contact_id, company_id, title, description,
          priority, status, due_date, assignee_id, notify_telegram, remind_before_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${TASK_COLUMNS}`,
      [
        tenantId,
        dealId,
        contactId,
        companyId,
        payload.title,
        payload.description ?? "",
        payload.priority,
        payload.status,
        nullIfBlank(payload.due_date),
        payload.assignee_id,
        Boolean(payload.notify_telegram),
        payload.remind_before_minutes ?? 30,
      ],
    );

    const targetsToInsert: Array<{ type: string; id: string }> = [];
    if (payload.linked_entity_type && payload.linked_entity_id) {
      targetsToInsert.push({ type: payload.linked_entity_type, id: payload.linked_entity_id });
    }
    if (dealId !== null && !targetsToInsert.some((t) => t.type === "deal" && t.id === dealId)) {
      targetsToInsert.push({ type: "deal", id: dealId });
    }
    if (contactId !== null && !targetsToInsert.some((t) => t.type === "contact" && t.id === contactId)) {
      targetsToInsert.push({ type: "contact", id: contactId });
    }
    if (companyId !== null && !targetsToInsert.some((t) => t.type === "company" && t.id === companyId)) {
      targetsToInsert.push({ type: "company", id: companyId });
    }

    for (const target of targetsToInsert) {
      await query(
        `INSERT INTO task_targets (tenant_id, task_id, target_type, target_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (task_id, target_type, target_id) DO NOTHING`,
        [tenantId, row.id, target.type, target.id],
      );
    }

    return toTaskDTO(row);
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdateTaskPayload,
  ): Promise<TaskDTO | null> {
    const assignments: string[] = [];
    const params: SqlParam[] = [tenantId, id];

    const push = (column: string, value: SqlParam): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (payload.title !== undefined) push("title", payload.title);
    if (payload.description !== undefined) push("description", payload.description);
    if (payload.priority !== undefined) push("priority", payload.priority);
    if (payload.assignee_id !== undefined) push("assignee_id", payload.assignee_id);
    if (payload.notify_telegram !== undefined) push("notify_telegram", payload.notify_telegram);
    if (payload.remind_before_minutes !== undefined) push("remind_before_minutes", payload.remind_before_minutes);
    if (payload.due_date !== undefined) {
      push("due_date", nullIfBlank(payload.due_date));
      // Сброс отправленного напоминания для новой даты дедлайна
      push("reminder_sent_at", null);
    }

    // Status and completed_at move together unless the caller sets the stamp.
    if (payload.status !== undefined) {
      push("status", payload.status);

      if (payload.completed_at === undefined) {
        if (payload.status === "done") {
          assignments.push("completed_at = COALESCE(completed_at, now())");
        } else {
          assignments.push("completed_at = NULL");
        }
      }
    }

    if (payload.completed_at !== undefined) {
      const completedAt = nullIfBlank(payload.completed_at);
      push("completed_at", completedAt === null ? null : new Date(completedAt).toISOString());
    }

    const hasRelink =
      payload.linked_entity_type !== undefined ||
      payload.linked_entity_id !== undefined ||
      payload.deal_id !== undefined ||
      payload.contact_id !== undefined ||
      payload.company_id !== undefined;

    if (hasRelink) {
      const link = linkColumns(payload.linked_entity_type, payload.linked_entity_id);
      let dealId = link.dealId ?? nullIfBlank(payload.deal_id);
      let contactId = link.contactId ?? nullIfBlank(payload.contact_id);
      let companyId = link.companyId ?? nullIfBlank(payload.company_id);

      if (dealId !== null && dealId !== undefined) {
        const dealRow = await queryOne<{ contact_id: string | null; company_id: string | null }>(
          `SELECT contact_id, company_id FROM deals WHERE id = $1 AND tenant_id = $2`,
          [dealId, tenantId],
        );
        if (dealRow !== null) {
          if (!contactId && dealRow.contact_id !== null) {
            contactId = dealRow.contact_id;
          }
          if (!companyId && dealRow.company_id !== null) {
            companyId = dealRow.company_id;
          }
        }
      }

      push("deal_id", dealId);
      push("contact_id", contactId);
      push("company_id", companyId);
    }

    if (assignments.length === 0) {
      return this.get(tenantId, id);
    }

    const row = await queryOne<TaskRow>(
      `UPDATE crm_tasks SET ${assignments.join(", ")}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING ${TASK_COLUMNS}`,
      params,
    );

    if (row !== null && hasRelink) {
      const targetsToInsert: Array<{ type: string; id: string }> = [];
      if (row.deal_id !== null) targetsToInsert.push({ type: "deal", id: row.deal_id });
      if (row.contact_id !== null) targetsToInsert.push({ type: "contact", id: row.contact_id });
      if (row.company_id !== null) targetsToInsert.push({ type: "company", id: row.company_id });

      for (const target of targetsToInsert) {
        await query(
          `INSERT INTO task_targets (tenant_id, task_id, target_type, target_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (task_id, target_type, target_id) DO NOTHING`,
          [tenantId, row.id, target.type, target.id],
        );
      }
    }

    return row === null ? null : toTaskDTO(row);
  }

  /** Quick-complete toggle used by the table checkbox. */
  async setStatus(tenantId: string, id: string, status: TaskStatus): Promise<TaskDTO | null> {
    const row = await queryOne<TaskRow>(
      `UPDATE crm_tasks
       SET status = $3,
           completed_at = CASE WHEN $3 = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING ${TASK_COLUMNS}`,
      [tenantId, id, status],
    );

    return row === null ? null : toTaskDTO(row);
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `UPDATE crm_tasks SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, id],
    );

    return row !== null;
  }

  async bulkDelete(
    tenantId: string,
    payload: BulkActionPayload,
    currentUserId?: string,
  ): Promise<{ count: number }> {
    if (payload.mode === "ids") {
      const ids = payload.ids ?? [];
      if (ids.length === 0) return { count: 0 };
      const rows = await query<{ id: string }>(
        `UPDATE crm_tasks
         SET deleted_at = now()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
         RETURNING id`,
        [tenantId, ids],
      );
      return { count: rows.length };
    }

    const filters = payload.filters ?? {};
    const validPreset =
      typeof filters.preset === "string" &&
      ["all", "todo", "in_progress", "my", "overdue", "high_priority", "done"].includes(filters.preset)
        ? (filters.preset as TaskPresetFilter)
        : undefined;
    const validFilter =
      typeof filters.filter === "string" &&
      ["today", "overdue", "upcoming", "my", "unassigned"].includes(filters.filter)
        ? (filters.filter as TaskQuickFilter)
        : undefined;
    const validStatus =
      typeof filters.status === "string" && ["todo", "in_progress", "done"].includes(filters.status)
        ? (filters.status as TaskStatus)
        : undefined;
    const validPriority =
      typeof filters.priority === "string" && ["low", "medium", "high"].includes(filters.priority)
        ? (filters.priority as TaskPriority)
        : undefined;
    const validLinkedType =
      typeof filters.linked_entity_type === "string" &&
      ["deal", "contact", "company"].includes(filters.linked_entity_type)
        ? (filters.linked_entity_type as LinkedEntityType)
        : undefined;

    const { where, params } = this.buildTasksWhereClause(tenantId, {
      filter: validFilter,
      preset: validPreset,
      search: typeof filters.search === "string" ? filters.search : undefined,
      assigneeId: typeof filters.assignee_id === "string" && filters.assignee_id ? filters.assignee_id : undefined,
      priority: validPriority,
      status: validStatus,
      linkedEntityType: validLinkedType,
      linkedEntityId: typeof filters.linked_entity_id === "string" ? filters.linked_entity_id : undefined,
      currentUserId,
      excludedIds: payload.excluded_ids,
    });

    const rows = await query<{ id: string }>(
      `UPDATE crm_tasks
       SET deleted_at = now()
       WHERE ${where}
       RETURNING id`,
      params,
    );

    return { count: rows.length };
  }
}
