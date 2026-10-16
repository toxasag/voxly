import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LAYOUT_STORAGE_PREFIX,
  useRecordTableLayout,
} from "@/components/crm/shared/use-record-table-layout";
import { RECORD_TABLE_COLUMN_MIN_WIDTH } from "@/components/crm/shared/RecordCell";
import type { RecordColumn } from "@/components/crm/shared/RecordTable";

// ---------------------------------------------------------------------------
// Раскладка колонок таблицы записей.
//
// Хук вынесен из `RecordTable.tsx` (817 строк) как условие мобильного режима:
// мобильные ветки добавляются и в раскладку, и в разметку, и в одном файле их
// пришлось бы переносить дважды — сначала внутрь, потом наружу при вынесении.
//
// Проверяется то, что легко сломать незаметно:
//
//  - новая колонка в коде появляется у пользователя со старой раскладкой, а не
//    теряется: сохранённый порядок не содержит её id;
//  - удалённая из кода колонка не «висит» в сохранённом порядке;
//  - битый JSON и запрещённый localStorage (приватный режим) не роняют таблицу:
//    раскладка — удобство, а не данные;
//  - ширина не опускается ниже минимума ни из сохранённого значения, ни из
//    перетаскивания.
//
// Чтение идёт в эффекте, а не в инициализаторе состояния: при SSR localStorage
// недоступен, и чтение на первом рендере расходилось бы с разметкой сервера.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  name: string;
  phone: string;
  note: string;
}

const COLUMNS: RecordColumn<Row>[] = [
  { id: "name", header: "Имя", width: 200, render: (row) => row.name },
  { id: "phone", header: "Телефон", width: 160, hideable: true, render: (row) => row.phone },
  { id: "note", header: "Заметка", width: 240, hideable: true, defaultHidden: true, render: (row) => row.note },
];

const TABLE_ID = "contacts";
const STORAGE_KEY = `${LAYOUT_STORAGE_PREFIX}${TABLE_ID}`;

function storedLayout(): { widths: Record<string, number>; order: string[]; hidden: string[] } | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/**
 * `tableId` передаётся объектом, а не позиционным аргументом со значением по
 * умолчанию: `tableId = TABLE_ID` подставлялось и на явный `undefined`, поэтому
 * тест «без tableId» на самом деле работал с ключом и проверял не то, что заявлял.
 */
function render(
  options: { columns?: RecordColumn<Row>[]; tableId?: string | undefined } = {},
) {
  const columns = options.columns ?? COLUMNS;
  const tableId = "tableId" in options ? options.tableId : TABLE_ID;

  return renderHook(() => useRecordTableLayout({ columns, tableId, selectable: false }));
}

beforeEach(() => {
  window.localStorage.clear();
});


afterEach(() => {
  window.localStorage.clear();
});

describe("Начальное состояние", () => {
  it("скрывает колонки с defaultHidden", () => {
    const { result } = render();

    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["name", "phone"]);
    expect(result.current.hiddenColumns.map((column) => column.id)).toEqual(["note"]);
  });

  it("сообщает о загруженной раскладке", () => {
    const { result } = render();

    // Флаг нужен разметке: меню колонок не рендерится, пока раскладка не прочитана,
    // иначе оно мигало бы составом на первом кадре.
    expect(result.current.layoutLoaded).toBe(true);
  });

  it("берёт ширину из описания колонки", () => {
    const { result } = render();

    expect(result.current.columnWidth(COLUMNS[0]!)).toBe(200);
  });

  it("не опускает ширину ниже минимума", () => {
    const narrow: RecordColumn<Row>[] = [{ id: "name", header: "Имя", width: 10, render: (row) => row.name }];

    const { result } = render({ columns: narrow });

    expect(result.current.columnWidth(narrow[0]!)).toBe(RECORD_TABLE_COLUMN_MIN_WIDTH);
  });
});

