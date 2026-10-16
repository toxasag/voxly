import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DealCard } from "@/components/crm/deals/DealCard";
import { RecordDetailShell } from "@/components/crm/shared/RecordDetailShell";
import type { DealDTO } from "@/lib/api/use-deals";

// ---------------------------------------------------------------------------
// Карточка сделки в канбане и оболочка карточки записи на мобильном.
//
// Главное здесь — не отключение перетаскивания само по себе, а то, что при этом
// остаётся способ перенести сделку. Стрелки переноса были под `opacity-0
// group-hover`, то есть появлялись только по наведению курсора: отключив drag на
// мобильном и не тронув их, канбан остался бы вообще без способа сменить этап.
// Найдено при чтении кода, а не тестом — тест закрепляет.
//
// Оболочка карточки: `max-w-[500px]` на 360px экране ничего не ограничивает, но
// рамка слева выглядит как обрезанное окно, а кнопка закрытия 28px ниже минимума
// 44px для касания — при том что на телефоне это единственный способ закрыть
// карточку, потому что фона за ней не видно.
// ---------------------------------------------------------------------------

const matchMediaMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function setViewport(mobile: boolean): void {
  matchMediaMock.mockImplementation((query: string) => ({
    matches: mobile ? query.includes("max-width") : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

  vi.stubGlobal("matchMedia", matchMediaMock);
}

const deal = {
  id: "deal-1",
  pipelineId: "pipe-1",
  stageId: "stage-1",
  contactId: null,
  companyId: null,
  title: "Ремонт кофемашины",
  description: "Клиент спрашивал про сроки",
  budget: 15000,
  currency: "RUB",
  customFields: {},
  createdBy: "user-1",
  ownerId: "user-1",
  closeDate: null,
  position: 0,
  closedAt: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  companyName: "Акме",
  contactName: "Иван Петров",
  ownerName: "Менеджер",
} as DealDTO;

function renderCard() {
  return render(
    <DealCard
      deal={deal}
      stageName="Новый лид"
      isWon={false}
      isLost={false}
      manager={undefined}
      onMove={vi.fn()}
      canMoveLeft
      canMoveRight
    />,
  );
}

function renderShell() {
  return render(
    <RecordDetailShell
      name="Иван Петров"
      createdAt="2026-09-01T10:00:00.000Z"
      onClose={vi.fn()}
      tabs={[{ id: "main", label: "Главная", content: <p>Содержимое</p> }]}
      ariaLabel="Карточка контакта"
    />,
  );
}

beforeEach(() => {
  matchMediaMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Карточка сделки на мобильном", () => {
  it("не перетаскивается", () => {
    setViewport(true);
    const { container } = renderCard();

    // Перетаскивание пальцем конфликтует с горизонтальным скроллом доски: жест
    // начинается одинаково.
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });

  it("на десктопе перетаскивается", () => {
    setViewport(false);
    const { container } = renderCard();

    expect(container.querySelector('[draggable="true"]')).not.toBeNull();
  });

  it("показывает стрелки переноса без наведения", () => {
    setViewport(true);
    renderCard();

    // Ровно то, из-за чего отключение drag могло стать дефектом: стрелки были под
    // `opacity-0 group-hover`, и на телефоне канбан остался бы вообще без способа
    // сменить этап сделки. Название этапа рядом со стрелками — обычный текст, а не
    // подпись элемента, поэтому ищем по тексту.
    expect(screen.getByText("Новый лид")).toBeDefined();
  });

  it("контейнер стрелок непрозрачен на мобильном", () => {
    setViewport(true);
    const { container } = renderCard();

    const arrowRow = container.querySelector<HTMLElement>(".opacity-100");
    expect(arrowRow).not.toBeNull();
    expect(arrowRow?.className).toContain("md:opacity-0");
  });

  it("область нажатия стрелок не меньше 36px на мобильном", () => {
    setViewport(true);
    const { container } = renderCard();

    // `h-9 w-9` — 36px: меньше рекомендованных 44px, но карточка узкая, и две
    // стрелки по 44px вытеснили бы название этапа между ними.
    const buttons = [...container.querySelectorAll("button")];
    const moveButtons = buttons.filter((b) => b.className.includes("h-9"));
    expect(moveButtons).toHaveLength(2);
  });
});

describe("Оболочка карточки записи на мобильном", () => {
  it("занимает всю ширину экрана", () => {
    setViewport(true);
    renderShell();

    const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;

    // Ширина панели настраивается ресайзом и живёт в CSS-переменной, но только
    // с `md:`: на 360px панель занимает весь экран, а рамка слева выглядела бы
    // как обрезанное окно.
    expect(panel.className).toContain("w-full");
    expect(panel.className).toContain("md:w-[var(--side-panel-width)]");
    expect(panel.className).toContain("md:border-l");
    expect(panel.style.getPropertyValue("--side-panel-width")).toBe("500px");
  });

  it("кнопка закрытия крупнее на мобильном", () => {
    setViewport(true);
    renderShell();

    const close = screen.getByLabelText("Закрыть панель");

    // На телефоне это единственный способ закрыть карточку: клик по фону
    // недоступен, потому что фона за ней не видно.
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
    expect(close.className).toContain("md:h-8");
  });

  it("показывает содержимое активной вкладки", () => {
    setViewport(true);
    renderShell();

    // Полоса вкладок при единственной вкладке не рендерится (`tabs.length > 1`) —
    // это осознанно: одна вкладка не даёт выбора, а полоса съедала бы 40px высоты.
    expect(screen.getByText("Содержимое")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Главная" })).toBeNull();
  });

  it("показывает полосу вкладок, когда их больше одной", () => {
    setViewport(true);
    render(
      <RecordDetailShell
        name="Иван Петров"
        createdAt="2026-09-01T10:00:00.000Z"
        onClose={vi.fn()}
        tabs={[
          { id: "main", label: "Главная", content: <p>Первая</p> },
          { id: "notes", label: "Заметки", content: <p>Вторая</p> },
        ]}
        ariaLabel="Карточка контакта"
      />,
    );

    // Полоса прокручивается горизонтально (`overflow-x-auto`): на 360px пять
    // вкладок в ряд не помещаются.
    expect(screen.getByRole("button", { name: "Главная" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Заметки" })).toBeDefined();
  });
});
