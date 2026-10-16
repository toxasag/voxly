import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { CommandMenu } from "@/components/shared/CommandMenu";
import { ApiClientError } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// Палитра поиска (⌘K).
//
// Что здесь проверяется и почему это важно именно сейчас: поиск стал одной из трёх
// кнопок мобильного бара, то есть на телефоне главным путём навигации. До этой
// правки `searchEntities` фильтровала три массива вымышленных записей из
// `lib/crm/mock-deals.ts` и `lib/repairs/mock-repairs.ts`, а найденная запись
// открывала список раздела — перехода по идентификатору не было вовсе
// (`ENTITY_HREF` содержал `/crm/deals` без id).
//
// `apiClient` подменён: проверяется поведение палитры, а не сеть. Задержка ввода
// прокручивается подменёнными таймерами — ждать 300 мс в каждом тесте незачем.
// ---------------------------------------------------------------------------

const getMock = vi.fn();
const pushMock = vi.fn();

vi.mock("@/lib/api/apiClient", async (importOriginal) => {
  // Настоящий `ApiClientError` сохраняется: по его `status` различаются «нет
  // права» и «сеть не отвечает», и подменённый класс сломал бы эту проверку.
  const actual = await importOriginal<typeof import("@/lib/api/apiClient")>();
  return {
    ...actual,
    apiClient: { get: (path: string, options?: unknown) => getMock(path, options) as unknown },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => "/crm/contacts",
  useSearchParams: () => new URLSearchParams(),
}));

let installedModules: { slug: string }[] = [];

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", role: "owner", permissions: new Set(["tenant:admin"]) },
    tenant: { tenantId: "tenant-1", tenantName: "Акме", installedModules },
  }),
}));

const deal = {
  id: "deal-1",
  title: "Ремонт кофемашины",
  contactName: "Иван Петров",
  companyName: "Акме",
};

const contact = {
  id: "contact-1",
  firstName: "Иван",
  lastName: "Петров",
  companyName: "Акме",
  phone: "+79161234567",
};

const company = { id: "company-1", name: "Акме", managerName: "Мария" };

const task = {
  id: "task-1",
  title: "Позвонить Ивану",
  dueDate: "2026-09-10T00:00:00.000Z",
};

const repair = {
  id: "repair-1",
  ticketNumber: "RO-0001",
  customerName: "Иван Петров",
  equipment: { brand: "DeLonghi", model: "Magnifica" },
};