describe("Чтение сохранённой раскладки", () => {
  it("применяет ширины, порядок и скрытые колонки", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ widths: { name: 320 }, order: ["phone", "name"], hidden: ["note"] }),
    );

    const { result } = render();

    expect(result.current.columnWidth(COLUMNS[0]!)).toBe(320);
    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["phone", "name"]);
  });

  it("добавляет новую колонку кода в конец, а не теряет её", () => {
    // Сохранённый порядок из времён, когда колонки «note» ещё не было.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ widths: {}, order: ["phone", "name"], hidden: [] }),
    );

    const { result } = render();

    // Иначе выпуск новой колонки не увидел бы никто из существующих
    // пользователей — у всех сохранена прежняя раскладка.
    expect(result.current.visibleColumns.map((column) => column.id)).toEqual([
      "phone",
      "name",
      "note",
    ]);
  });

  it("игнорирует колонку, которой больше нет в коде", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ widths: {}, order: ["removed", "name", "phone"], hidden: [] }),
    );

    const { result } = render();

    expect(result.current.visibleColumns.map((column) => column.id)).toEqual([
      "name",
      "phone",
      "note",
    ]);
  });

  it("не падает на битом JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{это не json");

    const { result } = render();

    // Раскладка — удобство, а не данные: испорченная запись означает возврат к
    // значениям по умолчанию, а не сломанную таблицу.
    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["name", "phone"]);
  });

  it("не падает на структуре неверного вида", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ widths: "нет", order: 42 }));

    const { result } = render();

    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["name", "phone"]);
  });

  it("без tableId ничего не читает и не пишет", () => {
    const { result } = render({ tableId: undefined });

    act(() => result.current.toggleColumn("phone"));

    // Таблица остаётся рабочей, просто «забывчивой»: ключа нет — сохранять некуда.
    expect(window.localStorage.length).toBe(0);
    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["name"]);
  });
});

describe("Изменение раскладки", () => {
  it("скрывает и возвращает колонку", () => {
    const { result } = render();

    act(() => result.current.toggleColumn("phone"));
    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["name"]);

    act(() => result.current.toggleColumn("phone"));
    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["name", "phone"]);
  });

  it("сохраняет скрытие в localStorage", () => {
    const { result } = render();

    act(() => result.current.toggleColumn("phone"));

    expect(storedLayout()?.hidden).toContain("phone");
  });

  it("переставляет колонки", () => {
    const { result } = render();

    act(() => result.current.moveColumn("phone", "name"));

    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["phone", "name"]);
    expect(storedLayout()?.order).toEqual(["phone", "name", "note"]);
  });

  it("игнорирует перестановку колонки на себя", () => {
    const { result } = render();

    act(() => result.current.moveColumn("name", "name"));

    expect(storedLayout()).toBeNull();
  });

  it("возвращает раскладку к значениям по умолчанию", () => {
    const { result } = render();

    act(() => result.current.toggleColumn("phone"));
    act(() => result.current.moveColumn("phone", "name"));
    act(() => result.current.resetLayout());

    // Сброс возвращает и `defaultHidden`, а не просто показывает всё: колонка
    // «Заметка» скрыта по умолчанию осознанно.
    expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["name", "phone"]);
    expect(result.current.hiddenColumns.map((column) => column.id)).toEqual(["note"]);
  });

  it("сохраняет ширину после перетаскивания", () => {
    const { result } = render();

    act(() => result.current.commitWidth("name", 280));

    expect(result.current.columnWidth(COLUMNS[0]!)).toBe(280);
    expect(storedLayout()?.widths.name).toBe(280);
  });

  it("не сохраняет ширину ниже минимума", () => {
    const { result } = render();

    act(() => result.current.commitWidth("name", 10));

    // Колонка уже 104px в разметке; сохранённые 10px после перезагрузки дали бы
    // расхождение между тем, что видно, и тем, что записано.
    expect(storedLayout()?.widths.name).toBe(RECORD_TABLE_COLUMN_MIN_WIDTH);
  });
});

describe("Шаблон грида", () => {
  it("ссылается на CSS-переменные, а не на числа", () => {
    const { result } = render();

    // Перетаскивание меняет значение переменной прямо в DOM, минуя React: запись
    // в состояние перерисовывала бы все видимые ячейки на каждый кадр.
    expect(result.current.gridTemplate).toBe("var(--rt-col-name) var(--rt-col-phone) minmax(0, 1fr)");
    expect(result.current.widthVars).toEqual({
      "--rt-col-name": "200px",
      "--rt-col-phone": "160px",
    });
  });

  it("добавляет колонку чекбоксов, когда выделение включено", () => {
    const { result } = renderHook(() =>
      useRecordTableLayout({ columns: COLUMNS, tableId: TABLE_ID, selectable: true }),
    );

    expect(result.current.gridTemplate.startsWith("28px ")).toBe(true);
  });
});
