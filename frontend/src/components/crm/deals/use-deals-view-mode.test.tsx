import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { useDealsViewMode } from "@/components/crm/deals/use-deals-view-mode";

// ---------------------------------------------------------------------------
// Режим отображения сделок: канбан или список.
//
// До этого вид жил в `useState("kanban")` и сбрасывался при каждом заходе на
// страницу: менеджер, работающий списком, каждый раз возвращался в канбан.
//
// Хранится вместе с раскладкой колонок, а не отдельным ключом: это часть
// представления таблицы сделок, и план прямо требует держать `view_mode` рядом с
// раскладкой. Побочно вид переезжает между браузерами — как и ширины колонок.
//
// Проверяется через компонент, а не `renderHook().result.current`: у хука
// стабильные ссылки, и `result.current.setViewMode` из первого рендера вызывался
// с устаревшим замыканием — тесты падали на верной реализации, что подтвердилось
// кликом по настоящей кнопке.
// ---------------------------------------------------------------------------

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/lib/api/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/apiClient")>();
  return {
    ...actual,
    apiClient: {
      get: (path: string) => getMock(path) as unknown,
      put: (path: string, body?: unknown) => putMock(path, body) as unknown,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

/** Минимальный потребитель хука: переключатель вида, как в тулбаре сделок. */
function ViewSwitch() {
  const { viewMode, setViewMode } = useDealsViewMode();

  return (
    <>
      <output data-testid="mode">{viewMode}</output>
      <button type="button" onClick={() => setViewMode("table")}>Список</button>
      <button type="button" onClick={() => setViewMode("kanban")}>Канбан</button>
    </>
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const LAYOUT_KEY = "getvoxly.recordTable.v1.deals";

function currentMode(): string {
  return screen.getByTestId("mode").textContent ?? "";
}

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
  putMock.mockImplementation(async (_path: string, body: unknown) => ({
    data: { tableId: "deals", layout: body, updatedAt: new Date().toISOString() },
  }));
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Режим отображения сделок", () => {
  it("по умолчанию канбан", async () => {
    getMock.mockResolvedValue({ data: null });
    render(<ViewSwitch />, { wrapper });

    await waitFor(() => expect(currentMode()).toBe("kanban"));
  });

  it("применяет режим из серверной раскладки", async () => {
    getMock.mockResolvedValue({
      data: {
        tableId: "deals",
        layout: { widths: {}, order: [], hidden: [], viewMode: "table" },
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    });

    render(<ViewSwitch />, { wrapper });

    // Ровно то, чего не было: выбор пользователя переживает перезагрузку и
    // переезжает между браузерами.
    await waitFor(() => expect(currentMode()).toBe("table"));
  });

  it("сохраняет режим на сервер вместе с раскладкой", async () => {
    getMock.mockResolvedValue({
      data: {
        tableId: "deals",
        layout: { widths: { title: 320 }, order: ["title"], hidden: [] },
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    });

    render(<ViewSwitch />, { wrapper });
    await waitFor(() => expect(currentMode()).toBe("kanban"));

    await userEvent.setup().click(screen.getByRole("button", { name: "Список" }));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [path, body] = putMock.mock.calls[0] ?? [];

    expect(path).toBe("/api/v1/crm/table-layouts/deals");
    // Ширины и порядок не теряются: PUT заменяет раскладку целиком, поэтому
    // сохранять нужно всю, а не одно поле.
    expect(body).toEqual({
      widths: { title: 320 },
      order: ["title"],
      hidden: [],
      viewMode: "table",
    });
  });

  it("отвечает на переключение сразу", async () => {
    getMock.mockResolvedValue({ data: null });
    render(<ViewSwitch />, { wrapper });
    await waitFor(() => expect(currentMode()).toBe("kanban"));

    await userEvent.setup().click(screen.getByRole("button", { name: "Список" }));

    // Переключатель вида должен отзываться мгновенно: ожидание ответа читается
    // как «кнопка не сработала».
    expect(currentMode()).toBe("table");
  });

  it("зеркалит выбор в localStorage как fallback", async () => {
    getMock.mockResolvedValue({ data: null });
    render(<ViewSwitch />, { wrapper });
    await waitFor(() => expect(currentMode()).toBe("kanban"));

    await userEvent.setup().click(screen.getByRole("button", { name: "Список" }));

    // Без зеркала следующий холодный старт до ответа GET вернул бы канбан.
    const stored = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? "{}");
    expect(stored.viewMode).toBe("table");
  });

  it("держит режим локально, когда сервер недоступен", async () => {
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ widths: {}, order: [], hidden: [], viewMode: "table" }),
    );
    getMock.mockRejectedValue(new Error("network down"));

    render(<ViewSwitch />, { wrapper });

    // Отказ сети — не повод возвращать канбан: локальный кэш остаётся рабочим
    // источником, как и для раскладки колонок.
    await waitFor(() => expect(currentMode()).toBe("table"));
    expect(putMock).not.toHaveBeenCalled();
  });

  it("не пишет на сервер, пока он недоступен", async () => {
    getMock.mockRejectedValue(new Error("network down"));
    render(<ViewSwitch />, { wrapper });
    await waitFor(() => expect(currentMode()).toBe("kanban"));

    await userEvent.setup().click(screen.getByRole("button", { name: "Список" }));

    // Запись при недоступном GET создала бы на сервере состояние, которого
    // пользователь на этом устройстве не выбирал осознанно.
    expect(currentMode()).toBe("table");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("игнорирует неизвестное значение в раскладке", async () => {
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ widths: {}, order: [], hidden: [], viewMode: "spreadsheet" }),
    );
    getMock.mockResolvedValue({ data: null });

    render(<ViewSwitch />, { wrapper });

    // Испорченная запись означает возврат к умолчанию, а не пустой экран.
    await waitFor(() => expect(currentMode()).toBe("kanban"));
  });
});