/** Отвечает по пути: каждый источник своим списком. */
function respond(overrides: Record<string, unknown[]> = {}): void {
  getMock.mockImplementation(async (path: string) => {
    if (path.includes("/crm/deals")) return { data: overrides.deals ?? [deal] };
    if (path.includes("/crm/contacts")) return { data: overrides.contacts ?? [contact] };
    if (path.includes("/crm/companies")) return { data: overrides.companies ?? [company] };
    if (path.includes("/crm/tasks")) return { data: overrides.tasks ?? [task] };
    if (path.includes("/repairs")) return { data: overrides.repairs ?? [repair] };
    return { data: [] };
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPalette() {
  return render(<CommandMenu open onOpenChange={vi.fn()} />, { wrapper });
}

/** Ввод с прокруткой задержки: `userEvent` с подменёнными таймерами. */
async function type(text: string) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.type(screen.getByPlaceholderText(/Поиск/), text);
}

beforeEach(() => {
  getMock.mockReset();
  pushMock.mockReset();
  installedModules = [{ slug: "service_center" }];
  respond();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Палитра поиска", () => {
  it("при пустом запросе показывает навигацию, а не результаты", () => {
    renderPalette();

    // «Навигация» встречается дважды: заголовком секции и подписью к ↑↓ в
    // подвале. Проверяется содержимое секций, а не текст сам по себе.
    expect(screen.getByText("Быстрые действия")).toBeDefined();
    expect(screen.getByText("CRM / Сделки")).toBeDefined();
    expect(screen.queryByText("Сделки")).toBeNull();

    // Запросов быть не должно: пустой поиск нечего искать.
    expect(getMock).not.toHaveBeenCalled();
  });

  it("ищет по реальному API, а не по мокам", async () => {
    renderPalette();
    await type("иван");

    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    const paths = getMock.mock.calls.map((call) => call[0] as string);
    // Пять источников: сводного эндпоинта на бэкенде нет, а каждый список уже
    // умеет `?search=`.
    expect(paths.some((p) => p.includes("/crm/deals"))).toBe(true);
    expect(paths.some((p) => p.includes("/crm/contacts"))).toBe(true);
    expect(paths.some((p) => p.includes("/crm/companies"))).toBe(true);
    expect(paths.some((p) => p.includes("/crm/tasks"))).toBe(true);
    expect(paths.some((p) => p.includes("/repairs"))).toBe(true);
  });

  it("передаёт запрос параметром search", async () => {
    renderPalette();
    await type("иван");
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    const options = getMock.mock.calls[0]?.[1] as { query: { search: string } };
    expect(options.query.search).toBe("иван");
  });

  it("задерживает запрос, а не отправляет на каждое нажатие", async () => {
    renderPalette();
    await type("иванов");

    // До прокрутки задержки запросов нет: иначе «иванов» дал бы 6 × 5 = 30
    // обращений к API.
    expect(getMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(getMock).toHaveBeenCalled());

    // Ровно пять — по одному на источник, а не по одному на символ.
    expect(getMock.mock.calls.length).toBe(5);
  });

  it("группирует результаты по видам записей", async () => {
    renderPalette();
    await type("иван");
    await vi.advanceTimersByTimeAsync(400);

    // Двадцать строк одним списком не читаются: сделка и ремонт в них
    // неразличимы без заголовка.
    await waitFor(() => expect(screen.getByText("Сделки")).toBeDefined());
    expect(screen.getByText("Контакты")).toBeDefined();
    expect(screen.getByText("Компании")).toBeDefined();
    expect(screen.getByText("Задачи")).toBeDefined();
    expect(screen.getByText("Ремонты")).toBeDefined();
  });

  it("открывает саму запись, а не список раздела", async () => {
    renderPalette();
    await type("иван");
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByText("Ремонт кофемашины")).toBeDefined());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByText("Ремонт кофемашины"),
    );

    // Прежде здесь был `/crm/deals` без идентификатора: найденная сделка
    // открывала воронку целиком, и пользователь искал её глазами заново.
    expect(pushMock).toHaveBeenCalledWith("/crm/deals/deal-1");
  });

  it("ведёт на карточку контакта параметром record", async () => {
    renderPalette();
    await type("иван");
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByText("Иван Петров")).toBeDefined());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByText("Иван Петров"),
    );

    // У карточки контакта своего маршрута нет — она панель поверх списка,
    // поэтому ссылка выражается параметром.
    expect(pushMock).toHaveBeenCalledWith("/crm/contacts?record=contact-1");
  });

  it("открывает задачу параметром record", async () => {
    renderPalette();
    await type("иван");
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByText("Позвонить Ивану")).toBeDefined());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByText("Позвонить Ивану"),
    );

    // У задачи отдельной страницы нет: модальная форма открывается над списком.
    expect(pushMock).toHaveBeenCalledWith("/crm/tasks?record=task-1");
  });

  it("не запрашивает ремонты без установленного модуля", async () => {
    installedModules = [];
    renderPalette();
    await type("иван");
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    // Без модуля эндпоинт отвечает 403 MODULE_NOT_INSTALLED: запрос был бы
    // гарантированно неудачным.
    const paths = getMock.mock.calls.map((call) => call[0] as string);
    expect(paths.some((p) => p.includes("/repairs"))).toBe(false);
    // Задачи остаются: это базовая CRM, не модуль.
    expect(paths.some((p) => p.includes("/crm/tasks"))).toBe(true);
    expect(paths.length).toBe(4);
  });

  it("показывает «идёт поиск», пока ответ в пути", async () => {
    renderPalette();
    await type("иван");

    // До правки поиск был мгновенным (массивы в памяти), поэтому состояния
    // загрузки не было вовсе — при медленной сети палитра утверждала бы, что
    // записи нет, пока ответ в пути.
    expect(screen.getByText("Поиск...")).toBeDefined();
  });

  it("сообщает о недоступности бэкенда, а не о пустом результате", async () => {
    getMock.mockRejectedValue(new Error("network down"));
    renderPalette();
    await type("иван");
    await vi.advanceTimersByTimeAsync(400);

    // Недоступный бэкенд не должен выглядеть как «ничего не найдено»: иначе
    // пользователь решит, что записи нет, и заведёт её второй раз. Первый вариант
    // `fetchSource` глотал любую ошибку, и это состояние было недостижимым.
    await waitFor(() => expect(screen.getByText("Не удалось выполнить поиск")).toBeDefined());
    expect(screen.queryByText(/Ничего не найдено/)).toBeNull();
  });

  it("не считает отказ по правам ошибкой поиска", async () => {
    // 403 по сделкам, остальное работает: у роли нет права на сделки, но есть на
    // контакты — это «здесь искать нечего», а не «поиск сломан».
    getMock.mockImplementation(async (path: string) => {
      if (path.includes("/crm/deals")) {
        throw new ApiClientError(403, {
          error: { code: "PERMISSION_DENIED", message: "Нет доступа" },
        });
      }
      if (path.includes("/crm/contacts")) return { data: [contact] };
      return { data: [] };
    });

    renderPalette();
    await type("иван");
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByText("Иван Петров")).toBeDefined());
    expect(screen.queryByText("Не удалось выполнить поиск")).toBeNull();
    expect(screen.queryByText("Сделки")).toBeNull();
  });

  it("показывает «ничего не найдено» на пустой ответ", async () => {
    respond({ deals: [], contacts: [], companies: [], tasks: [], repairs: [] });
    renderPalette();
    await type("зззз");
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByText(/Ничего не найдено/)).toBeDefined());
  });
});
