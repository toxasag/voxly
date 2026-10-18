import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";
import { LAYOUT_STORAGE_PREFIX } from "@/components/crm/shared/use-record-table-layout";

// ---------------------------------------------------------------------------
// Таблица записей после вынесения раскладки в `useRecordTableLayout`.
//
// Тесты на сам хук проверяют вычисления; этот проверяет, что компонент ими
// действительно пользуется. Без него вынесение легко разошлось бы: хук зелёный,
// а таблица по-прежнему считает колонки сама или получает их, но не применяет.
//
// Проверяется то, что видит пользователь: состав колонок, меню видимости, сброс
// раскладки, сохранение между визитами. Ресайз мышью здесь не проверяется — он
// работает через `mousemove` по `window` и прямую запись CSS-переменной в DOM,
// jsdom геометрию не считает, и проверка выродилась бы в сверку строки стиля.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  name: string;
  phone: string;
  note: string;
}

const ROWS: Row[] = [
  { id: "1", name: "Иван Петров", phone: "+79161234567", note: "Первый" },
  { id: "2", name: "Анна Сидорова", phone: "+79167654321", note: "Второй" },
];

const COLUMNS: RecordColumn<Row>[] = [
  { id: "name", header: "Имя", width: 200, render: (row) => row.name },
  { id: "phone", header: "Телефон", width: 160, hideable: true, render: (row) => row.phone },
  {
    id: "note",
    header: "Заметка",
    width: 240,
    hideable: true,
    defaultHidden: true,
    render: (row) => row.note,
  },
];

const TABLE_ID = "test-table";

function renderTable(props: Partial<Parameters<typeof RecordTable<Row>>[0]> = {}) {
  return render(
    <RecordTable
      rows={ROWS}
      columns={COLUMNS}
      getRowId={(row) => row.id}
      tableId={TABLE_ID}
      {...props}
    />,
  );
}

/**
 * Рендерит таблицу и открывает меню колонок.
 *
 * Рендер внутри помощника, а не в вызывающем тесте: первая версия его пропускала,
 * и пять тестов падали на «кнопка не найдена» — искали в пустом документе.
 */
async function openColumnsMenu() {
  renderTable();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Колонки/ }));
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Состав колонок", () => {
  it("показывает колонки и скрывает defaultHidden", () => {
    renderTable();

    expect(screen.getByText("Имя")).toBeDefined();
    expect(screen.getByText("Телефон")).toBeDefined();
    // «Заметка» скрыта по умолчанию — в заголовках её нет.
    expect(screen.queryByText("Заметка")).toBeNull();
  });

  it("рендерит значения строк", () => {
    renderTable();

    expect(screen.getByText("Иван Петров")).toBeDefined();
    expect(screen.getByText("+79167654321")).toBeDefined();
    // Значение скрытой колонки не рендерится вовсе, а не прячется стилем.
    expect(screen.queryByText("Первый")).toBeNull();
  });

  it("ставит ширины колонок CSS-переменными", () => {
    const { container } = renderTable();

    // Переменные, а не числа в шаблоне: перетаскивание меняет значение прямо в
    // DOM, минуя React, иначе каждый кадр перерисовывал бы все ячейки.
    const grid = container.querySelector<HTMLElement>("[style*='--rt-col-name']");
    expect(grid).not.toBeNull();
    expect(grid?.style.getPropertyValue("--rt-col-name")).toBe("200px");
    expect(grid?.style.getPropertyValue("--rt-col-phone")).toBe("160px");
  });
});

