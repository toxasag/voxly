"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Columns3,
  GripVertical,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RECORD_TABLE_CHECKBOX_WIDTH,
  RECORD_TABLE_COLUMN_MIN_WIDTH,
  RECORD_TABLE_ROW_HEIGHT,
} from "@/components/crm/shared/RecordCell";
import {
  columnVarName,
  useRecordTableLayout,
  type ColumnLayout,
} from "@/components/crm/shared/use-record-table-layout";
import { useIsMobile } from "@/lib/utils/use-is-mobile";

// ---------------------------------------------------------------------------
// Таблица записей по образцу Twenty (`RecordTable*`).
//
// Что перенесено из их исходников:
//
//  - геометрия: строка 32px, колонка чекбокса 28px, минимальная ширина колонки
//    104px, отступ контента ячейки 8px;
//
//  - ширины колонок живут в CSS-переменных `--rt-col-<id>`, а перетаскивание
//    пишет их напрямую в DOM (`style.setProperty`), минуя состояние React. У
//    Twenty это `updateRecordTableCSSVariable`, и причина не в стиле: при
//    записи в состояние каждый кадр перетаскивания перерисовывал бы все видимые
//    ячейки. В состояние ширина попадает один раз — на отпускании кнопки;
//
//  - первая колонка и колонка чекбокса залипают при горизонтальном скролле;
//
//  - три уровня взаимодействия, как у них: фокус строки → фокус ячейки →
//    редактирование. Фокус ячейки отделён от редактирования намеренно: он нужен,
//    чтобы ходить стрелками, не открывая редактор и не рискуя случайной правкой;
//
//  - стрелки влево/вправо переносят фокус через границу строки (у них
//    `useRecordTableMoveFocusedCell`), Enter открывает редактор, Escape
//    возвращает фокус ячейка → строка → таблица;
//
//  - клик по первой колонке открывает запись, а не редактор (их
//    `useOpenRecordTableCell`): правка первой колонки доступна только когда
//    значение пустое — иначе нельзя было бы назвать только что созданную строку.
//
// Отличия от Twenty, принятые сознательно:
//
//  - разметка на CSS Grid вместо вложенных flex-div: у нас нет их виртуализации,
//    а grid даёт то же залипание меньшим кодом;
//
//  - ширины, порядок и видимость колонок хранятся в localStorage, а не на
//    сервере. У Twenty это строки `ViewField` в БД, потому что представление
//    общее для рабочего пространства. У нас таблицы описаны кодом, серверной
//    сущности представления нет, и добавлять её ради ширины колонки — отдельная
//    работа (см. ROADMAP M7.5.16). Следствие: раскладка не переезжает между
//    браузерами, и это осознанный размен, а не недосмотр.
// ---------------------------------------------------------------------------

/**
 * Ширина схлопнутой первой колонки.
 *
 * 38px — начало значения видно, строка остаётся опознаваемой, а остальным
 * колонкам достаётся место. Меньше делать нечего: у`RECORD_TABLE_ROW_HEIGHT`
 * 32px, и колонка стала бы почти квадратной полосой без содержимого.
 */
const COLLAPSED_IDENTIFIER_WIDTH = 38;

export interface RecordColumn<T> {
  id: string;
  header: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Начальная ширина в px; ниже RECORD_TABLE_COLUMN_MIN_WIDTH не опускается. */
  width?: number;
  align?: "left" | "right";
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  /**
   * Колонку можно скрыть. Первая колонка (идентификатор записи) не скрывается —
   * у Twenty `canHide = isLabelIdentifier !== true`: без неё строку не опознать.
   */
  hideable?: boolean;
  /** Колонка скрыта по умолчанию, пока пользователь не включит её. */
  defaultHidden?: boolean;
}

