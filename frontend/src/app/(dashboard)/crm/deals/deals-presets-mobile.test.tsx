import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

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

function createDeal(id: string, title: string, budget: number, stageId: string) {
  return {
    id,
    pipelineId: PIPELINE_ID,
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
    stageName: "В работе",
    sortOrder: 0,
    isWon: false,
    isLost: false,
    stageColor: "amber",
    dealCount: 2,
    budgetTotal: 150000,
    deals: [
      createDeal("deal-1", "Поставка кофемашины", 120000, "stage-1"),
      createDeal("deal-2", "Ремонт принтера", 30000, "stage-1"),
    ],
  },
  {
    stageId: "stage-won",
    stageName: "Успешно",
    sortOrder: 1,
    isWon: true,
    isLost: false,
    stageColor: "emerald",
    dealCount: 1,
    budgetTotal: 250000,
    deals: [
      createDeal("deal-3", "Крупный контракт", 250000, "stage-won"),
    ],
  },
];

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
  getMock.mockImplementation(async (path: string) => {
    if (path.includes("/table-layouts/")) return { data: null };
    if (path.includes("/deals/pipelines")) {
      return { data: [{ id: PIPELINE_ID, name: "Основная", sortOrder: 0 }] };
    }
    if (path.includes("/deals/kanban")) return { data: KANBAN };
    if (path.includes("/tenant/users")) return { data: [] };
    return { data: [], meta: { total: 0 } };
  });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Мобильная эргономика панели срезов (Saved Views) сделок", () => {
  it("рендерит tablist с горизонтальным single-line touch скроллом и скрытием скроллбара", async () => {
    await renderPage();

    const tablist = screen.getByRole("tablist", { name: "Срезы сделок" });
    expect(tablist).toBeDefined();

    // Проверяем ключевые классы горизонтального single-line touch контейнера
    expect(tablist.className).toContain("overflow-x-auto");
    expect(tablist.className).toContain("no-scrollbar");
    expect(tablist.className).toContain("touch-pan-x");
    expect(tablist.className).toContain("scroll-smooth");
  });

  it("содержит метку «Срез:» со строгим shrink-0 и whitespace-nowrap", async () => {
    await renderPage();

    const label = screen.getByText("Срез:");
    expect(label).toBeDefined();
    expect(label.className).toContain("shrink-0");
    expect(label.className).toContain("whitespace-nowrap");
  });

  it("все табы срезов имеют shrink-0, whitespace-nowrap и минимальную тач-высоту 32px", async () => {
    await renderPage();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(4);

    for (const tab of tabs) {
      expect(tab.className).toContain("shrink-0");
      expect(tab.className).toContain("whitespace-nowrap");
      expect(tab.className).toContain("h-8");
      expect(tab.className).toContain("min-h-[32px]");
    }
  });

  it("переключение среза фильтрует сделки на доске и обновляет active состояние", async () => {
    await renderPage();

    const user = userEvent.setup();

    // По умолчанию выбран «Все сделки»
    const allTab = screen.getByRole("tab", { name: /Все сделки/ });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Поставка кофемашины")).toBeDefined();
    expect(screen.getByText("Ремонт принтера")).toBeDefined();
    expect(screen.getByText("Крупный контракт")).toBeDefined();

    // Кликаем на «Крупные (> 100к)»
    const highValueTab = screen.getByRole("tab", { name: /Крупные/ });
    await user.click(highValueTab);

    expect(highValueTab.getAttribute("aria-selected")).toBe("true");
    expect(allTab.getAttribute("aria-selected")).toBe("false");

    // «Ремонт принтера» (бюджет 30 000) должен исчезнуть
    await waitFor(() => expect(screen.queryByText("Ремонт принтера")).toBeNull());
    // Крупные сделки должны остаться
    expect(screen.getByText("Поставка кофемашины")).toBeDefined();
    expect(screen.getByText("Крупный контракт")).toBeDefined();
  });
});
