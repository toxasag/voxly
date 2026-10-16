import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";

// ---------------------------------------------------------------------------
// Типографика строк таблицы записей.
//
// Дефект: строка не задавала размер текста, поэтому ячейки наследовали базовый
// 16px от `body`, тогда как заголовок колонок набран `text-xs` (12px), а вся
// остальная оболочка — `text-sm` (14px). На четырёх страницах CRM
// (контакты, компании, сделки, задачи) это читалось как «шрифт в карточках
// сильно крупный» и «вёрстка косая»: 16px в ячейке рядом с 12px заголовком.
//
// Проверяется класс на строке, а не вычисленный размер: jsdom не считает
// каскад, а размер наследуется — единственный надёжный признак это явный класс.
// ---------------------------------------------------------------------------

vi.mock("@/lib/utils/use-is-mobile", () => ({
  useIsMobile: () => false,
}));

interface Row {
  id: string;
  name: string;
  phone: string;
}

const ROWS: Row[] = [
  { id: "1", name: "Иван Петров", phone: "+7 916 000-00-00" },
  { id: "2", name: "ООО Ромашка", phone: "+7 916 111-11-11" },
];

const COLUMNS: RecordColumn<Row>[] = [
  { id: "name", header: "Имя", render: (row) => <span>{row.name}</span> },
  { id: "phone", header: "Телефон", render: (row) => <span>{row.phone}</span> },
];

function renderTable() {
  return render(
    <RecordTable rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />,
  );
}

describe("Типографика RecordTable", () => {
  it("строка данных задаёт text-sm, а не наследует 16px от body", () => {
    renderTable();

    const cell = screen.getByText("Иван Петров");
    const row = cell.closest(".grid");

    expect(row).not.toBeNull();
    expect(row?.className).toContain("text-sm");
  });

  it("заголовок колонок остаётся text-xs — контраст шкалы сохраняется", () => {
    const { container } = renderTable();

    const header = [...container.querySelectorAll("div")].find((node) =>
      node.className.includes("uppercase"),
    );

    expect(header).not.toBeUndefined();
    expect(header?.className).toContain("text-xs");
  });

  it("строки без данных и итоговая строка тоже в text-sm", () => {
    const { container } = renderTable();

    const grids = [...container.querySelectorAll(".grid")].filter(
      (node) => !node.className.includes("uppercase"),
    );

    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) {
      expect(grid.className).toContain("text-sm");
    }
  });
});