describe("Меню колонок", () => {
  it("сообщает число скрытых колонок", () => {
    renderTable();

    expect(screen.getByText(/скрыто 1/)).toBeDefined();
  });

  it("скрывает колонку по нажатию", async () => {
    const user = await openColumnsMenu();

    await user.click(screen.getByRole("button", { name: /^Телефон/ }));

    expect(screen.queryByText("+79161234567")).toBeNull();
  });

  it("возвращает скрытую колонку", async () => {
    const user = await openColumnsMenu();

    await user.click(screen.getByRole("button", { name: /^Заметка/ }));

    expect(screen.getByText("Первый")).toBeDefined();
  });

  it("не даёт скрыть первую колонку", async () => {
    await openColumnsMenu();

    // У Twenty `canHide = isLabelIdentifier !== true`: без колонки-идентификатора
    // строку не опознать. У нас это `hideable`, не заданный у первой колонки.
    // Проверка через свойство, а не через атрибут: React ставит `disabled`
    // свойством элемента, и `getAttribute` вернул бы `null` даже у выключенной
    // кнопки.
    const menuItem = screen.getByRole("button", { name: /^Имя/ });
    expect((menuItem as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("всегда")).toBeDefined();
  });

  it("сбрасывает раскладку к значениям по умолчанию", async () => {
    const user = await openColumnsMenu();

    await user.click(screen.getByRole("button", { name: /^Телефон/ }));
    expect(screen.queryByText("+79161234567")).toBeNull();

    // Меню остаётся открытым после переключения колонки, поэтому «Сбросить»
    // доступно сразу.
    await user.click(screen.getByRole("button", { name: /Сбросить раскладку/ }));

    // Сброс возвращает и `defaultHidden`: «Заметка» скрыта осознанно, а не
    // случайно.
    expect(screen.getByText("+79161234567")).toBeDefined();
    expect(screen.queryByText("Первый")).toBeNull();
  });

  it("фильтрует список полей в меню по поисковому запросу", async () => {
    const user = await openColumnsMenu();

    const searchInput = screen.getByPlaceholderText("Поиск полей");
    await user.type(searchInput, "Тел");

    expect(screen.getByRole("button", { name: /^Телефон/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Заметка/ })).toBeNull();
  });

  it("открывает меню колонок по клику на кнопку плюс в заголовке", async () => {
    renderTable();
    const user = userEvent.setup();

    const plusButton = screen.getByRole("button", { name: "Добавить колонку" });
    await user.click(plusButton);

    expect(screen.getByPlaceholderText("Поиск полей")).toBeDefined();
    expect(screen.getByRole("button", { name: /^Телефон/ })).toBeDefined();
  });
});

describe("Сохранение раскладки", () => {
  it("пишет изменения в localStorage", async () => {
    const user = await openColumnsMenu();

    await user.click(screen.getByRole("button", { name: /^Телефон/ }));

    const raw = window.localStorage.getItem(`${LAYOUT_STORAGE_PREFIX}${TABLE_ID}`);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}").hidden).toContain("phone");
  });

  it("применяет сохранённую раскладку при следующем визите", () => {
    window.localStorage.setItem(
      `${LAYOUT_STORAGE_PREFIX}${TABLE_ID}`,
      JSON.stringify({ widths: { name: 320 }, order: ["phone", "name"], hidden: [] }),
    );

    const { container } = renderTable();

    const grid = container.querySelector<HTMLElement>("[style*='--rt-col-name']");
    expect(grid?.style.getPropertyValue("--rt-col-name")).toBe("320px");

    // Порядок из хранилища: «Телефон» перед «Имя», и «Заметка» больше не скрыта.
    const headers = screen.getAllByText(/^(Имя|Телефон|Заметка)$/).map((node) => node.textContent);
    expect(headers).toEqual(["Телефон", "Имя", "Заметка"]);
  });

  it("без tableId меню колонок не показывает", () => {
    renderTable({ tableId: undefined });

    // Сохранять некуда — управление раскладкой теряет смысл, и кнопка не
    // рендерится, чтобы не обещать того, что не сохранится.
    expect(screen.queryByRole("button", { name: /Колонки/ })).toBeNull();
  });
});

describe("Выделение строк", () => {
  it("вызывает обработчик выбора всех", async () => {
    const onSelectionChange = vi.fn();
    renderTable({ selectable: true, selectedIds: new Set<string>(), onSelectionChange });

    const user = userEvent.setup();
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!);

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(["1", "2"]));
  });

  it("добавляет колонку чекбоксов в сетку", () => {
    const { container } = renderTable({
      selectable: true,
      selectedIds: new Set<string>(),
      onSelectionChange: vi.fn(),
    });

    const header = container.querySelector<HTMLElement>("[style*='grid-template-columns']");
    expect(header?.style.gridTemplateColumns.startsWith("28px")).toBe(true);
  });
});

describe("Сортировка", () => {
  it("сортирует по колонке при нажатии на заголовок", async () => {
    const columns: RecordColumn<Row>[] = [
      { id: "name", header: "Имя", sortValue: (row) => row.name, render: (row) => row.name },
    ];

    const { container } = render(
      <RecordTable rows={ROWS} columns={columns} getRowId={(row) => row.id} />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByText("Имя"));

    // Первое нажатие даёт убывающий порядок (`sortAsc` стартует с `false`):
    // на списках чаще нужно «сначала новые», а не «сначала А».
    const descending = within(container).getAllByText(/Иван Петров|Анна Сидорова/);
    expect(descending[0]?.textContent).toBe("Иван Петров");

    // Второе нажатие переворачивает порядок.
    await user.click(screen.getByText("Имя"));
    const ascending = within(container).getAllByText(/Иван Петров|Анна Сидорова/);
    expect(ascending[0]?.textContent).toBe("Анна Сидорова");
  });
});
