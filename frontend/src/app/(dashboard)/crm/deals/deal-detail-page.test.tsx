import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Страница сделки по прямой ссылке.
//
// Тест нужен потому, что страница переписана целиком, а на неё ведут уведомления
// и запасная ветка карточки канбана: сломанный рендер отправил бы пользователя из
// уведомления в тупик. Прежняя версия показывала три жёсткие колонки, две из них
// заглушки («Эндпоинты связей … реализуются отдельными вертикальными срезами»),
// без задач, заметок и правки, а в деталях — сырые `stageId` и `pipelineId`.
//
// Проверяется то, чем страница отличалась в худшую сторону: наличие всех пяти
// вкладок, отсутствие заглушек и UUID в тексте, читаемое название этапа вместо
// идентификатора, работающее переключение вкладок.
//
// `apiClient` и контекст аутентификации подменены: нужен рендер страницы, а не
// живой бэкенд.
// ---------------------------------------------------------------------------

const DEAL_ID = "11111111-1111-1111-1111-111111111111";
const PIPELINE_ID = "22222222-2222-2222-2222-222222222222";
const STAGE_ID = "33333333-3333-3333-3333-333333333333";

const getMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: DEAL_ID }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/api/apiClient", () => ({
  apiClient: {
    get: (path: string, options?: unknown) => getMock(path, options) as unknown,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Право `deals:read` и `deals:write` есть: проверяется рендер, а гейты прав
// покрыты собственными тестами `Guard`.
vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", role: "owner", permissions: new Set(["deals:read", "deals:write"]) },
    tenant: { id: "tenant-1", installedModules: [] },
  }),
}));

const deal = {
  id: DEAL_ID,
  pipelineId: PIPELINE_ID,
  stageId: STAGE_ID,
  contactId: "44444444-4444-4444-4444-444444444444",
  companyId: null,
  title: "Заявка из Telegram",
  description: "Клиент спрашивал про ремонт",
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
  companyName: null,
  contactName: "Иван Петров",
  ownerName: "Менеджер",
};

const kanbanColumns = [
  {
    stageId: STAGE_ID,
    stageName: "Новый лид",
    sortOrder: 0,
    isWon: false,
    isLost: false,
    stageColor: "amber",
    dealCount: 1,
    budgetTotal: 15000,
    deals: [deal],
  },
];

const dealLayoutTabs = [
  { tabKey: "home", title: "Главная", icon: "Home", position: 10, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
  { tabKey: "chat", title: "Чат", icon: "MessageCircle", position: 15, isActive: true, moduleSlug: null, requiredPermission: "deals:write", updatedAt: "" },
  { tabKey: "tasks", title: "Задачи", icon: "ListChecks", position: 30, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
  { tabKey: "notes", title: "Заметки", icon: "StickyNote", position: 40, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
  { tabKey: "files", title: "Файлы", icon: "Paperclip", position: 50, isActive: false, moduleSlug: null, requiredPermission: null, updatedAt: "" },
];

/** Отвечает по пути запроса: страница читает сделку, воронки, канбан, вкладки и людей. */
function respond(): void {
  getMock.mockImplementation(async (path: string) => {
    if (path.endsWith(`/deals/${DEAL_ID}`)) return { data: deal };
    if (path.endsWith("/deals/pipelines")) {
      return { data: [{ id: PIPELINE_ID, name: "Основная", sortOrder: 0 }] };
    }
    if (path.endsWith("/deals/kanban")) return { data: kanbanColumns };
    if (path.endsWith("/tenant/users")) return { data: [] };
    if (path.includes("/page-layouts/deal/tabs")) return { data: dealLayoutTabs };
    if (path.includes("/messages")) return { data: [] };
    if (path.endsWith("/tasks")) return { data: [], meta: { total: 0 } };
    if (path.endsWith("/notes")) return { data: [], meta: { total: 0 } };
    return { data: [], meta: { total: 0 } };
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderPage() {
  const { default: DealDetailPage } = await import(
    "@/app/(dashboard)/crm/deals/[id]/page"
  );

  render(<DealDetailPage />, { wrapper });
  await waitFor(() => expect(screen.getByText("Заявка из Telegram")).toBeDefined());
}

beforeEach(() => {
  getMock.mockReset();
  respond();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Страница сделки по прямой ссылке", () => {
  it("показывает рабочие вкладки сделки без пустых «Файлов»", async () => {
    await renderPage();

    // «Файлы» в сиде is_active=false. «Главная» на десктопе в колонке слева,
    // в ряду остаётся только на мобильном (`md:hidden`).
    expect(screen.getByRole("button", { name: "Главная" }).className).toContain("md:hidden");
    for (const label of ["Чат", "Задачи", "Заметки"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: "Файлы" })).toBeNull();
    expect(screen.getAllByText("Иван Петров").length).toBeGreaterThan(0);
  });

  it("показывает название этапа, а не его идентификатор", async () => {
    await renderPage();

    await waitFor(() => expect(screen.getByText("Новый лид")).toBeDefined());
    // Сырые UUID в «Деталях» были главной претензией к прежней версии.
    expect(screen.queryByText(STAGE_ID)).toBeNull();
    expect(screen.queryByText(PIPELINE_ID)).toBeNull();
  });

  it("не содержит заглушек про нереализованные срезы", async () => {
    await renderPage();

    // Дословно из прежней версии: «Эндпоинты связей … реализуются отдельными
    // вертикальными срезами» и «Данные связанных задач появятся вместе со срезом».
    expect(screen.queryByText(/вертикальными срезами/)).toBeNull();
    expect(screen.queryByText(/появятся вместе со срезом/)).toBeNull();
  });

  it("переключает вкладку на чат", async () => {
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Чат" }));

    // Тот же чат, что в дровере: отдельной реализации на странице больше нет.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "" })).toBeDefined());
  });

  it("показывает сумму и контактное лицо на «Главной»", async () => {
    await renderPage();

    await waitFor(() => expect(screen.getAllByText("Иван Петров").length).toBeGreaterThan(0));
    // Сумма форматируется как валюта — тот же вид, что в дровере.
    expect(screen.getByText(/15\s?000/)).toBeDefined();
  });

  it("ведёт назад к воронке", async () => {
    await renderPage();

    // Уведомление приводит на эту страницу напрямую, и выход из неё обязан быть.
    expect(screen.getByRole("link", { name: /Назад к воронке/ })).toBeDefined();
  });
});
