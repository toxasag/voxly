import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";

// ---------------------------------------------------------------------------
// Таблица записей на мобильном.
//
// Здесь `useIsMobile` уместен, в отличие от структурной раскладки: меняется не
// геометрия, а **состав обработчиков** — чекбоксы, ресайз-хваты, перетаскивание
// колонок. Вспышка при гидратации не видна, потому что меняется доступность
// действий, а не положение элементов (`docs/01_05_UI_CONVENTIONS.md`, раздел 2).
//
// Почему каждое отключение нужно:
//
//  - **чекбоксы**: колонка выделения занимает 28px из 360px, а массовые операции
//    на телефоне всё равно неудобны — их место в desktop-режиме;
//  - **ресайз**: хват шириной 4px пальцем не берётся, зато перехватывает начало
//    горизонтального скролла таблицы;
//  - **drag колонок**: удержание для перетаскивания конфликтует с тем же
//    скроллом — жест начинается одинаково, и таблица либо не скроллится, либо не
//    переставляет колонки.
//
// Горизонтальный скролл и sticky-колонка уже работали (`overflow-x-auto` +
// `min-w-max`), поэтому здесь проверяется, что мобильный режим их не сломал.
// ---------------------------------------------------------------------------

const matchMediaMock = vi.fn();

interface Row {
  id: string;
  name: string;
  phone: string;
}

const ROWS: Row[] = [
  { id: "1", name: "Иван Петров", phone: "+79161234567" },
  { id: "2", name: "Анна Сидорова", phone: "+79167654321" },
];

const COLUMNS: RecordColumn<Row>[] = [
  { id: "name", header: "ФИО", width: 260, render: (row) => row.name },
  { id: "phone", header: "Телефон", width: 180, render: (row) => row.phone },
];

