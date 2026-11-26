import { z } from "zod";
import { query, type SqlParam, type TransactionClient } from "../db/client.js";

export const sortDirSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof sortDirSchema>;

export const bulkModeSchema = z.enum(["ids", "all"]);
export type BulkActionMode = z.infer<typeof bulkModeSchema>;

/**
 * Единый контракт пакетных операций для всех таблиц GETVOXLY:
 * - `mode: "ids"` — явный список UUID выбранных строк;
 * - `mode: "all"` — все строки, удовлетворяющие активным `filters`, кроме `excluded_ids`.
 */
export const bulkActionSchema = z.object({
  mode: bulkModeSchema.default("ids"),
  ids: z.array(z.string().uuid()).optional(),
  excluded_ids: z.array(z.string().uuid()).optional(),
  filters: z.record(z.unknown()).optional(),
});

export type BulkActionPayload = z.infer<typeof bulkActionSchema>;

export interface SortColumnSpec {
  /** Безопасное SQL-выражение (строго из whitelist на сервере). */
  expr: string;
  /** Если true — добавляется NULLS LAST при любом направлении сортировки. */
  nullable?: boolean;
  /** Дополнительное выражение того же направления (например, фамилия после имени). */
  secondaryExpr?: string;
}

/**
 * Приводит опциональный/пустой текст к NULL и нижнему регистру для корректной
 * регистронезависимой сортировки с NULLS LAST.
 */
export function nullableTextExpr(columnExpr: string): string {
  return `LOWER(NULLIF(BTRIM(${columnExpr}), ''))`;
}

/**
 * Формирует безопасный SQL-фрагмент для ORDER BY строго по белому списку колонок
 * и всегда добавляет детерминированный tie-breaker (`id`), чтобы строки не
 * прыгали между страницами при пагинации.
 */
export function buildSortOrderBy(options: {
  sortBy?: string;
  sortDir?: SortDirection;
  columns: Record<string, SortColumnSpec | string>;
  defaultOrderBy: string;
  tieBreaker: string;
}): string {
  const { sortBy, sortDir, columns, defaultOrderBy, tieBreaker } = options;

  if (!sortBy || !Object.prototype.hasOwnProperty.call(columns, sortBy)) {
    const normalizedDefault = defaultOrderBy.trim();
    if (normalizedDefault.toLowerCase().includes(tieBreaker.trim().toLowerCase())) {
      return normalizedDefault;
    }
    return `${normalizedDefault}, ${tieBreaker}`;
  }

  const rawSpec = columns[sortBy];
  if (!rawSpec) {
    const normalizedDefault = defaultOrderBy.trim();
    if (normalizedDefault.toLowerCase().includes(tieBreaker.trim().toLowerCase())) {
      return normalizedDefault;
    }
    return `${normalizedDefault}, ${tieBreaker}`;
  }
  const spec: SortColumnSpec = typeof rawSpec === "string" ? { expr: rawSpec } : rawSpec;
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const nullsClause = spec.nullable ? " NULLS LAST" : "";

  const parts = [`${spec.expr} ${dir}${nullsClause}`];
  if (spec.secondaryExpr) {
    parts.push(`${spec.secondaryExpr} ${dir}${nullsClause}`);
  }
  parts.push(tieBreaker);

  return parts.join(", ");
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Добавляет фильтр исключения снятых строк при `mode: "all"`.
 */
export function appendExcludedIdsCondition(
  conditions: string[],
  params: SqlParam[],
  idExpr: string,
  excludedIds?: string[],
): void {
  const uniqueExcluded = normalizeUuidArray(excludedIds);
  if (uniqueExcluded.length === 0) {
    return;
  }
  params.push(uniqueExcluded);
  conditions.push(`NOT (${idExpr} = ANY($${params.length}::uuid[]))`);
}

/**
 * Извлекает уникальные валидные UUID из массива или одного ID.
 */
export function normalizeUuidArray(raw: unknown): string[] {
  if (!raw) return [];
  const candidates: string[] = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string").map((v) => v.trim())
    : typeof raw === "string"
    ? raw.split(",").map((v) => v.trim())
    : [];

  return Array.from(new Set(candidates.filter((v) => UUID_REGEX.test(v))));
}

/**
 * Унифицированный резолвер ID целевых записей для транзакционных
 * массовых операций (ремонтные наряды с FSM, заказы поставщикам, партии, счета).
 */
export async function resolveBulkTargetIds(options: {
  executor?: Pick<TransactionClient, "query">;
  payload: BulkActionPayload;
  buildFilteredQuery: (excludedIds?: string[]) => { sql: string; params: SqlParam[] };
}): Promise<string[]> {
  const { payload, buildFilteredQuery } = options;
  if (payload.mode === "ids") {
    return Array.from(
      new Set((payload.ids ?? []).filter((id) => typeof id === "string" && id.length > 0)),
    );
  }

  const { sql, params } = buildFilteredQuery(payload.excluded_ids);
  const rows: Array<{ id: string }> = options.executor
    ? await options.executor.query<{ id: string }>(sql, params)
    : await query<{ id: string }>(sql, params);
  return rows.map((r: { id: string }) => r.id);
}
