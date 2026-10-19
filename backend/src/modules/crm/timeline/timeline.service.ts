import { query, queryOne } from "../../../db/client.js";
import type { TimelineEventDTO, TimelineListResponse, TimelineRecordType } from "./timeline.types.js";

export class TimelineService {
  async getTimeline(
    tenantId: string,
    recordType: TimelineRecordType,
    recordId: string,
    limit: number = 30,
    offset: number = 0,
  ): Promise<TimelineListResponse> {
    const table = { deal: "deals", contact: "contacts", company: "companies" }[recordType];
    const target = await queryOne<{ id: string }>(
      `SELECT id FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, recordId],
    );
    if (!target) {
      return { items: [], total: 0, limit, offset };
    }

    const countSql = `
      SELECT COUNT(*)::text AS total FROM (
        -- Notes
        SELECT n.id
        FROM notes n
        WHERE n.tenant_id = $1 AND n.deleted_at IS NULL
          AND (
            (CASE WHEN $2 = 'contact' THEN n.contact_id WHEN $2 = 'company' THEN n.company_id WHEN $2 = 'deal' THEN n.deal_id END) = $3
            OR EXISTS (
              SELECT 1 FROM note_targets nt
              WHERE nt.tenant_id = n.tenant_id AND nt.note_id = n.id AND nt.target_type = $2 AND nt.target_id = $3
            )
          )

        UNION ALL

        -- Tasks
        SELECT t.id
        FROM crm_tasks t
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
          AND (
            (CASE WHEN $2 = 'contact' THEN t.contact_id WHEN $2 = 'company' THEN t.company_id WHEN $2 = 'deal' THEN t.deal_id END) = $3
            OR EXISTS (
              SELECT 1 FROM task_targets tt
              WHERE tt.tenant_id = t.tenant_id AND tt.task_id = t.id AND tt.target_type = $2 AND tt.target_id = $3
            )
          )

        UNION ALL

        -- Deal Messages
        SELECT m.id
        FROM deal_messages m
        WHERE m.tenant_id = $1
          AND (
            ($2 = 'deal' AND m.deal_id = $3)
            OR ($2 = 'contact' AND m.deal_id IN (SELECT d.id FROM deals d WHERE d.tenant_id = $1 AND d.contact_id = $3))
            OR ($2 = 'company' AND m.deal_id IN (SELECT d.id FROM deals d WHERE d.tenant_id = $1 AND d.company_id = $3))
          )

        UNION ALL

        -- Stage Changes
        SELECT h.id
        FROM deal_stage_history h
        WHERE h.tenant_id = $1
          AND (
            ($2 = 'deal' AND h.deal_id = $3)
            OR ($2 = 'contact' AND h.deal_id IN (SELECT d.id FROM deals d WHERE d.tenant_id = $1 AND d.contact_id = $3))
            OR ($2 = 'company' AND h.deal_id IN (SELECT d.id FROM deals d WHERE d.tenant_id = $1 AND d.company_id = $3))
          )
      ) cnt
    `;

    const countRow = await queryOne<{ total: string }>(countSql, [tenantId, recordType, recordId]);
    const total = Number(countRow?.total ?? 0);

    const itemsSql = `
      SELECT id, event_type, created_at, author_id, author_name, event_data FROM (
        -- Notes
        SELECT
          n.id::text AS id,
          'note' AS event_type,
          n.created_at,
          n.created_by::text AS author_id,
          u.name AS author_name,
          jsonb_build_object(
            'title', n.title,
            'body', n.body
          ) AS event_data
        FROM notes n
        LEFT JOIN users u ON u.id = n.created_by AND u.tenant_id = n.tenant_id
        WHERE n.tenant_id = $1 AND n.deleted_at IS NULL
          AND (
            (CASE WHEN $2 = 'contact' THEN n.contact_id WHEN $2 = 'company' THEN n.company_id WHEN $2 = 'deal' THEN n.deal_id END) = $3
            OR EXISTS (
              SELECT 1 FROM note_targets nt
              WHERE nt.tenant_id = n.tenant_id AND nt.note_id = n.id AND nt.target_type = $2 AND nt.target_id = $3
            )
          )

        UNION ALL

        -- Tasks
        SELECT
          t.id::text AS id,
          'task' AS event_type,
          t.created_at,
          t.assignee_id::text AS author_id,
          u.name AS author_name,
          jsonb_build_object(
            'title', t.title,
            'description', t.description,
            'priority', t.priority,
            'status', t.status,
            'dueDate', t.due_date,
            'completedAt', t.completed_at
          ) AS event_data
        FROM crm_tasks t
        LEFT JOIN users u ON u.id = t.assignee_id AND u.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
          AND (
            (CASE WHEN $2 = 'contact' THEN t.contact_id WHEN $2 = 'company' THEN t.company_id WHEN $2 = 'deal' THEN t.deal_id END) = $3
            OR EXISTS (
              SELECT 1 FROM task_targets tt
              WHERE tt.tenant_id = t.tenant_id AND tt.task_id = t.id AND tt.target_type = $2 AND tt.target_id = $3
            )
          )

        UNION ALL

        -- Messages
        SELECT
          m.id::text AS id,
          'message' AS event_type,
          m.created_at,
          NULL AS author_id,
          m.sender_name AS author_name,
          jsonb_build_object(
            'dealId', m.deal_id,
            'direction', m.direction,
            'channel', m.channel,
            'content', m.content,
            'deliveryStatus', m.delivery_status
          ) AS event_data
        FROM deal_messages m
        WHERE m.tenant_id = $1
          AND (
            ($2 = 'deal' AND m.deal_id = $3)
            OR ($2 = 'contact' AND m.deal_id IN (SELECT d.id FROM deals d WHERE d.tenant_id = $1 AND d.contact_id = $3))
            OR ($2 = 'company' AND m.deal_id IN (SELECT d.id FROM deals d WHERE d.tenant_id = $1 AND d.company_id = $3))
          )

        UNION ALL

        -- Stage changes
        SELECT
          h.id::text AS id,
          'stage_change' AS event_type,
          h.created_at,
          h.changed_by::text AS author_id,
          u.name AS author_name,
          jsonb_build_object(
            'dealId', h.deal_id,
            'fromStageId', h.from_stage_id,
            'fromStageName', fs.name,
            'fromStageColor', fs.color,
            'toStageId', h.to_stage_id,
            'toStageName', ts.name,
            'toStageColor', ts.color
          ) AS event_data
        FROM deal_stage_history h
        LEFT JOIN users u ON u.id = h.changed_by AND u.tenant_id = h.tenant_id
        LEFT JOIN deal_stages fs ON fs.id = h.from_stage_id AND fs.tenant_id = h.tenant_id
        LEFT JOIN deal_stages ts ON ts.id = h.to_stage_id AND ts.tenant_id = h.tenant_id
        WHERE h.tenant_id = $1
          AND (
            ($2 = 'deal' AND h.deal_id = $3)
            OR ($2 = 'contact' AND h.deal_id IN (SELECT d.id FROM deals d WHERE d.tenant_id = $1 AND d.contact_id = $3))
            OR ($2 = 'company' AND h.deal_id IN (SELECT d.id FROM deals d WHERE d.tenant_id = $1 AND d.company_id = $3))
          )
      ) stream
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5
    `;

    interface RawRow {
      id: string;
      event_type: "note" | "task" | "message" | "stage_change";
      created_at: Date | string;
      author_id: string | null;
      author_name: string | null;
      event_data: Record<string, unknown>;
    }

    const rows = await query<RawRow>(itemsSql, [tenantId, recordType, recordId, limit, offset]);

    const items: TimelineEventDTO[] = rows.map((r) => ({
      id: r.id,
      type: r.event_type,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      authorId: r.author_id,
      authorName: r.author_name,
      data: r.event_data,
    }));

    return { items, total, limit, offset };
  }
}
