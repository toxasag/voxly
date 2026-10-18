"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Табличное представление записей по образцу Twenty:
//  - компактные строки (py-2.5), hover подсветка, разделители 1px;
//  - заголовки 11px uppercase с сортировкой по клику (каретка ▲/▼);
//  - первая колонка — номер строки, который на ховере превращается в чекбокс
//    (в Twenty так же: индекс живёт на виду, выбор появляется под курсором);
//  - выравнивание и фиксированная ширина задаются колонкой.
// Таблица не знает про API: строки, идентификаторы и рендер приходят снаружи,
// массовые действия рисует родитель через `bulkBar`.
// ---------------------------------------------------------------------------

export interface CrmColumn<T> {
  id: string;
  header: string;
  widthClass?: string;
  align?: "left" | "right";
  /** Значение для сортировки; без него колонка считается несортируемой. */
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
}

interface CrmTableProps<T> {
  rows: readonly T[];
  getRowId: (row: T) => string;
  columns: readonly CrmColumn<T>[];
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  emptyState?: ReactNode;
  bulkBar?: ReactNode;
  footer?: ReactNode;
}

export function CrmTable<T>({
  rows,
  getRowId,
  columns,
  onRowClick,
  selectable = false,
  selectedIds,
  onSelectionChange,
  emptyState,
  bulkBar,
  footer,
}: CrmTableProps<T>) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const sortedRows = useMemo(() => {
    if (sortColumn === null) return rows;
    const column = columns.find((entry) => entry.id === sortColumn);
    if (column?.sortValue === undefined) return rows;

    const factor = sortAsc ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = column.sortValue?.(left);
      const b = column.sortValue?.(right);
      if (typeof a === "number" && typeof b === "number") return (a - b) * factor;
      return String(a).localeCompare(String(b), "ru") * factor;
    });
  }, [rows, columns, sortColumn, sortAsc]);

  const handleSort = (columnId: string): void => {
    if (sortColumn === columnId) {
      setSortAsc((prev) => !prev);
    } else {
      setSortColumn(columnId);
      // Дефолт как в Twenty: новые сверху, суммы по убыванию.
      setSortAsc(false);
    }
  };

  const toggleAll = (): void => {
    if (onSelectionChange === undefined || selectedIds === undefined) return;
    onSelectionChange(
      rows.length > 0 && rows.every((row) => selectedIds.has(getRowId(row)))
        ? new Set<string>()
        : new Set(rows.map((row) => getRowId(row))),
    );
  };

  const toggleOne = (id: string): void => {
    if (onSelectionChange === undefined || selectedIds === undefined) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  if (rows.length === 0 && emptyState !== undefined) {
    return <>{emptyState}</>;
  }

  return (
    <div className="space-y-3">
      {selectable && selectedIds !== undefined && selectedIds.size > 0 && bulkBar}

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900">
                {selectable && (
                  <th className="w-10 px-3 py-2" aria-label="Выбрать все">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((row) => selectedIds?.has(getRowId(row)) === true)}
                      onChange={toggleAll}
                      className="h-3.5 w-3.5 accent-[#4a38f5]"
                    />
                  </th>
                )}
                {columns.map((column, index) => (
                  <th
                    key={column.id}
                    scope="col"
                    className={cn(
                      "px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500",
                      column.align === "right" ? "text-right" : "text-left",
                      index === 0 && !selectable && "pl-10",
                      column.widthClass,
                    )}
                  >
                    {column.sortValue !== undefined ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column.id)}
                        className={cn(
                          "inline-flex items-center gap-1 transition-colors hover:text-slate-300",
                          sortColumn === column.id ? "text-slate-200" : "text-slate-500",
                        )}
                      >
                        {column.header}
                        <span className={cn("text-xs", sortColumn === column.id ? "opacity-100 text-amber-400" : "opacity-30")}>
                          {sortColumn === column.id && sortAsc ? "▲" : "▼"}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/70">
              {sortedRows.map((row, index) => {
                const id = getRowId(row);
                const isSelected = selectable && selectedIds?.has(id) === true;

                return (
                  <tr
                    key={id}
                    onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
                    className={cn(
                      "group cursor-pointer transition-colors",
                      isSelected ? "bg-[#4a38f5]/[0.06]" : "hover:bg-slate-800/40",
                    )}
                  >
                    {selectable && (
                      <td
                        className="relative w-10 px-3 py-2.5"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {/* Номер строки виден всегда; чекбокс проявляется на ховере строки. */}
                        <span className={cn(
                          "absolute left-3 top-1/2 -translate-y-1/2 select-none text-xs tabular-nums text-slate-600 transition-opacity",
                          isSelected ? "opacity-0" : "group-hover:opacity-0",
                        )}>
                          {index + 1}
                        </span>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(id)}
                          aria-label={`Выбрать строку ${index + 1}`}
                          className={cn(
                            "h-3.5 w-3.5 accent-[#4a38f5] transition-opacity",
                            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          )}
                        />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          "min-w-0 truncate px-4 py-2.5 text-sm text-slate-300",
                          column.align === "right" ? "text-right" : "text-left",
                          index === 0 && !selectable && "pl-10",
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {footer}
      </div>
    </div>
  );
}

/** Пустое состояние таблицы: иконка + подпись + опциональная кнопка. */
export function TableEmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/50 px-6 py-16 text-center">
      <Icon className="mx-auto h-8 w-8 text-slate-600" />
      <p className="mt-3 text-sm font-semibold text-slate-300">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
