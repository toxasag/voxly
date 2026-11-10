import { z } from "zod";

export const recordTableIdSchema = z.enum(["contacts", "companies", "deals", "tasks"]);

const columnIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "Column id must start with a letter and contain only letters, digits, _ or -");

const uniqueColumnIds = (value: string[], ctx: z.RefinementCtx): void => {
  if (new Set(value).size !== value.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Column ids must be unique" });
  }
};

/**
 * Режим отображения списка: канбан или таблица.
 *
 * Живёт вместе с раскладкой колонок, а не отдельной настройкой: это часть
 * представления, как и ширины со скрытыми колонками. Плану соответствует
 * `view_mode` из `record_views`; здесь он поле того же JSONB, потому что схема
 * реализована одной таблицей.
 *
 * Необязательное: раскладки, сохранённые до появления поля, остаются годными —
 * `.strict()` отклонил бы их, будь поле обязательным, и пользователь потерял бы
 * настроенные колонки.
 */
export const recordViewModeSchema = z.enum(["kanban", "table", "calendar"]);

export const recordTableLayoutSchema = z
  .object({
    widths: z.record(columnIdSchema, z.number().int().min(104).max(2_000)).refine(
      (value) => Object.keys(value).length <= 50,
      "At most 50 column widths are allowed",
    ),
    order: z.array(columnIdSchema).max(50).superRefine(uniqueColumnIds),
    hidden: z.array(columnIdSchema).max(50).superRefine(uniqueColumnIds),
    viewMode: recordViewModeSchema.optional(),
    /**
     * Ширина колонки канбана в пикселях. Необязательное: раскладки до появления
     * поля остаются годными. Границы как у Twenty RecordBoard (~200–480).
     */
    kanbanColumnWidth: z.number().int().min(200).max(480).optional(),
    /**
     * Индивидуальные ширины колонок канбана по этапам (stageId -> width).
     */
    kanbanColumnWidths: z.record(z.string().max(64), z.number().int().min(160).max(800)).optional(),
  })
  .strict();

export type RecordTableId = z.infer<typeof recordTableIdSchema>;
export type RecordViewMode = z.infer<typeof recordViewModeSchema>;
export type RecordTableLayout = z.infer<typeof recordTableLayoutSchema>;

export interface RecordTableLayoutRow {
  table_id: RecordTableId;
  layout: unknown;
  updated_at: Date | string;
}

export interface RecordTableLayoutDTO {
  tableId: RecordTableId;
  layout: RecordTableLayout;
  updatedAt: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toRecordTableLayoutDTO(row: RecordTableLayoutRow): RecordTableLayoutDTO {
  return {
    tableId: row.table_id,
    layout: recordTableLayoutSchema.parse(row.layout),
    updatedAt: toIso(row.updated_at),
  };
}
