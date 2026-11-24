import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { buildFilterStorageKey } from "@/lib/hooks/use-persisted-filters";

const getMock = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("@/lib/api/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/apiClient")>();
  return {
    ...actual,
    apiClient: {
      get: (path: string, options?: unknown) => getMock(path, options) as unknown,
      put: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crm/deals",
  useSearchParams: () => currentParams,
}));

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      role: "owner",
      name: "Менеджер",
      permissions: new Set(["deals:read", "deals:write"]),
    },
    tenant: {
      tenantId: "tenant-1",
      tenantName: "remtoua",
      slug: "remtoua",
      installedModules: [],
    },
    isLoading: false,
  }),
}));

const PIPELINE_1 = "11111111-1111-1111-1111-111111111111";
const PIPELINE_2 = "22222222-2222-2222-2222-222222222222";

function makeDeal(id: string, title: string, budget: number, stageId: string) {
  return {
    id,
    pipelineId: PIPELINE_1,
    stageId,
    contactId: null,
    companyId: null,
    title,
    description: "",
    budget,
    currency: "RUB",
    customFields: {},
    createdBy: "user-1",
    ownerId: "user-1",
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: "2026-11-24T10:00:00.000Z",
    updatedAt: "2026-11-24T10:00:00.000Z",
    companyName: null,
    contactName: null,
    ownerName: "Менеджер",
  };
}

const KANBAN = [
  {
    stageId: "stage-active",
    stageName: "Новый лид",
    sortOrder: 0,
    isWon: false,
    isLost: false,
    stageColor: "amber",
    dealCount: 1,
    budgetTotal: 50000,
    deals: [makeDeal("d-1", "Активная сделка", 50000, "stage-active")],
  },
  {
    stageId: "stage-won",
    stageName: "Успешно",
    sortOrder: 1,
    isWon: true,
    isLost: false,
    stageColor: "emerald",
    dealCount: 1,
    budgetTotal: 150000,
    deals: [makeDeal("d-2", "Успешная сделка", 150000, "stage-won")],
  },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getMock.mockReset();
  currentParams = new URLSearchParams();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/crm/deals");

  getMock.mockImplementation(async (path: string) => {
    if (path.includes("/table-layouts/")) return { data: null };
    if (path.includes("/deals/pipelines")) {
      return {
        data: [
          { id: PIPELINE_1, name: "Основная", sortOrder: 0 },
          { id: PIPELINE_2, name: "Вторая", sortOrder: 1 },
        ],
      };
    }
    if (path.includes("/deals/kanban")) return { data: KANBAN };
    if (path.includes("/tenant/users")) return { data: [] };
    return { data: [], meta: { total: 0 } };
  });
});

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Персистентность фильтров на /crm/deals", () => {
  it("сохраняет срез в localStorage, восстанавливает при повторном заходе и очищает по «Сбросить»", async () => {
    const storageKey = buildFilterStorageKey("remtoua", "user-1", "crm-deals");
    const { default: DealsPage } = await import("@/app/(dashboard)/crm/deals/page");

    const first = render(<DealsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("Активная сделка")).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /В работе/ }));

    await waitFor(() => expect(screen.queryByText("Успешная сделка")).toBeNull());
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual({
      presetView: "active",
    });

    first.unmount();

    // Симулируем переход по боковому меню на /crm/deals без query-параметров.
    window.history.replaceState(null, "", "/crm/deals");
    currentParams = new URLSearchParams();

    render(<DealsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("Активная сделка")).toBeDefined());
    expect(screen.queryByText("Успешная сделка")).toBeNull();
    expect(screen.getByRole("tab", { name: /В работе/ }).getAttribute("aria-selected")).toBe("true");

    // Сброс возвращает все сделки и очищает storage.
    await user.click(screen.getByRole("button", { name: /Сбросить/i }));

    await waitFor(() => expect(screen.getByText("Успешная сделка")).toBeDefined());
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("безопасно сбрасывает удалённый pipelineId и загружает первую доступную воронку", async () => {
    const storageKey = buildFilterStorageKey("remtoua", "user-1", "crm-deals");
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ pipelineId: "deleted-pipeline-id", presetView: "won" }),
    );

    const { default: DealsPage } = await import("@/app/(dashboard)/crm/deals/page");
    render(<DealsPage />, { wrapper });

    await waitFor(() => expect(screen.getByText("Успешная сделка")).toBeDefined());
    expect(screen.queryByText("Активная сделка")).toBeNull();

    // Запрос kanban ушёл строго для существующей воронки PIPELINE_1, не для удалённой.
    const kanbanCalls = getMock.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("/deals/kanban"),
    );
    expect(kanbanCalls.length).toBeGreaterThan(0);
    for (const [, options] of kanbanCalls) {
      expect((options as { query?: { pipeline_id?: string } }).query?.pipeline_id).toBe(
        PIPELINE_1,
      );
    }

    // Удалённый pipelineId очищен из localStorage, а валидный presetView сохранён.
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual({
        presetView: "won",
      }),
    );
  });
});
