import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Стек карточек: контакт → компания поверх него.
//
// Пункт 17 плана. С контакта открывается карточка компании, и на телефоне, где
// каждая занимает весь экран, «закрыть» обязано вернуть к контакту, а не к
// списку. Аппаратная кнопка «назад» должна делать то же — за это отвечают
// параметры адреса: `?record=` для контакта, `?company=` для вложенной карточки.
//
// Проверяется именно поведение истории: `push` на открытии каждой карточки и
// `replace` на закрытии. Без `push` для вложенной карточки «назад» уводило бы со
// страницы целиком, а без `replace` на закрытии — возвращало бы только что
// закрытую карточку.
// ---------------------------------------------------------------------------

const CONTACT_ID = "11111111-1111-1111-1111-111111111111";
const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

const getMock = vi.fn();
const pushMock = vi.fn();
const replaceMock = vi.fn();

let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/crm/contacts",
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
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
      put: vi.fn(async () => ({ data: {} })),
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
      permissions: new Set([
        "contacts:read",
        "contacts:write",
        "contacts:delete",
        "companies:read",
      ]),
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
  phones: [{ number: "+79161234567", countryCode: "RU", callingCode: "+7", isPrimary: true }],
  email: "ivan@example.com",
  telegramUsername: null,
  whatsapp: null,
  socials: [],
  jobTitle: "Директор",
  companyName: "Ромашка",
  companyId: COMPANY_ID,
  channel: "telegram",
  linkedinLink: "",
  customFields: {},
  notes: "",
  createdBy: "user-1",
  createdByName: "Менеджер",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  dealsCount: 0,
  tasksCount: 0,
};

/** Форма строго по `CompanyDTO`: реквизиты и адрес вложены, а не плоские. */
const company = {
  id: COMPANY_ID,
  name: "Ромашка",
  domainName: "romashka.ru",
  phone: "+79160000000",
  email: "info@romashka.ru",
  requisites: { inn: "", ogrn: "", bik: "", accountNumber: "", legalAddress: "" },
  managerName: "Менеджер",
  managerId: "user-1",
  annualRevenue: null,
  linkedinLink: "",
  address: { city: "", street: "", country: "", postcode: "" },
  notes: "",
  customFields: {},
  createdBy: "user-1",
  createdByName: "Менеджер",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  contactsCount: 1,
  dealsCount: 0,
  dealsBudgetTotal: 0,
};

function respond(): void {
  getMock.mockImplementation(async (path: string) => {
    if (path.includes(`/companies/${COMPANY_ID}/stats`)) {
      return { data: { contactsCount: 1, dealsCount: 0, dealsBudgetTotal: 0 } };
    }
    if (path.includes(`/companies/${COMPANY_ID}`)) return { data: company };
    if (path.includes("/crm/contacts")) return { data: [contact], meta: { total: 1 } };
    if (path.includes("/table-layouts/")) return { data: null };
    if (path.includes("/tenant/users")) return { data: [] };
    return { data: [], meta: { total: 0 } };
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderPage() {
  const { default: ContactsPage } = await import("@/app/(dashboard)/crm/contacts/page");
  render(<ContactsPage />, { wrapper });
  // ФИО встречается и в строке таблицы, и в заголовке карточки, поэтому ждём
  // появления хотя бы одного вхождения, а не единственного.
  await waitFor(() => expect(screen.getAllByText("Петров Иван").length).toBeGreaterThan(0));
}

/** Адрес последнего вызова навигации. */
function lastUrl(mock: typeof pushMock): string {
  const calls = mock.mock.calls;
  return (calls[calls.length - 1]?.[0] as string) ?? "";
}

beforeEach(() => {
  getMock.mockReset();
  pushMock.mockReset();
  replaceMock.mockReset();
  respond();
  currentParams = new URLSearchParams();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Стек карточек контакт → компания", () => {
  it("открытие карточки компании добавляет запись в историю", async () => {
    currentParams = new URLSearchParams(`record=${CONTACT_ID}`);
    await renderPage();

    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());

    const user = userEvent.setup();
    // Название компании кликабельно и в строке таблицы, и в карточке контакта.
    // В карточке relation-chip живёт внутри интерактивного поля, но не внутри
    // другого <button>: это запрещено HTML и вызывало hydration warning.
    const companyButtons = screen.getAllByRole("button", { name: /Ромашка/ });
    await user.click(companyButtons[companyButtons.length - 1]!);

    // `push`, а не `replace`: только так аппаратная кнопка «назад» закроет
    // компанию и вернёт к контакту вместо ухода со страницы списка.
    expect(pushMock).toHaveBeenCalled();
    const url = lastUrl(pushMock);
    expect(url).toContain(`company=${COMPANY_ID}`);
    // Контакт остаётся в адресе: он под компанией, а не заменён ею.
    expect(url).toContain(`record=${CONTACT_ID}`);
  });

  it("обе карточки открыты, когда в адресе оба параметра", async () => {
    currentParams = new URLSearchParams(`record=${CONTACT_ID}&company=${COMPANY_ID}`);
    await renderPage();

    // Ссылку с двумя параметрами можно отправить коллеге, и она откроет тот же
    // стек, а не только верхнюю карточку.
    await waitFor(() => expect(screen.getAllByRole("dialog").length).toBe(2));
  });

  it("закрытие компании возвращает к контакту, а не к списку", async () => {
    currentParams = new URLSearchParams(`record=${CONTACT_ID}&company=${COMPANY_ID}`);
    await renderPage();

    await waitFor(() => expect(screen.getAllByRole("dialog").length).toBe(2));

    const user = userEvent.setup();
    // Верхняя карточка — компания: её кнопка закрытия последняя в дереве.
    const closeButtons = screen.getAllByLabelText("Закрыть панель");
    await user.click(closeButtons[closeButtons.length - 1]!);

    // `replace` на закрытии, иначе «назад» снова открывало бы компанию.
    expect(replaceMock).toHaveBeenCalled();
    const url = lastUrl(replaceMock);
    expect(url).not.toContain("company=");
    // Контакт сохранён: закрытие компании не должно выбрасывать в список.
    expect(url).toContain(`record=${CONTACT_ID}`);
  });

  it("закрытие контакта не тянет за собой чужие параметры", async () => {
    currentParams = new URLSearchParams(`search=%D0%B8%D0%B2%D0%B0%D0%BD&record=${CONTACT_ID}`);
    await renderPage();

    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getAllByLabelText("Закрыть панель")[0]!);

    // Фильтр списка сохраняется: закрытие карточки не должно сбрасывать поиск.
    const url = lastUrl(replaceMock);
    expect(url).toContain("search=");
    expect(url).not.toContain("record=");
  });
});