export interface RecordTableProps<T> {
  rows: readonly T[];
  columns: readonly RecordColumn<T>[];
  getRowId: (row: T) => string;
  /**
   * Ключ раскладки колонок. Без него ширины и порядок не сохраняются между
   * визитами — таблица остаётся полностью рабочей, просто «забывчивой».
   */
  tableId?: string;
  /** Server-synced layout supplied by `SyncedRecordTable`; undefined keeps local-only mode. */
  remoteLayout?: ColumnLayout | null;
  onLayoutPersist?: (layout: ColumnLayout) => void;
  onRowClick?: (row: T) => void;
  /**
   * Открыть редактор ячейки: вызывается по Enter на ячейке в фокусе. Страницы
   * уже держат состояние правки как `{ rowId, columnId }`, поэтому таблице
   * достаточно сообщить, что редактор нужно открыть.
   */
  onCellEdit?: (row: T, columnId: string) => void;
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Итоговая строка снизу: у Twenty там агрегаты по колонкам. */
  footerCells?: Partial<Record<string, ReactNode>>;
  emptyState?: ReactNode;
  bulkBar?: ReactNode;
  pagination?: ReactNode;
  rowHeight?: number;
  scrollPaddingBottom?: string;
}

export function RecordTable<T>({
  rows,
  columns,
  getRowId,
  tableId,
  remoteLayout,
  onLayoutPersist,
  onRowClick,
  onCellEdit,
  selectable = false,
  selectedIds,
  onSelectionChange,
  footerCells,
  emptyState,
  bulkBar,
  pagination,
  rowHeight,
  scrollPaddingBottom = "pb-4",
}: RecordTableProps<T>) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState<"toolbar" | "headerPlus">("toolbar");
  const [columnSearch, setColumnSearch] = useState("");
  const [mounted, setMounted] = useState(false);

  const toolbarButtonRef = useRef<HTMLButtonElement>(null);
  const headerPlusButtonRef = useRef<HTMLButtonElement>(null);
  const [menuCoords, setMenuCoords] = useState<{
    top?: number;
    bottom?: number;
    right?: number;
    left?: number;
    maxHeight: number;
    placement: "bottom" | "top";
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const computeMenuCoords = useCallback((anchorEl: HTMLElement) => {
    const rect = anchorEl.getBoundingClientRect();
    const hasRealRect = rect.width > 0 || rect.height > 0 || rect.bottom > 0 || rect.right > 0;
    const isMobileView = typeof window !== "undefined" && window.innerWidth < 640;

    if (!hasRealRect) {
      return {
        top: 40,
        right: 8,
        maxHeight: 360,
        placement: "bottom" as const,
      };
    }

    if (isMobileView) {
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      return {
        top: rect.bottom + 4,
        left: 12,
        right: 12,
        maxHeight: Math.max(160, Math.min(380, spaceBelow)),
        placement: "bottom" as const,
      };
    }

    const right = Math.max(8, window.innerWidth - rect.right);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const preferredHeight = 340;

    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      return {
        bottom: window.innerHeight - rect.top + 4,
        right,
        maxHeight: Math.max(160, Math.min(preferredHeight, spaceAbove)),
        placement: "top" as const,
      };
    }

    return {
      top: rect.bottom + 4,
      right,
      maxHeight: Math.max(160, Math.min(preferredHeight, spaceBelow)),
      placement: "bottom" as const,
    };
  }, []);

  const updateMenuPosition = useCallback(() => {
    const anchorEl =
      columnsMenuAnchor === "toolbar"
        ? toolbarButtonRef.current
        : headerPlusButtonRef.current;
    if (!anchorEl) return;
    setMenuCoords(computeMenuCoords(anchorEl));
  }, [columnsMenuAnchor, computeMenuCoords]);

  const openColumnsMenu = useCallback(
    (anchor: "toolbar" | "headerPlus") => {
      setColumnsMenuAnchor(anchor);
      setColumnsMenuOpen((prev) => {
        const next = !prev;
        if (next) {
          const anchorEl =
            anchor === "toolbar" ? toolbarButtonRef.current : headerPlusButtonRef.current;
          if (anchorEl) {
            setMenuCoords(computeMenuCoords(anchorEl));
          }
        } else {
          setColumnSearch("");
        }
        return next;
      });
    },
    [computeMenuCoords],
  );

  useEffect(() => {
    if (!columnsMenuOpen) return;
    updateMenuPosition();

    const handleScrollOrResize = () => {
      updateMenuPosition();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setColumnsMenuOpen(false);
        setColumnSearch("");
      }
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [columnsMenuOpen, updateMenuPosition]);

  /**
   * Мобильный режим меняет не геометрию, а состав обработчиков, поэтому здесь
   * хук уместен, в отличие от структурной раскладки: вспышка при гидратации не
   * видна, потому что меняется доступность действий, а не положение элементов.
   *
   * Что отключается и почему:
   *  - чекбоксы: колонка выделения занимает 28px из 360px, а массовые операции
   *    пальцем всё равно неудобны;
   *  - ресайз: хват шириной 4px не берётся пальцем, зато перехватывает начало
   *    горизонтального скролла таблицы;
   *  - drag колонок: удержание для перетаскивания начинается тем же жестом, что
   *    и скролл доски, — таблица либо не скроллится, либо не переставляет
   *    колонки.
   *
   * Сортировка, меню колонок и сам скролл остаются: отключается ввод указателем,
   * а не возможности.
   */
  const isMobile = useIsMobile();

  /**
   * Первая колонка схлопывается, когда таблица прокручена вправо.
   *
   * Она залипающая, и на 360px экране её 260px не оставляют места остальным:
   * видно только её и обрезок соседней. В схлопнутом виде — 38px, чтобы строка
   * оставалась опознаваемой по началу значения, а подпись заголовка убирается:
   * в 38px она всё равно не читается, а обрезанный текст выглядит как ошибка
   * вёрстки.
   *
   * Только на мобильном: на десктопе места хватает, а прыгающая ширина колонки
   * мешала бы читать таблицу.
   */
  const [scrolled, setScrolled] = useState(false);
  const identifierCollapsed = isMobile && scrolled;

  // Выделение и перетаскивание доступны только на десктопе.
  const selectionEnabled = selectable && !isMobile;
  const columnDragEnabled = tableId !== undefined && !isMobile;

  // Ширины, порядок и видимость колонок — в `useRecordTableLayout`. Вынесено
  // отдельным хуком перед мобильным режимом: ветки для узкого экрана нужны и
  // раскладке, и разметке, а в одном файле их пришлось бы переносить дважды.
  const {
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
  } = useRecordTableLayout({
    columns,
    tableId,
    selectable: selectionEnabled,
    remoteLayout,
    onPersist: onLayoutPersist,
  });

  /**
   * Порядок пунктов меню колонок: сначала видимые в пользовательском порядке,
   * затем скрытые. Так включённая колонка остаётся на своём месте в списке, а не
   * прыгает в конец при выключении.
   */
  const menuColumns = useMemo(
    () => [...visibleColumns, ...hiddenColumns],
    [visibleColumns, hiddenColumns],
  );

  const hiddenIds = useMemo(
    () => new Set(hiddenColumns.map((column) => column.id)),
    [hiddenColumns],
  );

  const filteredMenuColumns = useMemo(() => {
    const q = columnSearch.trim().toLowerCase();
    if (!q) return menuColumns;
    return menuColumns.filter((col) => col.header.toLowerCase().includes(q));
  }, [menuColumns, columnSearch]);

  /**
   * Переменные ширины со схлопнутой первой колонкой.
   *
   * Переопределяется значение переменной, а не шаблон грида: так схлопывание
   * идёт тем же путём, что и ресайз, и браузер пересчитывает раскладку сам.
   */
  const appliedWidthVars = useMemo(() => {
    const identifier = visibleColumns[0];
    if (!identifierCollapsed || identifier === undefined) return widthVars;

    return {
      ...widthVars,
      [columnVarName(identifier.id)]: `${COLLAPSED_IDENTIFIER_WIDTH}px`,
    };
  }, [widthVars, visibleColumns, identifierCollapsed]);

  /**
   * Колонка-идентификатор: скрыть её нельзя никогда.
   *
   * Прежнее условие в меню было `column.hideable !== false`, и оно разрешало
   * скрыть первую колонку: флаг `hideable` не выставлен ни на одной странице, а
   * `undefined !== false` истинно. Пользователь мог убрать «ФИО» из таблицы
   * контактов и получить строки, в которых запись не опознать — при том что
   * комментарий к типу обещал обратное. Найдено тестом при вынесении раскладки.
   *
   * Берётся первая колонка из описания, а не первая в текущем порядке:
   * идентификатор — свойство самой колонки (у Twenty `isLabelIdentifier`), и
   * перестановка колонок его не меняет. Флаг `hideable: false` остаётся способом
   * запретить скрытие и другим колонкам.
   */
  const identifierColumnId = columns[0]?.id;
  const [dragColumnId, setDragColumnId] = useState<string | null>(null);
  const [dropColumnId, setDropColumnId] = useState<string | null>(null);

  /** Позиция фокуса ячейки: {row, column} в индексах, как у Twenty. */
  const [focus, setFocus] = useState<{ row: number; column: number } | null>(null);
  /** Фокус строки — уровень выше фокуса ячейки; Escape поднимается сюда. */
  const [focusedRow, setFocusedRow] = useState<number | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null);

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

  // -------------------------------------------------------------------------
  // Ресайз колонки
  // -------------------------------------------------------------------------

  const startResize = useCallback(
    (event: React.MouseEvent, column: RecordColumn<T>) => {
      event.preventDefault();
      event.stopPropagation();

      const startWidth = columnWidth(column);
      resizeRef.current = { columnId: column.id, startX: event.clientX, startWidth };

      const onMove = (moveEvent: MouseEvent): void => {
        const state = resizeRef.current;
        if (state === null || gridRef.current === null) return;

        const next = Math.max(
          RECORD_TABLE_COLUMN_MIN_WIDTH,
          state.startWidth + (moveEvent.clientX - state.startX),
        );
        // Прямая запись в DOM вместо setState: иначе каждый кадр перетаскивания
        // перерисовывал бы все видимые ячейки таблицы.
        gridRef.current.style.setProperty(columnVarName(state.columnId), `${next}px`);
      };

      const onUp = (upEvent: MouseEvent): void => {
        const state = resizeRef.current;
        resizeRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (state === null) return;

        const finalWidth = Math.round(
          Math.max(RECORD_TABLE_COLUMN_MIN_WIDTH, state.startWidth + (upEvent.clientX - state.startX)),
        );
        if (finalWidth === state.startWidth) return;

        commitWidth(state.columnId, finalWidth);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [columnWidth, commitWidth],
  );

  // -------------------------------------------------------------------------
  // Выделение строк
  // -------------------------------------------------------------------------

  const toggleAll = useCallback(() => {
    if (onSelectionChange === undefined || selectedIds === undefined) return;
    const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(getRowId(row)));
    onSelectionChange(allSelected ? new Set<string>() : new Set(rows.map(getRowId)));
  }, [rows, selectedIds, onSelectionChange, getRowId]);

  const toggleOne = useCallback(
    (id: string) => {
      if (onSelectionChange === undefined || selectedIds === undefined) return;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  // -------------------------------------------------------------------------
  // Клавиатура
  // -------------------------------------------------------------------------

  const moveFocus = useCallback(
    (deltaRow: number, deltaColumn: number) => {
      const lastColumn = visibleColumns.length - 1;
      const lastRow = sortedRows.length - 1;
      if (lastRow < 0 || lastColumn < 0) return;

      setFocus((current) => {
        if (current === null) return { row: 0, column: 0 };

        let { row, column } = current;

        if (deltaColumn !== 0) {
          column += deltaColumn;
          // Перенос через границу строки — поведение Twenty: вправо на последней
          // колонке уводит на начало следующей строки.
          if (column > lastColumn) {
            if (row === lastRow) return current;
            row += 1;
            column = 0;
          } else if (column < 0) {
            if (row === 0) return current;
            row -= 1;
            column = lastColumn;
          }
        }

        if (deltaRow !== 0) {
          row = Math.min(lastRow, Math.max(0, row + deltaRow));
        }

        return { row, column };
      });
    },
    [visibleColumns.length, sortedRows.length],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Пока открыт редактор внутри ячейки, таблица не должна перехватывать
      // клавиши: ввод текста и стрелки в поле принадлежат редактору.
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") {
        return;
      }

      const lastRow = sortedRows.length - 1;
      if (lastRow < 0) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          if (focus === null) {
            setFocusedRow((row) => (row === null ? 0 : Math.min(lastRow, row + 1)));
          } else {
            moveFocus(1, 0);
          }
          break;

        case "ArrowUp":
          event.preventDefault();
          if (focus === null) {
            setFocusedRow((row) => (row === null ? 0 : Math.max(0, row - 1)));
          } else {
            moveFocus(-1, 0);
          }
          break;

        case "ArrowRight":
          if (focus === null) return;
          event.preventDefault();
          moveFocus(0, 1);
          break;

        case "ArrowLeft":
          if (focus === null) return;
          event.preventDefault();
          moveFocus(0, -1);
          break;

        case "Enter": {
          event.preventDefault();
          // Enter на строке входит в неё (фокус первой ячейки), Enter на ячейке
          // открывает редактор — два шага, как у Twenty.
          if (focus === null) {
            const row = focusedRow ?? 0;
            setFocusedRow(row);
            setFocus({ row, column: 0 });
            return;
          }

          const row = sortedRows[focus.row];
          const column = visibleColumns[focus.column];
          if (row !== undefined && column !== undefined) onCellEdit?.(row, column.id);
          break;
        }

        case "Escape":
          event.preventDefault();
          if (focus !== null) {
            setFocusedRow(focus.row);
            setFocus(null);
          } else {
            setFocusedRow(null);
          }
          break;

        case " ":
          if (!selectionEnabled || focusedRow === null) return;
          event.preventDefault();
          {
            const row = sortedRows[focus?.row ?? focusedRow];
            if (row !== undefined) toggleOne(getRowId(row));
          }
          break;

        default:
          break;
      }
    },
    [focus, focusedRow, sortedRows, visibleColumns, moveFocus, onCellEdit, selectionEnabled, toggleOne, getRowId],
  );

  // Сброс фокуса при смене набора строк: индексы указывали бы на другие записи,
  // и Enter открыл бы редактор не там, куда смотрел пользователь.
  useEffect(() => {
    setFocus(null);
    setFocusedRow(null);
  }, [rows]);

  const effectiveRowHeight = rowHeight ?? RECORD_TABLE_ROW_HEIGHT;

  if (rows.length === 0 && emptyState !== undefined) return <>{emptyState}</>;

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds?.has(getRowId(row)) === true);
  const stickyLeft = selectionEnabled ? RECORD_TABLE_CHECKBOX_WIDTH : 0;

  return (
    <div className="space-y-3">
      {selectionEnabled && selectedIds !== undefined && selectedIds.size > 0 && bulkBar}

      <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white">
        {/* Управление колонками: у Twenty это кнопка «+» в правой части шапки и кнопка «Колонки». */}
        {tableId !== undefined && layoutLoaded && (
          <div className="relative flex items-center justify-end border-b border-[#e5e5e5] bg-white px-2 py-1">
            <button
              ref={toolbarButtonRef}
              type="button"
              title="Управление колонками"
              onClick={() => openColumnsMenu("toolbar")}
              aria-expanded={columnsMenuOpen && columnsMenuAnchor === "toolbar"}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs text-[#666666] transition-colors hover:bg-[#fafafa] hover:text-[#111111]"
            >
              <Columns3 className="h-3.5 w-3.5" />
              Колонки
              {hiddenColumns.length > 0 && (
                <span className="rounded bg-[#f0f0f0] px-1 text-xs text-[#666666]">
                  скрыто {hiddenColumns.length}
                </span>
              )}
            </button>
          </div>
        )}

        <div
          className={cn("overflow-x-auto", scrollPaddingBottom)}
          // Порог 0, а не запас: колонка возвращается ровно в начале прокрутки,
          // и промежуточное состояние выглядело бы как подрагивание.
          onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)}
        >
          <div
            ref={gridRef}
            style={appliedWidthVars}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onBlur={(event) => {
              // Уход фокуса из таблицы снимает подсветку: иначе рамка висела бы
              // на ячейке, к которой клавиши больше не относятся.
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setFocus(null);
                setFocusedRow(null);
              }
            }}
            className="min-w-max outline-none"
          >
            {/* Заголовок */}
            <div
              className="grid border-b border-[#e5e5e5] bg-white text-xs font-medium text-[#666666] select-none uppercase"
              style={{ gridTemplateColumns: gridTemplate, height: `${RECORD_TABLE_ROW_HEIGHT}px` }}
            >
              {selectionEnabled && (
                <div className="sticky left-0 z-20 flex items-center justify-center bg-white border-r border-[#e5e5e5]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Выбрать все"
                    className="h-3.5 w-3.5 rounded-[4px] border border-[#d1d5db] text-[#111111] accent-[#111111] cursor-pointer"
                  />
                </div>
              )}
              {visibleColumns.map((column, index) => (
                <div
                  key={column.id}
                  draggable={columnDragEnabled && index > 0}
                  onDragStart={(event) => {
                    setDragColumnId(column.id);
                    event.dataTransfer.effectAllowed = "move";
                    // Данные обязательны: без setData Firefox не начинает перенос.
                    event.dataTransfer.setData("text/plain", column.id);
                  }}
                  onDragOver={(event) => {
                    if (dragColumnId === null || dragColumnId === column.id) return;
                    // Первая колонка не принимает перенос: у Twenty идентификатор
                    // записи закреплён и не участвует в сортировке колонок.
                    if (index === 0) return;
                    event.preventDefault();
                    setDropColumnId(column.id);
                  }}
                  onDragLeave={() => setDropColumnId((current) => (current === column.id ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragColumnId !== null && index > 0) moveColumn(dragColumnId, column.id);
                    setDragColumnId(null);
                    setDropColumnId(null);
                  }}
                  onDragEnd={() => { setDragColumnId(null); setDropColumnId(null); }}
                  className={cn(
                    "group relative flex items-center overflow-hidden border-r border-[#e5e5e5] px-2.5 text-[12px] font-medium text-[#666666] bg-white transition-colors",
                    index === 0 && "sticky z-20 bg-white border-r border-[#e5e5e5]",
                    column.align === "right" && "justify-end",
                    dragColumnId === column.id && "opacity-40",
                    dropColumnId === column.id && "shadow-[inset_2px_0_0_#3b82f6]",
                    columnDragEnabled && index > 0 && "cursor-grab active:cursor-grabbing",
                  )}
                  style={index === 0 ? { left: stickyLeft } : undefined}
                >
                  {columnDragEnabled && index > 0 && (
                    <GripVertical className="mr-1 h-3 w-3 shrink-0 text-[#cccccc] opacity-0 transition-opacity group-hover:opacity-100" />
                  )}

                  {column.sortValue !== undefined ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (sortColumn === column.id) setSortAsc((prev) => !prev);
                        else {
                          setSortColumn(column.id);
                          setSortAsc(false);
                        }
                      }}
                      className={cn(
                        "flex min-w-0 items-center gap-1.5 truncate text-[12px] font-medium transition-colors hover:text-[#111111] cursor-pointer",
                        sortColumn === column.id ? "text-[#111111]" : "text-[#666666]",
                      )}
                    >
                      {/*
                        В схлопнутом виде подпись убирается: в 38px она всё равно
                        не читается, а обрезанный текст выглядит как ошибка
                        вёрстки. Индикатор сортировки остаётся — он показывает,
                        что таблица отсортирована.
                      */}
                      {column.icon && !(index === 0 && identifierCollapsed) && (
                        <column.icon className="h-3.5 w-3.5 shrink-0 text-[#737373]" />
                      )}
                      {!(index === 0 && identifierCollapsed) && (
                        <span className="truncate">{column.header}</span>
                      )}
                      {sortColumn === column.id && (
                        <span className="shrink-0 text-[#111111]">
                          {sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </span>
                      )}
                    </button>
                  ) : (
                    !(index === 0 && identifierCollapsed) && (
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] font-medium text-[#666666]">
                        {column.icon && <column.icon className="h-3.5 w-3.5 shrink-0 text-[#737373]" />}
                        <span className="truncate">{column.header}</span>
                      </span>
                    )
                  )}

                  {/*
                    Хват ресайза у правой границы — только на десктопе: полоса
                    с запасом для захвата курсором и подсветкой при наведении.
                  */}
                  {!isMobile && (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={(event) => startResize(event, column)}
                      className="absolute -right-1 top-0 h-full w-2 cursor-col-resize z-20 hover:bg-[#3b82f6]/40 transition-colors"
                    />
                  )}
                </div>
              ))}
              <div className="relative border-r border-[#e5e5e5] flex items-center justify-center text-[#888888]">
                {tableId !== undefined && layoutLoaded ? (
                  <button
                    ref={headerPlusButtonRef}
                    type="button"
                    onClick={() => openColumnsMenu("headerPlus")}
                    aria-label="Добавить колонку"
                    title="Добавить колонку"
                    aria-expanded={columnsMenuOpen && columnsMenuAnchor === "headerPlus"}
                    className="flex h-full w-full items-center justify-center text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <Plus className="h-3.5 w-3.5 opacity-60" />
                )}
              </div>
            </div>

            {/* Строки */}
            {sortedRows.map((row, rowIndex) => {
              const id = getRowId(row);
              const isSelected = selectionEnabled && selectedIds?.has(id) === true;
              const isRowFocused = focusedRow === rowIndex || focus?.row === rowIndex;

              return (
                <div
                  key={id}
                  onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
                  className={cn(
                    "group grid border-b border-[#e5e5e5] text-sm text-[#111111] transition-colors",
                    isSelected
                      ? "bg-[#f0f9ff] shadow-[inset_2px_0_0_#3b82f6]"
                      : isRowFocused
                        ? "bg-[#fafafa]"
                        : "bg-white hover:bg-[#fafafa]",
                    onRowClick !== undefined && "cursor-pointer",
                  )}
                  style={{ gridTemplateColumns: gridTemplate, minHeight: `${effectiveRowHeight}px` }}
                >
                  {selectionEnabled && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="sticky left-0 z-10 flex items-center justify-center bg-inherit border-r border-[#e5e5e5]"
                      style={{ minHeight: `${effectiveRowHeight}px` }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(id)}
                        aria-label="Выбрать строку"
                        className={cn(
                          "h-3.5 w-3.5 rounded-[4px] border border-[#d1d5db] text-[#111111] accent-[#111111] transition-opacity cursor-pointer",
                          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                        )}
                      />
                    </div>
                  )}
                  {visibleColumns.map((column, columnIndex) => {
                    const isCellFocused = focus?.row === rowIndex && focus.column === columnIndex;

                    return (
                      <div
                        key={column.id}
                        onMouseDown={() => {
                          // Клик ставит фокус ячейки, чтобы стрелки продолжили
                          // движение с того места, куда пользователь смотрел.
                          setFocus({ row: rowIndex, column: columnIndex });
                          setFocusedRow(rowIndex);
                        }}
                        className={cn(
                          "min-w-0 overflow-hidden border-r border-[#e5e5e5] flex items-center relative",
                          columnIndex === 0 && "sticky z-10 bg-inherit border-r border-[#e5e5e5]",
                          isCellFocused && "ring-1 ring-[#3b82f6] rounded-[3px] -m-px bg-white z-20",
                        )}
                        style={columnIndex === 0 ? { left: stickyLeft, minHeight: `${effectiveRowHeight}px` } : { minHeight: `${effectiveRowHeight}px` }}
                      >
                        {column.render(row)}
                      </div>
                    );
                  })}
                  <div className="border-r border-transparent" />
                </div>
              );
            })}

            {/* Итоговая строка с агрегатами */}
            {footerCells !== undefined && (
              <div
                className="grid border-t border-[#e5e5e5] bg-[#fafafa] text-sm font-normal text-[#666666]"
                style={{ gridTemplateColumns: gridTemplate, height: `${RECORD_TABLE_ROW_HEIGHT}px` }}
              >
                {selectionEnabled && <div className="sticky left-0 z-10 bg-[#fafafa] border-r border-[#e5e5e5]" />}
                {visibleColumns.map((column, index) => (
                  <div
                    key={column.id}
                    className={cn(
                      "flex items-center overflow-hidden border-r border-[#e5e5e5] pl-2.5 pr-1 text-xs text-[#666666]",
                      index === 0 && "sticky z-10 bg-[#fafafa]",
                      column.align === "right" && "justify-end",
                    )}
                    style={index === 0 ? { left: stickyLeft } : undefined}
                  >
                    {footerCells[column.id]}
                  </div>
                ))}
                <div className="border-r border-transparent" />
              </div>
            )}
          </div>
        </div>

        {pagination}
      </div>

      {/* Меню управления колонками на верхнем слое (Portal в document.body) */}
      {mounted && columnsMenuOpen && typeof document !== "undefined" && createPortal(
        <>
          {/* Подложка закрывает меню по клику вне */}
          <div
            aria-hidden="true"
            onClick={() => {
              setColumnsMenuOpen(false);
              setColumnSearch("");
            }}
            className="fixed inset-0 z-[9998] cursor-default bg-transparent"
          />

          <div
            role="dialog"
            aria-label="Управление колонками"
            style={
              menuCoords
                ? menuCoords.placement === "top"
                  ? {
                      bottom: `${menuCoords.bottom}px`,
                      right: menuCoords.right !== undefined ? `${menuCoords.right}px` : undefined,
                      left: menuCoords.left !== undefined ? `${menuCoords.left}px` : undefined,
                      maxHeight: `${menuCoords.maxHeight}px`,
                    }
                  : {
                      top: `${menuCoords.top}px`,
                      right: menuCoords.right !== undefined ? `${menuCoords.right}px` : undefined,
                      left: menuCoords.left !== undefined ? `${menuCoords.left}px` : undefined,
                      maxHeight: `${menuCoords.maxHeight}px`,
                    }
                : { top: 40, right: 8, maxHeight: 360 }
            }
            className={cn(
              "fixed z-[9999] flex flex-col overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xl text-left",
              isMobile ? "w-full max-w-[calc(100vw-1rem)]" : "w-56",
            )}
          >
            {/* Поиск полей (Twenty CRM style) */}
            <div className="shrink-0 border-b border-[#f0f0f0] p-2 bg-white">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#888888]" />
                <input
                  type="text"
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  placeholder="Поиск полей"
                  className="w-full rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] py-1.5 pl-8 pr-2.5 text-xs text-[#111111] placeholder:text-[#888888] outline-none transition-colors focus:border-[#4a38f5] focus:bg-white"
                  autoFocus
                />
              </div>
            </div>

            {/* Список полей */}
            <div className="flex-1 overflow-y-auto p-1 space-y-0.5 bg-white min-h-[60px]">
              {filteredMenuColumns.length === 0 ? (
                <div className="px-3 py-3 text-center text-xs text-[#888888]">
                  Поля не найдены
                </div>
              ) : (
                filteredMenuColumns.map((column) => {
                  const isHidden = hiddenIds.has(column.id);
                  const canHide =
                    column.id !== identifierColumnId && column.hideable !== false;
                  const IconComponent = column.icon;

                  return (
                    <button
                      key={column.id}
                      type="button"
                      disabled={!canHide}
                      onClick={() => toggleColumn(column.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors",
                        canHide
                          ? "text-[#111111] hover:bg-[#f5f5f5] cursor-pointer"
                          : "cursor-default text-[#888888]",
                        !isHidden && canHide && "font-medium text-[#111111]",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {IconComponent ? (
                          <IconComponent className="h-4 w-4 shrink-0 text-[#666666]" />
                        ) : (
                          <Columns3 className="h-4 w-4 shrink-0 text-[#666666]" />
                        )}
                        <span className="truncate">{column.header}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 pl-2">
                        {!canHide ? (
                          <span className="text-[11px] text-[#888888]">всегда</span>
                        ) : !isHidden ? (
                          <Check className="h-3.5 w-3.5 text-[#4a38f5]" />
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Нижняя кнопка сброса раскладки */}
            <button
              type="button"
              title="Сбросить раскладку к значениям по умолчанию"
              onClick={() => {
                resetLayout();
                setColumnsMenuOpen(false);
                setColumnSearch("");
              }}
              className="shrink-0 flex w-full items-center gap-2 border-t border-[#f0f0f0] bg-white px-3 py-2 text-left text-xs text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <Settings className="h-3.5 w-3.5 text-[#888888]" />
              <span>Сбросить раскладку</span>
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
