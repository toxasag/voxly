import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFilterStorageKey,
  enumField,
  nullableStringField,
  stringField,
  usePersistedFilters,
  type FilterSchema,
} from "@/lib/hooks/use-persisted-filters";

let mockSearchParams = new URLSearchParams();
let mockAuth: {
  user: { id: string } | null;
  tenant: { tenantId: string; slug?: string } | null;
  isLoading?: boolean;
} = {
  user: { id: "user-1" },
  tenant: { tenantId: "tenant-1", slug: "remtoua" },
  isLoading: false,
};

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => mockAuth,
}));

type TestFilters = {
  status: "all" | "active" | "ready";
  search: string;
  pipelineId: string | null;
};

const TEST_SCHEMA: FilterSchema<TestFilters> = {
  status: enumField({
    queryParam: "status",
    defaultValue: "all",
    allowed: ["all", "active", "ready"] as const,
  }),
  search: stringField({ queryParam: "q" }),
  pipelineId: nullableStringField({ queryParam: "pipeline" }),
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/repairs");
  mockSearchParams = new URLSearchParams();
  mockAuth = {
    user: { id: "user-1" },
    tenant: { tenantId: "tenant-1", slug: "remtoua" },
    isLoading: false,
  };
});

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("usePersistedFilters", () => {
  it("сохраняет выбранный фильтр с изоляцией по tenant и userId и восстанавливает после перемонтирования", async () => {
    const { result, unmount } = renderHook(() =>
      usePersistedFilters({ pageKey: "repairs", schema: TEST_SCHEMA }),
    );

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.filters).toEqual({ status: "all", search: "", pipelineId: null });
    expect(result.current.hasActiveFilters).toBe(false);

    act(() => {
      result.current.setFilter("status", "active");
      result.current.setFilter("search", "Toua");
    });

    const expectedKey = buildFilterStorageKey("remtoua", "user-1", "repairs");
    expect(result.current.storageKey).toBe(expectedKey);
    expect(JSON.parse(window.localStorage.getItem(expectedKey) ?? "{}")).toEqual({
      status: "active",
      search: "Toua",
    });
    expect(window.location.search).toBe("?status=active&q=Toua");

    unmount();

    // Симулируем переход обратно на чистый маршрут без query-параметров.
    window.history.replaceState(null, "", "/repairs");
    mockSearchParams = new URLSearchParams();

    const restored = renderHook(() =>
      usePersistedFilters({ pageKey: "repairs", schema: TEST_SCHEMA }),
    );

    await waitFor(() => expect(restored.result.current.isHydrated).toBe(true));
    expect(restored.result.current.filters).toEqual({
      status: "active",
      search: "Toua",
      pipelineId: null,
    });
    expect(restored.result.current.hasActiveFilters).toBe(true);
    expect(window.location.search).toBe("?status=active&q=Toua");
  });

  it("изолирует фильтры между разными тенантами и пользователями", async () => {
    const remtouaKey = buildFilterStorageKey("remtoua", "user-1", "repairs");
    const otherUserKey = buildFilterStorageKey("remtoua", "user-2", "repairs");
    window.localStorage.setItem(remtouaKey, JSON.stringify({ status: "ready" }));
    window.localStorage.setItem(otherUserKey, JSON.stringify({ status: "active" }));

    const { result, rerender } = renderHook(() =>
      usePersistedFilters({ pageKey: "repairs", schema: TEST_SCHEMA }),
    );

    await waitFor(() => expect(result.current.filters.status).toBe("ready"));

    mockAuth = {
      user: { id: "user-2" },
      tenant: { tenantId: "tenant-1", slug: "remtoua" },
      isLoading: false,
    };
    rerender();

    await waitFor(() => expect(result.current.filters.status).toBe("active"));

    mockAuth = {
      user: { id: "user-1" },
      tenant: { tenantId: "tenant-2", slug: "acme" },
      isLoading: false,
    };
    rerender();

    await waitFor(() => expect(result.current.filters.status).toBe("all"));
  });

  it("отдаёт приоритет явным URL-параметрам перед localStorage", async () => {
    const key = buildFilterStorageKey("remtoua", "user-1", "repairs");
    window.localStorage.setItem(key, JSON.stringify({ status: "active", search: "старый" }));
    mockSearchParams = new URLSearchParams("status=ready");
    window.history.replaceState(null, "", "/repairs?status=ready");

    const { result } = renderHook(() =>
      usePersistedFilters({ pageKey: "repairs", schema: TEST_SCHEMA }),
    );

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.filters.status).toBe("ready");
    expect(result.current.filters.search).toBe("старый");
  });

  it("устойчив к битому JSON и устаревшим значениям enum в localStorage", async () => {
    const key = buildFilterStorageKey("remtoua", "user-1", "repairs");
    window.localStorage.setItem(key, "{invalid-json");

    const broken = renderHook(() =>
      usePersistedFilters({ pageKey: "repairs", schema: TEST_SCHEMA }),
    );
    await waitFor(() => expect(broken.result.current.isHydrated).toBe(true));
    expect(broken.result.current.filters.status).toBe("all");
    broken.unmount();

    window.localStorage.setItem(
      key,
      JSON.stringify({ status: "deleted_status", search: "ok" }),
    );

    const stale = renderHook(() =>
      usePersistedFilters({ pageKey: "repairs", schema: TEST_SCHEMA }),
    );
    await waitFor(() => expect(stale.result.current.isHydrated).toBe(true));
    expect(stale.result.current.filters.status).toBe("all");
    expect(stale.result.current.filters.search).toBe("ok");
  });

  it("сохраняет сторонние параметры (?record=) при изменении и сбросе фильтров", async () => {
    window.history.replaceState(null, "", "/crm/deals?record=deal-42&view=table");
    mockSearchParams = new URLSearchParams("record=deal-42&view=table");

    const { result } = renderHook(() =>
      usePersistedFilters({ pageKey: "crm-deals", schema: TEST_SCHEMA }),
    );

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setFilter("status", "active");
    });

    expect(window.location.search).toContain("record=deal-42");
    expect(window.location.search).toContain("view=table");
    expect(window.location.search).toContain("status=active");

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.filters).toEqual({ status: "all", search: "", pipelineId: null });
    expect(result.current.hasActiveFilters).toBe(false);
    expect(
      window.localStorage.getItem(buildFilterStorageKey("remtoua", "user-1", "crm-deals")),
    ).toBeNull();
    expect(window.location.search).toContain("record=deal-42");
    expect(window.location.search).toContain("view=table");
    expect(window.location.search).not.toContain("status=");
  });

  it("ждёт окончания загрузки auth, прежде чем читать localStorage", async () => {
    const key = buildFilterStorageKey("remtoua", "user-1", "repairs");
    window.localStorage.setItem(key, JSON.stringify({ status: "ready" }));

    mockAuth = { user: null, tenant: null, isLoading: true };
    const { result, rerender } = renderHook(() =>
      usePersistedFilters({ pageKey: "repairs", schema: TEST_SCHEMA }),
    );

    expect(result.current.isHydrated).toBe(false);
    expect(result.current.filters.status).toBe("all");

    mockAuth = {
      user: { id: "user-1" },
      tenant: { tenantId: "tenant-1", slug: "remtoua" },
      isLoading: false,
    };
    rerender();

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.filters.status).toBe("ready");
  });
});
