import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const TASK_ID = "11111111-1111-1111-1111-111111111111";
const getMock = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/crm/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => currentParams,
}));

vi.mock("@/lib/api/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/apiClient")>();
  return {
    ...actual,
    apiClient: {
      get: (path: string, options?: unknown) => getMock(path, options) as unknown,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

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

const task = {
  id: TASK_ID,
  dealId: null,
  contactId: null,
  companyId: null,
  linkedEntityType: null,
  linkedEntityId: null,
  title: "Позвонить клиенту",
  description: "",
  priority: "high",
  status: "todo",
  dueDate: "2026-09-10T00:00:00.000Z",
  assigneeId: "user-1",
  completedAt: null,
  isOverdue: false,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderPage() {
  const { default: TasksPage } = await import("@/app/(dashboard)/crm/tasks/page");
  render(<TasksPage />, { wrapper });
}

beforeEach(() => {
  getMock.mockReset();
  getMock.mockImplementation(async (path: string) => {
    if (path.endsWith(`/tasks/${TASK_ID}`)) return { data: task };
    if (path.includes("/tenant/users")) {
      return {
        data: [{ id: "user-1", fullName: "Менеджер", email: "m@example.com", role: "owner", avatarUrl: null }],
      };
    }
    if (path.includes("/tasks")) return { data: [task], meta: { total: 1 } };
    return { data: [], meta: { total: 0 } };
  });
  currentParams = new URLSearchParams();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Страница задач и параметр record", () => {
  it("открывает форму задачи, когда идентификатор есть в адресе", async () => {
    currentParams = new URLSearchParams(`record=${TASK_ID}`);
    await renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("Позвонить клиенту")).toBeDefined());
  });

  it("не открывает форму без параметра", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText("Позвонить клиенту")).toBeDefined());
    expect(screen.queryByDisplayValue("Позвонить клиенту")).toBeNull();
  });
});
