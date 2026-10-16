import { z } from "zod";

// ---------------------------------------------------------------------------
// Заметки. Образец — объект Note в Twenty плюс junction-таблица NoteTarget.
//
// У Twenty связь заметки с записью вынесена в отдельную таблицу, где
// заполнен ровно один FK (personId / companyId / opportunityId). Здесь та же
// модель выражена тремя nullable-колонками с CHECK на ровно одну заполненную:
// junction нужен им ради множественных целей у одной заметки, а у нас заметка
// принадлежит одной записи, и лишняя таблица дала бы JOIN на каждом чтении.
//
// Заголовок необязателен, как у них (`title` у Note nullable): чаще всего
// заметку пишут одним абзацем, и требовать заголовок значило бы заставлять
// придумывать его на каждую строчку.
// ---------------------------------------------------------------------------

export const noteTargetTypeSchema = z.enum(["contact", "company", "deal"]);

export type NoteTargetType = z.infer<typeof noteTargetTypeSchema>;

export const createNoteSchema = z.object({
  title: z.string().max(200).optional().or(z.literal("")),
  body: z.string().min(1, "Note body is required").max(20000),
  target_type: noteTargetTypeSchema,
  target_id: z.string().uuid("target_id must be a UUID"),
});

export const updateNoteSchema = z.object({
  title: z.string().max(200).optional().or(z.literal("")),
  body: z.string().min(1, "Note body is required").max(20000).optional(),
});

export type CreateNotePayload = z.infer<typeof createNoteSchema>;
export type UpdateNotePayload = z.infer<typeof updateNoteSchema>;

export interface NoteRow {
  id: string;
  tenant_id: string;
  title: string;
  body: string;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  /** Имя автора приходит LEFT JOIN на users; NULL, если пользователь удалён. */
  created_by_name?: string | null;
}

export interface NoteDTO {
  id: string;
  title: string;
  body: string;
  targetType: NoteTargetType;
  targetId: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Сворачивает три FK в одну логическую цель.
 *
 * CHECK в схеме гарантирует, что заполнена ровно одна колонка, поэтому ветка
 * «ни одной» недостижима — но бросать здесь нечего: тип возвращаемого значения
 * обязан быть определён, и contact с пустым id читался бы дальше как валидная
 * цель. Ошибка делает рассинхрон схемы и кода видимым сразу.
 */
function resolveTarget(row: NoteRow): { type: NoteTargetType; id: string } {
  if (row.contact_id !== null) return { type: "contact", id: row.contact_id };
  if (row.company_id !== null) return { type: "company", id: row.company_id };
  if (row.deal_id !== null) return { type: "deal", id: row.deal_id };

  throw new Error(`Note ${row.id} has no target: notes_single_target constraint is missing`);
}

export function toNoteDTO(row: NoteRow): NoteDTO {
  const target = resolveTarget(row);

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    targetType: target.type,
    targetId: target.id,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** Колонка FK для цели: избегает ветвлений в каждом запросе сервиса. */
export const NOTE_TARGET_COLUMN: Record<NoteTargetType, string> = {
  contact: "contact_id",
  company: "company_id",
  deal: "deal_id",
};
