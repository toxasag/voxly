"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Ячейка таблицы записей по образцу Twenty (`RecordTableCell*`).
//
// Три состояния, как у них: display → focus (клик или стрелки, тонкая рамка) →
// edit (инпут поверх ячейки). Focus вынесен отдельно от edit намеренно: он
// нужен, чтобы стрелками ходить по таблице, не открывая редактор и не рискуя
// случайной правкой.
//
// Геометрия из их констант: строка 32px, отступ контента 8px, границы
// красятся прозрачным цветом вместо `border: none` — иначе строка дёргалась бы
// на 1px при переходе между состояниями.
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
  align?: "left" | "right";
  /**
   * Ячейка первой колонки (идентификатор записи).
   *
   * У Twenty (`useOpenRecordTableCell`) клик по ней открывает запись, а не
   * редактор — но только если значение непустое: у свежесозданной строки имя
   * пустое, и её нужно как-то назвать. Здесь то же правило: при непустом
   * значении клик всплывает к строке и открывает карточку, при пустом —
   * открывает редактор.
   */
  isLabelIdentifier?: boolean;
}

export function RecordCellShell({
  children,
  emptyLabel,
  isEmpty = false,
  editable = false,
  onStartEdit,
  align = "left",
  isLabelIdentifier = false,
}: RecordCellShellProps) {
  // Первая колонка с непустым значением отдаёт клик строке: карточка важнее
  // правки, а переименовать запись можно из самой карточки.
  const opensOnClick = isLabelIdentifier && !isEmpty;
  const canEdit = editable && !opensOnClick;

  // Своего tabIndex у ячейки нет намеренно.
  //
  // Раньше ячейка была фокусируемой и держала фокус в локальном состоянии, а
  // таблица — свой, в позиции {row, column}. Две реализации конфликтовали:
  // клик по ячейке забирал DOM-фокус у сетки, её обработчик клавиш перестава́л
  // получать события, и стрелки после первого нажатия уводили фокус в body.
  // Проверено в браузере — перенос фокуса через границу строки не работал.
  //
  // Теперь, как у Twenty, фокус целиком принадлежит таблице: ячейка только
  // отображает значение и открывает редактор по клику.
  return (
    <div
      onClick={
        canEdit
          ? (event) => {
              // Клик не должен дойти до строки: иначе он одновременно открыл бы
              // редактор ячейки и карточку записи. У Twenty та же развилка —
              // редактируемая ячейка забирает клик себе, первая колонка отдаёт.
              event.stopPropagation();
              onStartEdit?.();
            }
          : undefined
      }
      className={cn(
        "flex h-full items-center overflow-hidden whitespace-nowrap pl-2 pr-1 outline-none",
        align === "right" && "justify-end",
        canEdit && "cursor-text",
        opensOnClick && "cursor-pointer",
      )}
    >
      {isEmpty && emptyLabel !== undefined ? (
        <span className="pl-1 text-[#999999] text-xs font-normal">Указать {emptyLabel}</span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
      )}
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
  align?: "left" | "right";
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
          "h-6 w-full min-w-0 rounded border border-[#3b82f6] bg-white px-1.5 text-xs text-[#111111] shadow-2xs outline-none",
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
    <div className="flex h-full items-center gap-1 bg-white px-1">
      <select
        ref={ref}
        value={value}
        onChange={(event) => onCommit(event.target.value as T)}
        onBlur={onCancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="h-6 w-full min-w-0 rounded border border-[#3b82f6] bg-white px-1 text-xs text-[#111111] shadow-2xs outline-none"
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
