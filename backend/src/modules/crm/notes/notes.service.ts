import type {
  CreateNotePayload,
  NoteDTO,
  NoteRow,
  NoteTargetType,
  UpdateNotePayload,
} from "./notes.types.js";
import { NOTE_TARGET_COLUMN, toNoteDTO } from "./notes.types.js";
import { query, queryOne, queryOneOrThrow, type SqlParam } from "../../../db/client.js";

const NOTE_COLUMNS = `
  n.id, n.tenant_id, n.title, n.body, n.contact_id, n.company_id, n.deal_id,
  n.created_by, n.created_at, n.updated_at,
  u.name AS created_by_name
`;

// Автор ограничен арендатором заметки: users вне RLS, и JOIN только по id
// подставил бы имя пользователя чужого арендатора.
const NOTE_JOINS = `LEFT JOIN users u ON u.id = n.created_by AND u.tenant_id = n.tenant_id`;

export interface ListNotesOptions {
  targetType: NoteTargetType;
  targetId: string;
  limit: number;
  offset: number;
}

export class NotesService {
  /**
   * Заметки одной записи, свежие сверху.
   *
   * Колонка цели подставляется из NOTE_TARGET_COLUMN, а не из входной строки:
   * значение приходит из zod-энума, но интерполировать в SQL напрямую нельзя —
   * маппинг гарантирует, что в запрос попадёт только известное имя колонки.
   */
  async listByTarget(
    tenantId: string,
    options: ListNotesOptions,
  ): Promise<{ items: NoteDTO[]; total: number }> {
    const column = NOTE_TARGET_COLUMN[options.targetType];

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM notes n
       WHERE n.tenant_id = $1 AND n.deleted_at IS NULL
         AND (
           n.${column} = $2
           OR EXISTS (
             SELECT 1 FROM note_targets nt
             WHERE nt.tenant_id = n.tenant_id AND nt.note_id = n.id AND nt.target_type = $3 AND nt.target_id = $2
           )
         )`,
      [tenantId, options.targetId, options.targetType],
    );

    const rows = await query<NoteRow>(
      `SELECT ${NOTE_COLUMNS}
       FROM notes n
       ${NOTE_JOINS}
       WHERE n.tenant_id = $1 AND n.deleted_at IS NULL
         AND (
           n.${column} = $2
           OR EXISTS (
             SELECT 1 FROM note_targets nt
             WHERE nt.tenant_id = n.tenant_id AND nt.note_id = n.id AND nt.target_type = $3 AND nt.target_id = $2
           )
         )
       ORDER BY n.created_at DESC
       LIMIT $4 OFFSET $5`,
      [tenantId, options.targetId, options.targetType, options.limit, options.offset],
    );

    return { items: rows.map(toNoteDTO), total: Number(countRow?.total ?? 0) };
  }

  async get(tenantId: string, id: string): Promise<NoteDTO | null> {
    const row = await queryOne<NoteRow>(
      `SELECT ${NOTE_COLUMNS}
       FROM notes n
       ${NOTE_JOINS}
       WHERE n.tenant_id = $1 AND n.id = $2 AND n.deleted_at IS NULL`,
      [tenantId, id],
    );

    return row === null ? null : toNoteDTO(row);
  }

  /**
   * Создание заметки.
   *
   * Цель проверяется отдельным SELECT до вставки: FK поймал бы чужой id, но
   * ответил бы 500-й ошибкой БД, а не понятным «запись не найдена». Проверка
   * идёт с tenant_id, иначе можно было бы прикрепить заметку к записи чужого
   * тенанта, зная её uuid.
   */
  async create(
    tenantId: string,
    payload: CreateNotePayload,
    createdBy?: string,
  ): Promise<NoteDTO | null> {
    const targetTable = { contact: "contacts", company: "companies", deal: "deals" }[
      payload.target_type
    ];

    const target = await queryOne<{ id: string }>(
      `SELECT id FROM ${targetTable}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, payload.target_id],
    );

    if (target === null) return null;

    const column = NOTE_TARGET_COLUMN[payload.target_type];

    const row = await queryOneOrThrow<NoteRow>(
      `INSERT INTO notes (tenant_id, title, body, ${column}, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, title, body, contact_id, company_id, deal_id,
                 created_by, created_at, updated_at`,
      [tenantId, payload.title ?? "", payload.body, payload.target_id, createdBy ?? null],
    );

    // Зеркалируем связь в junction-таблицу note_targets (Twenty CRM parity)
    await query(
      `INSERT INTO note_targets (tenant_id, note_id, target_type, target_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (note_id, target_type, target_id) DO NOTHING`,
      [tenantId, row.id, payload.target_type, payload.target_id],
    );

    // Перечитываем ради имени автора: RETURNING не умеет отдать значение JOIN-а,
    // а список заметок показывает автора у каждой записи.
    return this.get(tenantId, row.id);
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdateNotePayload,
  ): Promise<NoteDTO | null> {
    const assignments: string[] = [];
    const params: SqlParam[] = [tenantId, id];

    const push = (column: string, value: SqlParam): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (payload.title !== undefined) push("title", payload.title ?? "");
    if (payload.body !== undefined) push("body", payload.body);

    if (assignments.length === 0) return this.get(tenantId, id);

    const updated = await queryOne<{ id: string }>(
      `UPDATE notes SET ${assignments.join(", ")}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      params,
    );

    return updated === null ? null : this.get(tenantId, id);
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `UPDATE notes SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, id],
    );

    return row !== null;
  }
}
