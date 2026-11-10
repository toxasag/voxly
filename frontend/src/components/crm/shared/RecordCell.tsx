"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Ячейка таблицы записей по образцу Twenty (`RecordTableCell*`).
//
// Три состояния, как у них: display → focus (клик или стрелки, тонкая рамка) →
// edit (инпут поверх ячейки). Focus вынесен отдельно от edit намеренно: он
// нужен, чтобы стрелками ходить по таблице, не открывая редактор и не рискуя
// случайной правкой.
//
// При наведении на редактируемую ячейку появляется аккуратная скруглённая
// рамка и кнопка с иконкой карандаша Pencil справа (по Скриншоту 4 из Twenty).
// ---------------------------------------------------------------------------

export const RECORD_TABLE_ROW_HEIGHT = 32;
export const RECORD_TABLE_CHECKBOX_WIDTH = 28;
export const RECORD_TABLE_COLUMN_MIN_WIDTH = 104;

interface RecordCellShellProps {
  children: ReactNode;
  /** Пустое значение рисует плейсхолдер «Указать …», как `Set {label}` у Twenty. */
  emptyLabel?: string;
  isEmpty?: boolean;
  editable?: boolean;
  onStartEdit?: () => void;
  align?: "left" | "right" | "center";
  /**
   * Ячейка первой колонки (идентификатор записи).
   *
   * У Twenty (`useOpenRecordTableCell`) клик по ней открывает запись,
   * а кнопка с карандашом (или клик при пустом значении) открывает редактор.
   */
  isLabelIdentifier?: boolean;
  className?: string;
}

export function RecordCellShell({
  children,
  emptyLabel,
  isEmpty = false,
  editable = false,
  onStartEdit,
  align = "left",
  isLabelIdentifier = false,
  className,
}: RecordCellShellProps) {
  // Первая колонка с непустым значением отдаёт клик строке: карточка важнее
  // правки, а переименовать запись можно через кнопку карандаша или из самой карточки.
  const opensOnClick = isLabelIdentifier && !isEmpty;
  const canEdit = editable && !opensOnClick;

  return (
    <div
      onClick={
        canEdit
          ? (event) => {
              // Клик не должен дойти до строки: иначе он одновременно открыл бы
              // редактор ячейки и карточку записи.
              event.stopPropagation();
              onStartEdit?.();
            }
          : undefined
      }
      className={cn(
        "group/cell relative flex h-full w-full items-center overflow-hidden whitespace-nowrap px-1 outline-none",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
        canEdit && "cursor-text",
        opensOnClick && "cursor-pointer",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-h-[26px] h-full w-full min-w-0 items-center justify-between rounded-[5px] border border-transparent px-1.5 transition-all duration-100",
          editable && "group-hover/cell:border-[#d1d5db] group-hover/cell:bg-white group-hover/cell:shadow-2xs",
          align === "right" && "justify-end",
        align === "center" && "justify-center",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5",
            align === "right" && "justify-end",
        align === "center" && "justify-center",
          )}
        >
          {isEmpty && emptyLabel !== undefined ? (
            <span className="text-xs font-normal text-[#999999]">Указать {emptyLabel}</span>
          ) : (
            children
          )}
        </div>

        {editable && (
          <button
            type="button"
            tabIndex={-1}
            title="Редактировать ячейку"
            aria-label="Редактировать ячейку"
            onClick={(event) => {
              event.stopPropagation();
              onStartEdit?.();
            }}
            className={cn(
              "ml-1.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border border-[#e5e5e5] bg-[#f9fafb] text-[#555555] opacity-0 transition-opacity duration-100 hover:bg-[#f3f4f6] hover:text-[#111111] group-hover/cell:opacity-100",
              align === "right" && "order-last ml-2",
            )}
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Редакторы значений
// ---------------------------------------------------------------------------

interface TextEditorProps {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  type?: "text" | "number" | "date";
  align?: "left" | "right" | "center";
}

/**
 * Инпут поверх ячейки: Enter сохраняет, Escape отменяет, клик вне сохраняет.
 * Сохранение по блюру, а не отмена: у Twenty так же — пользователь, кликнувший
 * в соседнюю ячейку, ожидает, что введённое осталось.
 */
export function RecordCellEditor({ value, onCommit, onCancel, type = "text", align = "left" }: TextEditorProps) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = useCallback(() => {
    if (draft !== value) onCommit(draft);
    else onCancel();
  }, [draft, value, onCommit, onCancel]);

  return (
    <div className="flex h-full items-center gap-1 bg-white px-1">
      <input
        ref={ref}
        value={draft}
        type={type}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className={cn(
          "h-[26px] w-full min-w-0 rounded-[5px] border border-[#3b82f6] bg-white px-2 text-xs text-[#111111] shadow-2xs outline-none focus:ring-1 focus:ring-[#3b82f6]",
          align === "right" && "text-right",
        )}
      />
    </div>
  );
}

interface SelectEditorProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onCommit: (value: T) => void;
  onCancel: () => void;
}

export function RecordCellSelectEditor<T extends string>({
  value,
  options,
  onCommit,
  onCancel,
}: SelectEditorProps<T>) {
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="flex h-full w-full items-center bg-white px-1">
      <select
        ref={ref}
        value={value}
        onChange={(event) => onCommit(event.target.value as T)}
        onBlur={onCancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="h-[26px] w-full min-w-0 rounded-[5px] border border-[#3b82f6] bg-white px-1.5 text-xs text-[#111111] shadow-2xs outline-none focus:ring-1 focus:ring-[#3b82f6]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

/** Индикатор сохранения inline-правки в углу ячейки. */
export function RecordCellStatus({ state }: { state: "saving" | "saved" | "error" }) {
  if (state === "saving") return <span className="ml-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />;
  if (state === "saved") return <Check className="ml-1 h-3 w-3 shrink-0 text-emerald-400" />;
  return <X className="ml-1 h-3 w-3 shrink-0 text-rose-400" />;
}
