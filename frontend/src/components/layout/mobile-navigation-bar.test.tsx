import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { MobileNavigationBar } from "@/components/layout/MobileNavigationBar";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

// ---------------------------------------------------------------------------
// Нижний бар навигации.
//
// На мобильном сайдбара нет вовсе, поэтому бар — единственный путь к разделам и
// к поиску. Проверяется то, что ломается незаметно:
//
// 1. Бар прячется под открытым оверлеем. Он `fixed` с `z-30`, и без этого его
//    кнопки висели бы поверх формы, перекрывая последнее поле и кнопку отправки.
//    Проверка идёт через настоящий `ConfirmDialog`, а не через мок счётчика: связь
//    «оверлей открыт → бар скрыт» проходит через модуль `use-scroll-lock`, и
//    подмена счётчика проверяла бы тест сам себя.
//
// 2. Скрытие сделано классом `hidden`, а не размонтированием: `CommandMenu` внутри
//    бара держит состояние поиска, и снятие бара с дерева закрывало бы палитру при
//    открытии любого оверлея.
//
// 3. `md:hidden` и `hidden` — одно свойство `display`, поэтому они не могут быть
//    двумя независимыми классами: нужен выбор `flex` против `hidden`.
// ---------------------------------------------------------------------------

let currentPath = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", role: "owner", permissions: new Set(["tenant:admin"]) },
    tenant: { tenantId: "tenant-1", tenantName: "Акме", installedModules: [] },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Бар вместе с оверлеем, который можно открыть — как на настоящей странице. */
function BarWithOverlay() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setConfirmOpen(true)}>Удалить</button>
      <MobileNavigationBar />
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title="Удалить запись?"
        cancelLabel="Отмена"
      />
    </>
  );
}

function bar(): HTMLElement {
  return screen.getByRole("navigation", { name: "Основная навигация" });
}

beforeEach(() => {
  currentPath = "/dashboard";
  document.body.style.overflow = "";
});

afterEach(() => {
  document.body.style.overflow = "";
});

describe("MobileNavigationBar", () => {
  it("показывает панель, поиск и меню", () => {
    render(<MobileNavigationBar />, { wrapper });

    expect(screen.getByRole("link", { name: "Панель" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Поиск" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Меню" })).toBeDefined();
  });

  it("скрыт на десктопе классом, а не условием на хуке", () => {
    render(<MobileNavigationBar />, { wrapper });

    // `md:hidden`, а не ветка по `useIsMobile`: `matchMedia` недоступен при SSR, и
    // бар мигал бы на десктопе при каждой загрузке страницы.
    expect(bar().className).toContain("md:hidden");
  });

  it("подсвечивает активный раздел", () => {
    currentPath = "/menu";
    render(<MobileNavigationBar />, { wrapper });

    expect(screen.getByRole("link", { name: "Меню" }).className).toContain("text-[#4a38f5]");
    expect(screen.getByRole("link", { name: "Панель" }).className).not.toContain("text-[#4a38f5]");
  });

  it("считает вложенный маршрут активным", () => {
    currentPath = "/crm/deals/some-id";
    render(<MobileNavigationBar />, { wrapper });

    // «Панель» не должна подсвечиваться на чужом маршруте: иначе активный раздел
    // в баре не соответствует открытому экрану.
    expect(screen.getByRole("link", { name: "Панель" }).className).not.toContain("text-[#4a38f5]");
  });

  it("прячется, когда открыт оверлей", async () => {
    render(<BarWithOverlay />, { wrapper });

    // Проверка по списку классов, а не подстрокой: `md:hidden` содержит `hidden`,
    // и `toContain("hidden")` был бы истинным всегда — на этом первая версия
    // теста и споткнулась.
    expect(bar().classList.contains("flex")).toBe(true);
    expect(bar().classList.contains("hidden")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    // Ровно та причина, по которой связь с оверлеями вообще нужна: кнопки бара
    // висели бы поверх формы, перекрывая её последнее поле.
    expect(bar().classList.contains("hidden")).toBe(true);
    expect(bar().classList.contains("flex")).toBe(false);
  });

  it("возвращается после закрытия оверлея", async () => {
    render(<BarWithOverlay />, { wrapper });

    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(bar().classList.contains("flex")).toBe(true);
    expect(bar().classList.contains("hidden")).toBe(false);
  });

  it("остаётся в дереве под оверлеем, а не размонтируется", async () => {
    render(<BarWithOverlay />, { wrapper });

    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    // Размонтирование сбросило бы состояние `CommandMenu` внутри бара: палитра
    // поиска закрывалась бы при открытии любого другого оверлея.
    expect(screen.queryByRole("navigation", { name: "Основная навигация" })).not.toBeNull();
  });

  it("прячется, когда открыта палитра поиска", async () => {
    render(<MobileNavigationBar />, { wrapper });

    await userEvent.click(screen.getByRole("button", { name: "Поиск" }));

    // Палитра была единственным оверлеем портала вне общего стека: она
    // открывалась, а прокрутка фона оставалась и бар не прятался. Найдено
    // проверкой в браузере, а не этим тестом — тест закрепляет исправление.
    expect(bar().classList.contains("hidden")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
  });
});
