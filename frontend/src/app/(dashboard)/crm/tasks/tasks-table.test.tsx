import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { LAYOUT_STORAGE_PREFIX } from "@/components/crm/shared/use-record-table-layout";

// ---------------------------------------------------------------------------
// Страница задач на общей таблице записей.
//
// Задачи были единственной страницей CRM со своей вёрсткой таблицы — `<table>` с
// шестью жёстко заданными `<th>` и разметкой строк в `renderTask`. Из-за этого её
// обходил весь мобильный режим, сделанный для `RecordTable`: схлопывание первой
// колонки при горизонтальном скролле, отключение ресайза и перетаскивания,
// адаптивное меню колонок. Не работали и десктопные возможности — выбор видимых
// колонок, их порядок и ширины между визитами.
//
// Проверяется то, что страница получает вместе с переходом, а не сама разметка:
// состав колонок, сохранение раскладки, сортировка. Плюс то, что при переходе не
// потерялось: отметка выполнения, правка, удаление, фильтры и канбан-режим.
//
// `apiClient` подменён: нужна страница, а не сеть.
// ---------------------------------------------------------------------------

const getMock = vi.fn();
const patchMock = vi.fn();

vi.mock("@/lib/api/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/apiClient")>();
  return {
    ...actual,
    apiClient: {
      get: (path: string, options?: unknown) => getMock(path, options) as unknown,
      post: vi.fn(async () => ({ data: {} })),
      patch: (path: string, body?: unknown) => patchMock(path, body) as unknown,
      delete: vi.fn(async () => ({ data: {} })),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crm/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      role: "owner",
      name: "Менеджер",
      permissions: new Set(["tasks:read", "tasks:write"]),
    },
    tenant: { tenantId: "tenant-1", tenantName: "Акме", installedModules: [] },
  }),
}));

const TASKS = [
  {
    id: "task-1",
    title: "Позвонить клиенту",
    description: "Уточнить сроки поставки",
    priority: "high",
    status: "todo",
    dueDate: "2026-09-10T00:00:00.000Z",
    assigneeId: "user-1",
    assigneeName: "Менеджер",
    linkedEntityType: "deal",
    linkedEntityId: "deal-1",
    isOverdue: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  },
  {
    id: "task-2",
    title: "Отправить счёт",
    description: "",
    priority: "low",
    status: "done",
    dueDate: null,
    assigneeId: "user-1",
    assigneeName: "Менеджер",
    linkedEntityType: null,
    linkedEntityId: null,
    isOverdue: false,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
  },
];

function respond(): void {
  getMock.mockImplementation(async (path: string) => {
    if (path.includes("/tasks")) return { data: TASKS, meta: { total: TASKS.length } };
    if (path.includes("/tenant/users")) {
      // Поле `fullName`, а не `name`: `UserAvatar` читает именно его и падает на
      // `undefined.trim()`. Первая версия мока роняла всю страницу молча —
      // ошибка всплывала только в stderr.
      return {
        data: [
          {
            id: "user-1",
            fullName: "Менеджер Тестовый",
            email: "m@example.com",
            role: "owner",
            avatarUrl: null,
          },
        ],
      };
    }
    return { data: [], meta: { total: 0 } };
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderPage() {
  const { default: TasksPage } = await import("@/app/(dashboard)/crm/tasks/page");
  render(<TasksPage />, { wrapper });
  await waitFor(() => expect(screen.getByText("Позвонить клиенту")).toBeDefined());
}

beforeEach(() => {
  getMock.mockReset();
  patchMock.mockReset();
  patchMock.mockResolvedValue({ data: {} });
  respond();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Задачи на общей таблице", () => {
  it("рендерит колонки задачи, приоритета, срока, ответственного и связи", async () => {
    await renderPage();

    for (const header of ["Задача", "Приоритет", "Срок", "Ответственный", "Связь"]) {
      expect(screen.getByText(header)).toBeDefined();
    }
  });

  it("показывает управление колонками", async () => {
    await renderPage();

    // Прежняя таблица была `<table>` с жёсткими `<th>`: ни скрыть колонку, ни
    // переставить её было нельзя.
    expect(screen.getByRole("button", { name: /Колонки/ })).toBeDefined();
  });

  it("сохраняет раскладку под своим ключом", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Колонки/ }));
    // Два элемента с «Связь»: пункт меню и заголовок сортируемой колонки. Различаем
    // по индикатору сортировки «▼» в заголовке — порядок в дереве зависит от
    // разметки и на него опираться нельзя.
    const menuItem = screen
      .getAllByRole("button", { name: /^Связь/ })
      .find((button) => !(button.textContent ?? "").includes("▼"));
    await user.click(menuItem!);

    // `tableId="tasks"` — иначе раскладка задач писалась бы в чужой ключ или не
    // сохранялась вовсе.
    const raw = window.localStorage.getItem(`${LAYOUT_STORAGE_PREFIX}tasks`);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}").hidden).toContain("link");
  });

  it("сортирует по колонке", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Задача/ }));

    // Сортировки на прежней таблице не было вовсе: заголовки были простым текстом.
    const cells = screen.getAllByText(/Позвонить клиенту|Отправить счёт/);
    expect(cells[0]?.textContent).toBe("Позвонить клиенту");
  });
});

