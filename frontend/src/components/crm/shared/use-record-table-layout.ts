"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  RECORD_TABLE_CHECKBOX_WIDTH,
  RECORD_TABLE_COLUMN_MIN_WIDTH,
} from "@/components/crm/shared/RecordCell";
import type { RecordColumn } from "@/components/crm/shared/RecordTable";

// ---------------------------------------------------------------------------
// Раскладка колонок таблицы записей: ширины, порядок, видимость.
//
// Вынесено из `RecordTable.tsx` (817 строк) как условие мобильного режима:
// мобильные ветки добавляются и в раскладку, и в разметку, и в одном файле их
// пришлось бы переносить дважды — сначала внутрь, потом наружу при вынесении.
//
// Граница проведена по ответственности, а не по объёму: здесь состояние и
// вычисления, которые не зависят от разметки и не знают ни про фокус ячеек, ни
// про выделение строк, ни про сортировку. Всё это осталось в компоненте, потому
// что живёт вместе с обработчиками клавиатуры и DOM.
//
// Источник истины — сервер (`GET/PUT /crm/table-layouts/:tableId`), а
// localStorage остаётся fallback: мгновенный отклик, миграция старых раскладок
// и работа без сети. Remote побеждает local всегда, иначе устройство с устаревшим
// кэшем затёрло бы раскладку, уже сохранённую с другого браузера.
// ---------------------------------------------------------------------------

/** Версия в ключе: при смене формата раскладки старая молча игнорируется. */
export const LAYOUT_STORAGE_PREFIX = "getvoxly.recordTable.v1.";

/** Режим отображения списка: часть представления, как ширины и порядок колонок. */
export type RecordViewMode = "kanban" | "table" | "calendar";

export interface ColumnLayout {
  widths: Record<string, number>;
  order: string[];
  hidden: string[];
  /**
   * Необязательное: раскладки, сохранённые до появления поля, остаются годными.
   * Пустое значение читается как «режим по умолчанию».
   */
  viewMode?: RecordViewMode;
  /** Ширина колонки канбана, px. Как `size` у Twenty RecordBoard. */
  kanbanColumnWidth?: number;
  /** Индивидуальные ширины колонок канбана по этапам (stageId -> width). */
  kanbanColumnWidths?: Record<string, number>;
}

/** Имя CSS-переменной ширины колонки. */
export function columnVarName(columnId: string): string {
  return `--rt-col-${columnId}`;
}

/**
 * Чтение раскладки из хранилища.
 *
 * Запись годна только целиком: раньше поля разбирались по отдельности с
 * подстановкой значений по умолчанию, и структура вида `{widths: "нет", order:
 * 42}` давала `hidden: []`. Это не безобидно — пустой список **затирал** колонки
 * с `defaultHidden`, и скрытая по умолчанию колонка становилась видимой у
 * пользователя с испорченной записью.
 *
 * Дефект перенесён вместе с кодом из `RecordTable.tsx` и найден тестом при
 * вынесении. Внутри одной версии формата (`v1.` в ключе) все три поля обязательны:
 * их всегда пишет наш же код, поэтому отсутствие или неверный тип означает, что
 * запись негодна, а не что поле «по умолчанию».
 */
export function readLegacyRecordTableLayout(tableId: string | undefined): ColumnLayout | null {
  if (tableId === undefined || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(`${LAYOUT_STORAGE_PREFIX}${tableId}`);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const candidate = parsed as Partial<ColumnLayout>;

    const { widths, order, hidden, viewMode, kanbanColumnWidth, kanbanColumnWidths } = candidate;

    if (typeof widths !== "object" || widths === null || Array.isArray(widths)) return null;
    if (!Array.isArray(order) || !Array.isArray(hidden)) return null;

    const validViewMode =
      viewMode === "kanban" || viewMode === "table" || viewMode === "calendar" ? viewMode : undefined;
    const validKanbanWidth =
      typeof kanbanColumnWidth === "number" &&
      Number.isInteger(kanbanColumnWidth) &&
      kanbanColumnWidth >= 200 &&
      kanbanColumnWidth <= 480
        ? kanbanColumnWidth
        : undefined;

    const validKanbanWidths =
      typeof kanbanColumnWidths === "object" && kanbanColumnWidths !== null && !Array.isArray(kanbanColumnWidths)
        ? (kanbanColumnWidths as Record<string, number>)
        : undefined;

    return {
      widths,
      order,
      hidden,
      ...(validViewMode === undefined ? {} : { viewMode: validViewMode }),
      ...(validKanbanWidth === undefined ? {} : { kanbanColumnWidth: validKanbanWidth }),
      ...(validKanbanWidths === undefined ? {} : { kanbanColumnWidths: validKanbanWidths }),
    };
  } catch {
    // Битый JSON или запрещённый localStorage (приватный режим) не должны ронять
    // таблицу: раскладка — это удобство, а не данные.
    return null;
  }
}

