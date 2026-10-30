import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Адрес открытой сделки (пункт 17 плана, оставшийся след).
//
// Контакты и компании уже жили в адресе (`?record=`), а дровер сделок остался на
// локальном `useState`. Следствие ровно то, ради чего пункт 17 и заводился: на
// телефоне карточка занимает весь экран, и системная кнопка «назад» уводила со
// страницы сделок целиком вместо закрытия карточки. Плюс ссылку на сделку из
// таблицы нельзя было отправить — адрес оставался списком.
//
// Проверяется страницей, а не компонентом: расхождение было между источником
// состояния дровера и адресом.
// ---------------------------------------------------------------------------

const getMock = vi.fn();
const putMock = vi.fn();
const pushMock = vi.fn();
const replaceMock = vi.fn();
let currentParams = new URLSearchParams();

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
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
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
    tenant: { tenantId: "tenant-1", tenantName: "Акме", installedModules: [] },
  }),
}));

const PIPELINE_ID = "22222222-2222-2222-2222-222222222222";
const DEAL_ID = "11111111-1111-1111-1111-111111111111";

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
    dealCount: 1,
    budgetTotal: 100000,
    deals: [deal(DEAL_ID, "Поставка кофемашины")],
  },
];

function respond(): void {
  getMock.mockImplementation(async (path: string) => {
    if (path.includes("/table-layouts/")) return { data: null };
    if (path.includes("/deals/pipelines")) {
      return { data: [{ id: PIPELINE_ID, name: "Основная", sortOrder: 0 }] };
    }
    if (path.includes("/deals/kanban")) return { data: KANBAN };
    if (path.includes("/tenant/users")) return { data: [] };
    if (path.endsWith(`/deals/${DEAL_ID}`)) return { data: deal(DEAL_ID, "Поставка кофемашины") };
    if (path.includes("/page-layouts/")) return { data: [] };
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
  await waitFor(() => expect(screen.getAllByText("Поставка кофемашины").length).toBeGreaterThan(0));
}

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
  pushMock.mockReset();
  replaceMock.mockReset();
  currentParams = new URLSearchParams();
  putMock.mockImplementation(async (_path: string, body: unknown) => ({
    data: { tableId: "deals", layout: body, updatedAt: new Date().toISOString() },
  }));
  respond();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Адрес открытой сделки", () => {
  it("открытие карточки пишет ?record= в историю", async () => {
    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByText("Поставка кофемашины"));

    // `push`, а не `replace`: открытие — шаг вперёд, «назад» обязано закрывать
    // карточку, а не уводить со страницы сделок.
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const [url] = pushMock.mock.calls[0] ?? [];
    expect(url).toContain(`record=${DEAL_ID}`);
  });

  it("по прямой ссылке ?record= карточка открыта сразу", async () => {
    currentParams = new URLSearchParams(`record=${DEAL_ID}`);

    await renderPage();

    // Дровер отдаёт заголовок сделки в шапке панели — значит открыт по адресу,
    // без клика по списку.
    await waitFor(() =>
      expect(screen.getAllByText("Поставка кофемашины").length).toBeGreaterThan(1),
    );
  });

  it("закрытие снимает параметр через replace и сохраняет фильтр списка", async () => {
    currentParams = new URLSearchParams(`view=kanban&record=${DEAL_ID}`);

    await renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Закрыть"));

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const [url] = replaceMock.mock.calls[0] ?? [];
    expect(url).not.toContain("record=");
    // Прочие параметры адреса — не наши: снимать вместе с карточкой их нельзя.
    expect(url).toContain("view=kanban");
  });
});
