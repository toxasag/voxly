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
  usePathname: () => "/repairs",
  useSearchParams: () => currentParams,
}));

const MOCK_USER = {
  id: "user-1",
  role: "owner" as const,
  name: "Мастер",
  email: "master@remtoua.ru",
  phone: "+79000000000",
  platform_role: null,
  permissions: new Set(["service_center:read", "service_center:write"]),
};

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => ({
    user: MOCK_USER,
    tenant: {
      tenantId: "tenant-1",
      tenantName: "remtoua",
      slug: "remtoua",
      installedModules: [
        { slug: "service_center", name: "Сервисный центр", installed_at: "2026-01-01" },
      ],
    },
    isLoading: false,
  }),
  useCurrentUser: () => MOCK_USER,
  useHasPermission: () => true,
  useIsModuleInstalled: () => true,
}));

function makeRepair(id: string, ticketNumber: string, status: string, paymentStatus: string) {
  return {
    id,
    ticketNumber,
    customerId: "cust-1",
    customerName: "Дмитрий",
    customerPhone: "+79139651841",
    equipment: {
      type: "Пистолет монтажный",
      brand: "Toua",
      model: "GSN50",
      serialNumber: "SN-001",
      packageContents: "",
      appearance: "",
    },
    defectDescription: "Профилактика",
    defectPhotos: [],
    status,
    paymentStatus,
    nextStatus: null,
    allowedTransitions: [],
    priority: "normal",
    masterId: "user-1",
    masterName: "Даниил",
    estimatedCost: 3600,
    finalCost: null,
    notes: "",
    diagnostics: null,
    receivedAt: "2026-11-24T12:00:00.000Z",
    completedAt: null,
    deliveredAt: null,
    createdAt: "2026-11-24T12:00:00.000Z",
    updatedAt: "2026-11-24T12:00:00.000Z",
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getMock.mockReset();
  currentParams = new URLSearchParams();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/repairs");

  getMock.mockImplementation(async (path: string) => {
    if (path.includes("/table-layouts/")) return { data: null };
    if (path.includes("/print-templates")) return { data: [] };
    if (path.includes("/print-settings")) return { data: null };
    if (path.includes("/repairs")) {
      return {
        data: [makeRepair("r-1", "0027", "ready", "unpaid")],
        meta: { total: 1, limit: 25, offset: 0 },
      };
    }
    return { data: [], meta: { total: 0 } };
  });
});

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Персистентность фильтров на /repairs", () => {
  it("восстанавливает сохранённые статус и оплату без лишнего запроса с дефолтным фильтром", async () => {
    const storageKey = buildFilterStorageKey("remtoua", "user-1", "repairs");
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ status: "ready", paymentStatus: "unpaid" }),
    );

    const { default: RepairsPage } = await import("@/app/(dashboard)/repairs/page");
    render(<RepairsPage />, { wrapper });

    await waitFor(() => expect(screen.getByText("№0027")).toBeDefined());

    const repairCalls = getMock.mock.calls.filter(
      ([path]) => typeof path === "string" && path === "/api/v1/repairs",
    );
    expect(repairCalls.length).toBe(1);
    const [, options] = repairCalls[0] ?? [];
    expect((options as { query?: Record<string, unknown> }).query).toMatchObject({
      status: "ready",
      payment_status: "unpaid",
    });

    // Кнопка сброса видна и очищает localStorage + URL.
    const user = userEvent.setup();
    const resetBtn = screen.getByRole("button", { name: /Сбросить/i });
    await user.click(resetBtn);

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(window.location.search).toBe("");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Сбросить/i })).toBeNull());
  });

  it("отображает в строке статистики карточки Оплачено и К оплате из meta ответа API", async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/repairs") {
        return {
          data: [makeRepair("r-1", "№0032", "in_progress", "paid")],
          meta: {
            total: 19,
            limit: 25,
            offset: 0,
            inProgressCount: 10,
            readyCount: 9,
            paidAmount: 19700,
            paidCount: 2,
            unpaidAmount: 95800,
            unpaidCount: 17,
          },
        };
      }
      return { data: [], meta: { total: 0 } };
    });

    const { default: RepairsPage } = await import("@/app/(dashboard)/repairs/page");
    render(<RepairsPage />, { wrapper });

    await waitFor(() => expect(screen.getByText("№0032")).toBeDefined());
    expect(screen.getByText("Оплачено")).toBeDefined();
    expect(screen.getByText("К оплате")).toBeDefined();
    expect(screen.getByText(/19\s700\s₽/)).toBeDefined();
    expect(screen.getByText("2 шт.")).toBeDefined();
    expect(screen.getByText(/95\s800\s₽/)).toBeDefined();
    expect(screen.getByText("17 шт.")).toBeDefined();
  });
});