export function writeLegacyRecordTableLayout(tableId: string | undefined, layout: ColumnLayout): void {
  if (tableId === undefined || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      `${LAYOUT_STORAGE_PREFIX}${tableId}`,
      JSON.stringify(layout),
    );
  } catch {
    // Переполненное или недоступное хранилище — не повод прерывать работу.
  }
}

interface UseRecordTableLayoutInput<T> {
  columns: readonly RecordColumn<T>[];
  /**
   * Ключ раскладки. Без него ширины и порядок не сохраняются между визитами —
   * таблица остаётся полностью рабочей, просто «забывчивой».
   */
  tableId: string | undefined;
  /** Влияет только на шаблон грида: колонка чекбоксов идёт первой. */
  selectable: boolean;
  /** Раскладка с сервера; побеждает локальную после успешного GET. */
  remoteLayout?: ColumnLayout | null;
  /** Сохранение на сервер после локального отклика; localStorage остаётся fallback. */
  onPersist?: (layout: ColumnLayout) => void;
}

export interface RecordTableLayout<T> {
  /** Видимые колонки в пользовательском порядке. */
  visibleColumns: RecordColumn<T>[];
  hiddenColumns: RecordColumn<T>[];
  /** `false`, пока раскладка не прочитана из хранилища. */
  layoutLoaded: boolean;
  columnWidth: (column: RecordColumn<T>) => number;
  /** `grid-template-columns` со ссылками на CSS-переменные. */
  gridTemplate: string;
  /** Значения переменных ширины — ставятся на контейнер грида. */
  widthVars: Record<string, string>;
  moveColumn: (fromId: string, toId: string) => void;
  toggleColumn: (columnId: string) => void;
  resetLayout: () => void;
  /** Записать ширину после перетаскивания; во время него DOM меняется напрямую. */
  commitWidth: (columnId: string, width: number) => void;
}