describe("Мобильный режим таблицы достался задачам", () => {
  /**
   * Мобильный режим включается подменой `matchMedia`.
   *
   * Это и есть главная причина перехода: своя `<table>` не получала ничего из
   * `M7.11` — ни схлопывания первой колонки, ни отключения ресайза и
   * перетаскивания, ни адаптивного меню колонок.
   */
  function setMobile(): void {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }

  it("не рендерит хваты ресайза на мобильном", async () => {
    setMobile();
    await renderPage();

    const table = screen.getByRole("button", { name: /Колонки/ }).closest("div")?.parentElement;
    expect(table?.querySelectorAll(".cursor-col-resize")).toHaveLength(0);
  });

  it("не даёт перетаскивать колонки на мобильном", async () => {
    setMobile();
    await renderPage();

    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it("схлопывает первую колонку при горизонтальной прокрутке", async () => {
    setMobile();
    await renderPage();

    // Контейнер таблицы, а не первый попавшийся: ряд быстрых фильтров тоже
    // `overflow-x-auto` и идёт раньше в DOM. На этом споткнулась и браузерная
    // проверка — прокручивался ряд фильтров, и схлопывание «не работало».
    const scroller = [...document.querySelectorAll<HTMLElement>(".overflow-x-auto")].find(
      (element) => element.querySelector("[style*='--rt-col-title']") !== null,
    );
    expect(scroller).not.toBeUndefined();

    const grid = document.querySelector<HTMLElement>("[style*='--rt-col-title']");
    expect(grid?.style.getPropertyValue("--rt-col-title")).toBe("300px");

    fireEvent.scroll(scroller as HTMLElement, { target: { scrollLeft: 40 } });

    // Колонка «Задача» шириной 300px на 360px экране не оставляла места
    // остальным: она залипающая, и до правки на странице задач такого поведения
    // не было вовсе.
    expect(grid?.style.getPropertyValue("--rt-col-title")).toBe("38px");
  });

  it("сохраняет горизонтальную прокрутку и залипание", async () => {
    setMobile();
    await renderPage();

    expect(document.querySelector(".overflow-x-auto")).not.toBeNull();
    expect(document.querySelector(".min-w-max")).not.toBeNull();
    expect(document.querySelectorAll(".sticky").length).toBeGreaterThan(0);
  });
});

describe("Что не потерялось при переходе", () => {
  it("отметка выполнения работает", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Завершить" })[0]!);

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const [path, body] = patchMock.mock.calls[0] ?? [];
    expect(path).toContain("task-1");
    expect(body).toMatchObject({ status: "done" });
  });

  it("выполненная задача отличается визуально", async () => {
    await renderPage();

    // Зачёркивание и приглушение — единственный признак выполненной задачи в
    // таблице: отдельной колонки статуса в ней нет.
    const done = screen.getByText("Отправить счёт");
    expect(done.className).toContain("line-through");
  });

  it("кнопки правки и удаления на месте", async () => {
    await renderPage();

    expect(screen.getAllByRole("button", { name: "Изменить задачу" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Удалить задачу" }).length).toBeGreaterThan(0);
  });

  it("фильтры переключаются", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Просрочено/ }));

    // Фильтр уходит в `query.filter` вторым аргументом `apiClient.get`; часть
    // вызовов идёт без опций вовсе, поэтому `JSON.stringify` применяется к
    // каждому по отдельности, а не к неопределённому значению.
    await waitFor(() => {
      const sentFilters = getMock.mock.calls
        .map(([, options]) => JSON.stringify(options ?? {}))
        .join(" ");
      expect(sentFilters).toContain("overdue");
    });
  });

  it("канбан-режим сохранён", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Канбан" }));

    // Вид выбирает пользователь, а не ширина экрана: канбан остаётся и на
    // телефоне.
    await waitFor(() => expect(screen.getByText("К выполнению")).toBeDefined());
    expect(screen.getByText("В работе")).toBeDefined();
    expect(screen.getByText("Выполнено")).toBeDefined();
  });

  it("в канбане карточки распределены по статусам", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Канбан" }));

    await waitFor(() => expect(screen.getByText("К выполнению")).toBeDefined());
    // Обе задачи на месте, каждая в своей колонке.
    expect(screen.getByText("Позвонить клиенту")).toBeDefined();
    expect(screen.getByText("Отправить счёт")).toBeDefined();
  });

  it("счётчик открытых задач считает верно", async () => {
    await renderPage();

    // Одна из двух задач выполнена.
    expect(screen.getByText(/Открытых: 1/)).toBeDefined();
  });
});
