import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DealsToolbar } from "@/components/crm/deals/DealsToolbar";
import { defaultDealCardFields } from "@/components/crm/deals/deal-card-fields";

// ---------------------------------------------------------------------------
// Тулбар сделок на мобильном.
//
// В одном ряду восемь контролов: воронка, переключатель вида, поиск, сводка «N
// сделок: сумма», меню «⋯», «НАСТРОИТЬ» и «НОВАЯ СДЕЛКА». На 360px они переносятся
// в четыре строки и вытесняют саму доску за пределы экрана.
//
// Ключевая проверка файла — не то, что лишнее скрыто, а то, что скрытое осталось
// **доступным**: воронка и сводка переезжают в меню «⋯», иначе на телефоне нельзя
// было бы ни сменить воронку, ни узнать, сколько денег в ней лежит. Скрыть, не
// перенеся, было бы не адаптацией, а потерей функций.
//
// Проверяются классы и состав меню: jsdom не считает раскладку, а переносы строк
// замерены в браузере отдельно.
// ---------------------------------------------------------------------------

const PIPELINES = [
  { id: "pipe-1", name: "Основная", sortOrder: 0 },
  { id: "pipe-2", name: "Партнёры", sortOrder: 1 },
];

function renderToolbar(overrides: Partial<Parameters<typeof DealsToolbar>[0]> = {}) {
  return render(
    <DealsToolbar
      pipelines={PIPELINES}
      pipelineId="pipe-1"
      onPipelineChange={vi.fn()}
      view="kanban"
      onViewChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      searchInputRef={createRef<HTMLInputElement>()}
      summaryCount={12}
      summarySum={1500000}
      sortBy="created"
      onSortChange={vi.fn()}
      autoRefresh={false}
      onAutoRefreshChange={vi.fn()}
      appearance={defaultDealCardFields()}
      onAppearanceChange={vi.fn()}
      bulkEnabled={false}
      onBulkToggle={vi.fn()}
      configureMode={false}
      onConfigureToggle={vi.fn()}
      onExport={vi.fn()}
      duplicates={[]}
      onCreateDeal={vi.fn()}
      {...overrides}
    />,
  );
}

async function openMoreMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Дополнительные действия" }));
  return user;
}

describe("Что остаётся в ряду на мобильном", () => {
  it("поиск занимает всю ширину и идёт первым", () => {
    renderToolbar();

    const search = screen.getByPlaceholderText("Поиск и фильтр");
    const wrapper = search.parentElement;

    // `order-first`: поиск — главный контрол страницы, он должен быть первым, а не
    // после переключателя вида.
    expect(wrapper?.className).toContain("order-first");
    expect(wrapper?.className).toContain("w-full");
    expect(wrapper?.className).toContain("md:order-none");
  });

  it("переключатель вида остаётся видимым", () => {
    renderToolbar();

    // Канбан против списка — выбор пользователя, а не режим по ширине экрана.
    expect(screen.getByTitle("Канбан")).toBeDefined();
    expect(screen.getByTitle("Список")).toBeDefined();
  });

  it("кнопка создания остаётся, но без подписи", () => {
    renderToolbar();

    const label = screen.getByText("НОВАЯ СДЕЛКА");

    // Подпись занимает треть ряда, а иконка «плюс» узнаваема сама.
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("md:inline");
  });
});

describe("Что уходит из ряда", () => {
  it("селектор воронки скрыт", () => {
    renderToolbar();

    const select = screen.getByRole("combobox");
    expect(select.parentElement?.className).toContain("hidden");
    expect(select.parentElement?.className).toContain("md:block");
  });

  it("сводка скрыта в ряду", () => {
    renderToolbar();

    // Ищем именно вариант из ряда: в меню «⋯» есть такой же текст.
    const rowSummary = screen
      .getAllByText(/сделок:/)
      .map((node) => node.parentElement)
      .find((node) => node?.className.includes("border-slate-800"));

    expect(rowSummary?.className).toContain("hidden");
    expect(rowSummary?.className).toContain("md:block");
  });

  it("режим настройки этапов скрыт", () => {
    renderToolbar();

    const configure = screen.getByRole("button", { name: "НАСТРОИТЬ" });

    // Режим строится на перетаскивании и inline-правке названий в узких колонках
    // доски — пальцем это не работает.
    expect(configure.className).toContain("hidden");
    expect(configure.className).toContain("md:flex");
  });
});

describe("Скрытое остаётся доступным в меню", () => {
  it("воронки выбираются из меню", async () => {
    const onPipelineChange = vi.fn();
    renderToolbar({ onPipelineChange });

    const user = await openMoreMenu();
    // `MenuItem` рендерится с ролью `menuitem`, а не `button`.
    await user.click(screen.getByRole("menuitem", { name: /Партнёры/ }));

    // Без этого на телефоне нельзя было бы сменить воронку вообще.
    expect(onPipelineChange).toHaveBeenCalledWith("pipe-2");
  });

  it("активная воронка отмечена в меню", async () => {
    renderToolbar();
    await openMoreMenu();

    // Иначе непонятно, какая воронка открыта: в ряду селектора уже нет.
    const active = screen.getByRole("menuitem", { name: /Основная/ });
    expect(active).toBeDefined();
  });

  it("сводка по воронке видна в меню", async () => {
    renderToolbar();
    await openMoreMenu();

    // Сводка отвечает на вопрос «сколько денег в воронке» — потерять её нельзя.
    const inMenu = screen.getAllByText(/сделок:/);
    expect(inMenu.length).toBeGreaterThanOrEqual(2);
  });

  it("блок воронки и сводки скрыт на десктопе", async () => {
    renderToolbar();
    await openMoreMenu();

    // На десктопе они есть в ряду, и дублировать их в меню значило бы предлагать
    // два пути к одному.
    // `MenuLabel` — сам `div`, поэтому обёртка блока это его родитель, а не
    // родитель родителя: на уровень выше уже панель меню целиком.
    const label = screen.getByText("Воронка");
    expect(label.parentElement?.className).toContain("md:hidden");
  });

  it("прежние пункты меню на месте", async () => {
    renderToolbar();
    await openMoreMenu();

    expect(screen.getByRole("menuitem", { name: /Экспорт/ })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Поиск дублей/ })).toBeDefined();
    expect(screen.getByText("Сортировка")).toBeDefined();
  });
});
