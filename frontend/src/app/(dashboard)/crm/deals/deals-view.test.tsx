import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Поиск на странице сделок и режим отображения.
//
// Дефект пункта 23: поиск фильтровал только `sortedDeals` для списка, а канбан
// рендерил `kanban.data` напрямую — пользователь вводил запрос и не видел
// реакции. На телефоне это заметнее, потому что канбан режим по умолчанию.
//
// Пункт 22: вид (канбан/список) жил в `useState` и сбрасывался при каждом заходе.
// Теперь он часть серверного представления вместе с раскладкой колонок.
//
// Рендерится вся страница: расхождение было именно между тем, что фильтруется, и
// тем, что передаётся в канбан — проверять это на компоненте бессмысленно.
// ---------------------------------------------------------------------------

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/lib/api/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/apiClient")>();
  return {
    ...actual,
    apiClient: {
      get: (path: string, options?: unknown) => getMock(path, options) as unknown,
      put: (path: string, body?: unknown) => putMock(path, body) as unknown,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crm/deals",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      role: "owner",
      name: "Менеджер",
      permissions: new Set(["deals:read", "deals:write"]),
    },
    tenant: { tenantId: "tenant-1", tenantName: "Акме", installedModules: [] },
  }),
}));

const PIPELINE_ID = "22222222-2222-2222-2222-222222222222";

function deal(id: string, title: string) {
  return {
    id,
    pipelineId: PIPELINE_ID,
    stageId: "stage-1",
    contactId: null,
    companyId: null,
    title,
    description: "",
    budget: 100000,
    currency: "RUB",
    customFields: {},
    createdBy: "user-1",
    ownerId: "user-1",
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    companyName: null,
    contactName: null,
    ownerName: "Менеджер",
  };
}

const KANBAN = [
  {
    stageId: "stage-1",
    stageName: "Новый лид",
    sortOrder: 0,
    isWon: false,
    isLost: false,
    stageColor: "amber",
    dealCount: 2,
    budgetTotal: 200000,
    deals: [deal("deal-1", "Поставка кофемашины"), deal("deal-2", "Ремонт принтера")],
  },
];

function respond(layout: unknown = null): void {
  getMock.mockImplementation(async (path: string) => {
    if (path.includes("/table-layouts/")) return { data: layout };
    if (path.includes("/deals/pipelines")) {
      return { data: [{ id: PIPELINE_ID, name: "Основная", sortOrder: 0 }] };
    }
    if (path.includes("/deals/kanban")) return { data: KANBAN };
    if (path.includes("/tenant/users")) return { data: [] };
    return { data: [], meta: { total: 0 } };
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderPage() {
  const { default: DealsPage } = await import("@/app/(dashboard)/crm/deals/page");
  render(<DealsPage />, { wrapper });
  await waitFor(() => expect(screen.getByText("Поставка кофемашины")).toBeDefined());
}

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
  putMock.mockImplementation(async (_path: string, body: unknown) => ({
    data: { tableId: "deals", layout: body, updatedAt: new Date().toISOString() },
  }));
  respond();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Поиск фильтрует канбан", () => {
  it("скрывает карточки, не подходящие под запрос", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Поиск и фильтр"), "кофемашин");

    // Ровно то, чего не было: канбан получал `kanban.data` напрямую, поэтому
    // запрос на него не влиял.
    await waitFor(() => expect(screen.queryByText("Ремонт принтера")).toBeNull());
    expect(screen.getByText("Поставка кофемашины")).toBeDefined();
  });

  it("пересчитывает счётчик колонки", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Поиск и фильтр"), "кофемашин");

    // Иначе шапка колонки обещала бы больше карточек, чем в ней видно.
    await waitFor(() => expect(screen.queryByText("Ремонт принтера")).toBeNull());
    const counters = screen.getAllByText("1");
    expect(counters.length).toBeGreaterThan(0);
  });

  it("возвращает все карточки при очистке запроса", async () => {
    await renderPage();

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Поиск и фильтр");
    await user.type(input, "кофемашин");
    await waitFor(() => expect(screen.queryByText("Ремонт принтера")).toBeNull());

    await user.clear(input);

    await waitFor(() => expect(screen.getByText("Ремонт принтера")).toBeDefined());
  });
});

describe("Режим отображения сделок сохраняется", () => {
  it("открывается в канбане по умолчанию", async () => {
    await renderPage();

    // Канбан — режим по умолчанию. Название этапа встречается и в шапке колонки,
    // и на карточках, поэтому признак канбана — отсутствие управления колонками:
    // оно есть только у таблицы.
    expect(screen.getAllByText("Новый лид").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Колонки/ })).toBeNull();
  });

  it("восстанавливает список из серверного представления", async () => {
    respond({
      tableId: "deals",
      layout: { widths: {}, order: [], hidden: [], viewMode: "table" },
      updatedAt: "2026-09-03T10:00:00.000Z",
    });

    await renderPage();

    // Прежде выбор сбрасывался при каждом заходе, и работающий списком менеджер
    // каждый раз возвращался в канбан.
    await waitFor(() => expect(screen.getByRole("button", { name: /Колонки/ })).toBeDefined());
  });

  it("сохраняет переключение на сервер", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Список"));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [path, body] = putMock.mock.calls[0] ?? [];

    expect(path).toBe("/api/v1/crm/table-layouts/deals");
    expect((body as { viewMode?: string }).viewMode).toBe("table");
  });
});