/** Подменяет `matchMedia`: мобильный режим определяется `max-width: 767px`. */
function setViewport(mobile: boolean): void {
  matchMediaMock.mockImplementation((query: string) => ({
    matches: mobile ? query.includes("max-width") : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

  vi.stubGlobal("matchMedia", matchMediaMock);
}

function renderTable(props: Partial<Parameters<typeof RecordTable<Row>>[0]> = {}) {
  return render(
    <RecordTable
      rows={ROWS}
      columns={COLUMNS}
      getRowId={(row) => row.id}
      tableId="mobile-test"
      {...props}
    />,
  );
}

beforeEach(() => {
  matchMediaMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Выделение строк на мобильном", () => {
  it("не рендерит чекбоксы", () => {
    setViewport(true);
    renderTable({ selectable: true, selectedIds: new Set<string>(), onSelectionChange: vi.fn() });

    // Колонка выделения занимает 28px из 360px, а массовые операции на телефоне
    // всё равно неудобны.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("на десктопе чекбоксы остаются", () => {
    setViewport(false);
    renderTable({ selectable: true, selectedIds: new Set<string>(), onSelectionChange: vi.fn() });

    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("не оставляет пустую колонку под чекбоксы в сетке", () => {
    setViewport(true);
    const { container } = renderTable({
      selectable: true,
      selectedIds: new Set<string>(),
      onSelectionChange: vi.fn(),
    });

    // Иначе слева осталась бы полоса 28px без содержимого — хуже, чем чекбоксы.
    const header = container.querySelector<HTMLElement>("[style*='grid-template-columns']");
    expect(header?.style.gridTemplateColumns.startsWith("28px")).toBe(false);
  });
});

describe("Ресайз колонок на мобильном", () => {
  it("не рендерит хваты", () => {
    setViewport(true);
    const { container } = renderTable();

    // Хват 4px пальцем не берётся, зато перехватывает начало горизонтального
    // скролла таблицы.
    expect(container.querySelectorAll(".cursor-col-resize")).toHaveLength(0);
  });

  it("на десктопе хваты есть", () => {
    setViewport(false);
    const { container } = renderTable();

    expect(container.querySelectorAll(".cursor-col-resize").length).toBeGreaterThan(0);
  });
});

describe("Перетаскивание колонок на мобильном", () => {
  it("колонки не перетаскиваются", () => {
    setViewport(true);
    const { container } = renderTable();

    // Удержание для перетаскивания конфликтует с горизонтальным скроллом: жест
    // начинается одинаково.
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it("на десктопе перетаскиваются все, кроме первой", () => {
    setViewport(false);
    const { container } = renderTable();

    // Первая колонка — идентификатор, она всегда первая.
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(1);
  });
});

describe("Меню колонок на мобильном", () => {
  it("разворачивается на всю ширину, а не уходит за экран", async () => {
    setViewport(true);
    renderTable();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Колонки/ }));

    // `w-56` с `absolute right-2` на 360px экране прижимает меню к краю и часть
    // подписей уезжает за границу.
    const menu = screen.getByRole("button", { name: /Сбросить раскладку/ }).parentElement;
    expect(menu?.className).toContain("w-full");
    expect(menu?.className).not.toContain("w-56");
  });

  it("на десктопе остаётся компактным", async () => {
    setViewport(false);
    renderTable();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Колонки/ }));

    const menu = screen.getByRole("button", { name: /Сбросить раскладку/ }).parentElement;
    expect(menu?.className).toContain("w-56");
  });
});

describe("Схлопывание первой колонки при скролле", () => {
  /**
   * Прокручивает контейнер таблицы.
   *
   * `fireEvent.scroll`, а не `dispatchEvent`: React не подхватывает `scroll`,
   * посланный напрямую, — проверено, обработчик не вызывается вовсе, и первая
   * версия теста падала на верной реализации.
   */
  function scrollTable(container: HTMLElement, scrollLeft: number): void {
    const scroller = container.querySelector<HTMLElement>(".overflow-x-auto");
    if (scroller === null) throw new Error("Контейнер прокрутки не найден");

    fireEvent.scroll(scroller, { target: { scrollLeft } });
  }

  it("сужает первую колонку после начала прокрутки", () => {
    setViewport(true);
    const { container } = renderTable();

    const grid = container.querySelector<HTMLElement>("[style*='--rt-col-name']");
    expect(grid?.style.getPropertyValue("--rt-col-name")).toBe("260px");

    scrollTable(container, 40);

    // Залипающая колонка 260px из 360px не оставляет места остальным: видно
    // только её и обрезок соседней.
    expect(grid?.style.getPropertyValue("--rt-col-name")).toBe("38px");
  });

  it("возвращает ширину при возврате прокрутки в начало", () => {
    setViewport(true);
    const { container } = renderTable();

    scrollTable(container, 40);
    scrollTable(container, 0);

    const grid = container.querySelector<HTMLElement>("[style*='--rt-col-name']");
    expect(grid?.style.getPropertyValue("--rt-col-name")).toBe("260px");
  });

  it("скрывает подпись заголовка в схлопнутом виде", () => {
    setViewport(true);
    const { container } = renderTable();

    expect(screen.getByText("ФИО")).toBeDefined();

    scrollTable(container, 40);

    // В 38px подпись всё равно не читается, а обрезанный текст выглядит как
    // ошибка вёрстки.
    expect(screen.queryByText("ФИО")).toBeNull();
  });

  it("на десктопе ширина не меняется при прокрутке", () => {
    setViewport(false);
    const { container } = renderTable();

    scrollTable(container, 40);

    // Там места хватает, а прыгающая ширина колонки мешала бы читать таблицу.
    const grid = container.querySelector<HTMLElement>("[style*='--rt-col-name']");
    expect(grid?.style.getPropertyValue("--rt-col-name")).toBe("260px");
    expect(screen.getByText("ФИО")).toBeDefined();
  });
});

describe("Что мобильный режим не ломает", () => {
  it("сохраняет горизонтальный скролл и минимальную ширину", () => {
    setViewport(true);
    const { container } = renderTable();

    // Скролл — единственный способ дойти до правых колонок на узком экране.
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
    expect(container.querySelector(".min-w-max")).not.toBeNull();
  });

  it("оставляет первую колонку залипающей", () => {
    setViewport(true);
    const { container } = renderTable();

    // Без залипания при скролле вправо непонятно, к какой записи относится
    // строка.
    expect(container.querySelectorAll(".sticky").length).toBeGreaterThan(0);
  });

  it("сохраняет сортировку и меню колонок", async () => {
    setViewport(true);
    renderTable({
      columns: [
        { id: "name", header: "ФИО", sortValue: (row) => row.name, render: (row) => row.name },
        { id: "phone", header: "Телефон", render: (row) => row.phone },
      ],
    });

    // Отключается ввод указателем, а не возможности: сортировка нажатием и
    // управление колонками работают одинаково на любом экране.
    expect(screen.getByRole("button", { name: /ФИО/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Колонки/ })).toBeDefined();
  });

  it("рендерит все значения строк", () => {
    setViewport(true);
    renderTable();

    expect(screen.getByText("Иван Петров")).toBeDefined();
    expect(screen.getByText("+79167654321")).toBeDefined();
  });
});