export function useRecordTableLayout<T>({
  columns,
  tableId,
  selectable,
  remoteLayout,
  onPersist,
}: UseRecordTableLayoutInput<T>): RecordTableLayout<T> {
  const [layout, setLayout] = useState<ColumnLayout>(() => ({
    widths: {},
    order: [],
    hidden: columns
      .filter((column) => column.defaultHidden === true)
      .map((column) => column.id),
  }));
  const [layoutLoaded, setLayoutLoaded] = useState(false);

  // Раскладка читается в эффекте, а не в инициализаторе состояния: при SSR
  // localStorage недоступен, и чтение на первом рендере расходилось бы с
  // разметкой сервера (ошибка гидратации).
  useEffect(() => {
    if (remoteLayout !== undefined) {
      // `null` означает «на сервере ещё нет настройки»: legacy localStorage
      // остаётся кандидатом для миграции, но не выдаётся за remote-истину.
      if (remoteLayout !== null) {
        setLayout(remoteLayout);
        writeLegacyRecordTableLayout(tableId, remoteLayout);
      } else {
        const stored = readLegacyRecordTableLayout(tableId);
        if (stored !== null) {
          setLayout((previous) => ({
            widths: { ...previous.widths, ...stored.widths },
            order: stored.order,
            hidden: stored.hidden,
          }));
        }
      }
      setLayoutLoaded(true);
      return;
    }

    const stored = readLegacyRecordTableLayout(tableId);
    if (stored !== null) {
      setLayout((previous) => ({
        widths: { ...previous.widths, ...stored.widths },
        order: stored.order,
        hidden: stored.hidden,
      }));
    }
    setLayoutLoaded(true);
  }, [tableId, remoteLayout]);

  const persist = useCallback(
    (next: ColumnLayout) => {
      setLayout(next);
      writeLegacyRecordTableLayout(tableId, next);
      onPersist?.(next);
    },
    [tableId, onPersist],
  );

  /**
   * Видимые колонки в пользовательском порядке.
   *
   * Колонки, которых нет в сохранённом порядке, добавляются в конец: так новая
   * колонка в коде появляется у пользователя со старой раскладкой, а не теряется.
   */
  const visibleColumns = useMemo(() => {
    const byId = new Map(columns.map((column) => [column.id, column]));
    const ordered: RecordColumn<T>[] = [];

    for (const id of layout.order) {
      const column = byId.get(id);
      if (column !== undefined) {
        ordered.push(column);
        byId.delete(id);
      }
    }
    for (const column of columns) {
      if (byId.has(column.id)) ordered.push(column);
    }

    return ordered.filter((column) => !layout.hidden.includes(column.id));
  }, [columns, layout.order, layout.hidden]);

  const hiddenColumns = useMemo(
    () => columns.filter((column) => layout.hidden.includes(column.id)),
    [columns, layout.hidden],
  );

  const columnWidth = useCallback(
    (column: RecordColumn<T>): number => {
      const explicitMin =
        column.width !== undefined && column.width < RECORD_TABLE_COLUMN_MIN_WIDTH
          ? column.width
          : RECORD_TABLE_COLUMN_MIN_WIDTH;
      return Math.max(
        explicitMin,
        layout.widths[column.id] ?? column.width ?? 160,
      );
    },
    [layout.widths],
  );

  /**
   * Шаблон грида ссылается на переменные, а не на числа: тогда перетаскивание
   * меняет только значение переменной в DOM, и браузер пересчитывает раскладку
   * без участия React.
   */
  const gridTemplate = useMemo(
    () =>
      [
        selectable ? `${RECORD_TABLE_CHECKBOX_WIDTH}px` : null,
        ...visibleColumns.map((column) => `var(${columnVarName(column.id)})`),
        "minmax(0, 1fr)",
      ]
        .filter((value): value is string => value !== null)
        .join(" "),
    [visibleColumns, selectable],
  );

  const widthVars = useMemo(() => {
    const style: Record<string, string> = {};
    for (const column of visibleColumns) {
      style[columnVarName(column.id)] = `${columnWidth(column)}px`;
    }
    return style;
  }, [visibleColumns, columnWidth]);

  /**
   * Порядок с дополнением: сохранённый список фильтруется от исчезнувших колонок
   * и дополняется новыми из кода.
   */
  const currentOrder = useCallback((): string[] => {
    const ordered = layout.order.filter((id) =>
      columns.some((column) => column.id === id),
    );
    for (const column of columns) {
      if (!ordered.includes(column.id)) ordered.push(column.id);
    }
    return ordered;
  }, [columns, layout.order]);

  const moveColumn = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;

      const order = currentOrder();
      const fromIndex = order.indexOf(fromId);
      const toIndex = order.indexOf(toId);
      if (fromIndex === -1 || toIndex === -1) return;

      order.splice(fromIndex, 1);
      order.splice(toIndex, 0, fromId);

      persist({ ...layout, order });
    },
    [currentOrder, layout, persist],
  );

  const toggleColumn = useCallback(
    (columnId: string) => {
      const hidden = layout.hidden.includes(columnId)
        ? layout.hidden.filter((id) => id !== columnId)
        : [...layout.hidden, columnId];

      persist({ ...layout, hidden });
    },
    [layout, persist],
  );

  const resetLayout = useCallback(() => {
    persist({
      widths: {},
      order: [],
      hidden: columns
        .filter((column) => column.defaultHidden === true)
        .map((column) => column.id),
    });
  }, [columns, persist]);

  const commitWidth = useCallback(
    (columnId: string, width: number) => {
      // Минимум применяется и здесь: колонка в разметке уже не уже 104px, и
      // сохранённое меньшее значение дало бы расхождение между тем, что видно, и
      // тем, что записано.
      const next = Math.max(RECORD_TABLE_COLUMN_MIN_WIDTH, Math.round(width));
      persist({ ...layout, widths: { ...layout.widths, [columnId]: next } });
    },
    [layout, persist],
  );

  return {
    visibleColumns,
    hiddenColumns,
    layoutLoaded,
    columnWidth,
    gridTemplate,
    widthVars,
    moveColumn,
    toggleColumn,
    resetLayout,
    commitWidth,
  };
}
