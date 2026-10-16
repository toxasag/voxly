import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Открытие карточки контакта по ссылке `?record=<id>`.
//
// Тест существует потому, что это условие работоспособности поиска: палитра
// формирует именно такую ссылку, и без поддержки параметра она вела бы в список
// без открытой карточки — то есть цель «поиск открывает саму запись» не
// достигалась бы, хотя все тесты палитры при этом зелёные.
//
// Проверить это в браузере не удалось: страница закрыта гейтом `contacts:read`, а
// фиктивная cookie прав не даёт. Поэтому проверка рендером с подменёнными правами.
// ---------------------------------------------------------------------------

const CONTACT_ID = "11111111-1111-1111-1111-111111111111";

const getMock = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/crm/contacts",
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
    // `Guard` требует именно `contacts:read`: он не трактует `tenant:admin` как
    // надмножество, в отличие от правила видимости меню.
    user: {
      id: "user-1",
      role: "owner",
      permissions: new Set(["contacts:read", "contacts:write", "contacts:delete", "companies:read"]),
    },
    tenant: { tenantId: "tenant-1", tenantName: "Акме", installedModules: [] },
  }),
}));

const contact = {
  id: CONTACT_ID,
  firstName: "Иван",
  lastName: "Петров",
  middleName: "",
  phone: "+79161234567",
  phones: [{ number: "+79161234567", countryCode: "RU", callingCode: "+7" }],
  email: "ivan@example.com",
  telegramUsername: "@ivanp",
  whatsapp: null,
  socials: [],
  jobTitle: "Директор",
  companyName: "Акме",
  companyId: null,
  channel: "telegram",
  linkedinLink: "",
  customFields: {},
  notes: "",
  createdBy: "user-1",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderPage() {
  const { default: ContactsPage } = await import("@/app/(dashboard)/crm/contacts/page");
  render(<ContactsPage />, { wrapper });
}

beforeEach(() => {
  getMock.mockReset();
  getMock.mockImplementation(async (path: string) => {
    if (path.includes("/crm/contacts")) return { data: [contact], meta: { total: 1 } };
    return { data: [], meta: { total: 0 } };
  });
  currentParams = new URLSearchParams();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Страница контактов и параметр record", () => {
  it("открывает карточку, когда идентификатор есть в адресе", async () => {
    currentParams = new URLSearchParams(`record=${CONTACT_ID}`);

    await renderPage();

    // Именно это делает ссылку из палитры поиска работающей: без поддержки
    // параметра она приводила бы в список без открытой карточки.
    // Общий предел 20 с задан в `vitest.config.ts`: тесты страниц рендерят их
    // целиком и в 5 секунд по умолчанию не укладывались.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());
    expect(screen.getByRole("dialog").textContent).toContain("Иван");
  });

  it("не открывает карточку без параметра", async () => {
    await renderPage();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("не открывает карточку по неизвестному идентификатору", async () => {
    currentParams = new URLSearchParams("record=00000000-0000-0000-0000-000000000000");

    await renderPage();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    // Записи нет в списке — панель не открывается, вместо пустой карточки
    // пользователь видит сам список.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
