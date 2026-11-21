"use client";

import { memo, type ReactNode } from "react";
import { Trash2, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TableBulkBarProps {
  /** Число выбранных записей на текущей странице (или всего, если выбраны все) */
  selectedCount: number;
  /** Общее число записей выборки с учётом текущих фильтров */
  totalCount: number;
  /** Выбраны ли абсолютно все записи выборки (не только текущая страница) */
  isAllSelected: boolean;
  /** Существительное во множественном числе в родительном падеже (например, «контактов», «компаний», «сделок», «задач») */
  entityNamePlural: string;
  /** Число записей на текущей странице (обычно rows.length) */
  pageItemCount: number;
  /** Выбрать все записи выборки по фильтрам */
  onSelectAll: () => void;
  /** Снять выделение со всех записей */
  onClearSelection: () => void;
  /** Вызывается при нажатии кнопки «Удалить» */
  onDelete?: () => void;
  /** Флаг выполнения процесса удаления */
  isDeleting?: boolean;
  /** Текст на кнопке удаления */
  deleteLabel?: string;
  /** Дополнительные контролы действий (например, «Сменить этап») */
  children?: ReactNode;
}

export const TableBulkBar = memo(function TableBulkBar({
  selectedCount,
  totalCount,
  isAllSelected,
  entityNamePlural,
  pageItemCount,
  onSelectAll,
  onClearSelection,
  onDelete,
  isDeleting = false,
  deleteLabel = "Удалить",
  children,
}: TableBulkBarProps) {
  // Показываем кнопку «Выбрать все N», когда выбраны все элементы на текущей странице,
  // общее число превышает число на странице, и режим «все» ещё не активирован.
  const canSelectAllAcrossPages =
    !isAllSelected &&
    pageItemCount > 0 &&
    selectedCount >= pageItemCount &&
    totalCount > pageItemCount;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-2.5 shadow-2xs transition-all">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
        {isAllSelected ? (
          <span className="flex items-center gap-1.5 font-medium text-[#111111]">
            <CheckSquare className="h-4 w-4 text-[#4a38f5]" />
            <span>
              Выбраны все <span className="tabular-nums font-semibold">{totalCount}</span> {entityNamePlural}
            </span>
          </span>
        ) : (
          <span className="font-medium text-[#111111]">
            Выбрано: <span className="tabular-nums font-semibold">{selectedCount}</span>
            {canSelectAllAcrossPages && <span className="text-[#666666] font-normal"> на этой странице</span>}
          </span>
        )}

        {canSelectAllAcrossPages && (
          <button
            type="button"
            onClick={onSelectAll}
            className="font-medium text-[#4a38f5] hover:text-[#3d2ee0] underline underline-offset-2 transition-colors cursor-pointer"
          >
            Выбрать все {totalCount} {entityNamePlural}
          </button>
        )}

        <span className="text-[#cccccc] select-none">|</span>

        <button
          type="button"
          onClick={onClearSelection}
          className="text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
        >
          Снять выделение
        </button>
      </div>

      <div className="flex items-center gap-2">
        {children}

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 rounded-[8px] bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50 transition-colors cursor-pointer shadow-2xs"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>
              {deleteLabel}
              {isAllSelected && totalCount > 0 ? ` (${totalCount})` : selectedCount > 0 ? ` (${selectedCount})` : ""}
            </span>
          </button>
        )}
      </div>
    </div>
  );
});
