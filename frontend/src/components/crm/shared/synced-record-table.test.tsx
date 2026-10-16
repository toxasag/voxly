import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { SyncedRecordTable } from "@/components/crm/shared/SyncedRecordTable";
import {
  LAYOUT_STORAGE_PREFIX,
  type ColumnLayout,
} from "@/components/crm/shared/use-record-table-layout";
import type { RecordColumn } from "@/components/crm/shared/RecordTable";

// ---------------------------------------------------------------------------
// Раскладка колонок, синхронизированная с сервером.
//
// До этого ширины, порядок и видимость жили только в localStorage: на другом
// браузере таблица возвращалась к умолчаниям. Проверяется главное свойство —
// **remote побеждает local**: устройство с устаревшим кэшем не должно затирать
// раскладку, сохранённую с другого браузера.
//
// `SyncedRecordTable` — единственное место, где таблица знает про Query: сам
// `RecordTable` и `useRecordTableLayout` остаются Query-free, поэтому их тесты
// работают без провайдера.
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

interface Row {
  id: string;
  name: string;
  phone: string;
}

const ROWS: Row[] = [{ id: "1", name: "Иван Петров", phone: "+79161234567" }];

const COLUMNS: RecordColumn<Row>[] = [
  { id: "name", header: "ФИО", width: 200, render: (row) => row.name },
  { id: "phone", header: "Телефон", width: 160, hideable: true, render: (row) => row.phone },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderTable() {
  return render(
    <SyncedRecordTable rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} tableId="contacts" />,
    { wrapper },
  );
}

function storedLocally(): ColumnLayout | null {
  const raw = window.localStorage.getItem(`${LAYOUT_STORAGE_PREFIX}contacts`);
  return raw === null ? null : (JSON.parse(raw) as ColumnLayout);
}

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
  putMock.mockImplementation(async (_path: string, body: unknown) => ({
    data: { tableId: "contacts", layout: body, updatedAt: new Date().toISOString() },
  }));
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("Раскладка с сервера", () => {
  it("запрашивает раскладку по своему tableId", async () => {
    getMock.mockResolvedValue({ data: null });
    renderTable();

    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/api/v1/crm/table-layouts/contacts"));
  });

  it("применяет серверную раскладку поверх локальной", async () => {
    // Локально «Телефон» скрыт, на сервере — видим и шире.
    window.localStorage.setItem(
      `${LAYOUT_STORAGE_PREFIX}contacts`,
      JSON.stringify({ widths: { name: 200 }, order: [], hidden: ["phone"] }),
    );
    getMock.mockResolvedValue({
      data: {
        tableId: "contacts",
        layout: { widths: { name: 320 }, order: ["phone", "name"], hidden: [] },
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    });

    const { container } = renderTable();

    // Именно это свойство защищает раскладку от устаревшего кэша устройства.
    await waitFor(() => {
      const grid = container.querySelector<HTMLElement>("[style*='--rt-col-name']");
      expect(grid?.style.getPropertyValue("--rt-col-name")).toBe("320px");
    });
    expect(screen.getByText("+79161234567")).toBeDefined();
  });

  it("зеркалит серверную раскладку в localStorage как fallback", async () => {
    getMock.mockResolvedValue({
      data: {
        tableId: "contacts",
        layout: { widths: { name: 280 }, order: [], hidden: [] },
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    });

    renderTable();

    // Без зеркала следующий холодный старт до ответа GET показывал бы умолчания.
    await waitFor(() => expect(storedLocally()?.widths.name).toBe(280));
  });

  it("мигрирует legacy localStorage только после подтверждённого null с сервера", async () => {
    const legacy = { widths: { name: 260 }, order: ["phone", "name"], hidden: [] };
    window.localStorage.setItem(`${LAYOUT_STORAGE_PREFIX}contacts`, JSON.stringify(legacy));
    getMock.mockResolvedValue({ data: null });

    renderTable();

    // GET подтвердил отсутствие записи; только теперь локальная настройка может
    // стать серверной. До ответа такой PUT затёр бы раскладку другого браузера.
    await waitFor(() => expect(putMock).toHaveBeenCalledWith(
      "/api/v1/crm/table-layouts/contacts",
      legacy,
    ));
  });

  it("не мигрирует localStorage поверх существующей серверной раскладки", async () => {
    window.localStorage.setItem(
      `${LAYOUT_STORAGE_PREFIX}contacts`,
      JSON.stringify({ widths: { name: 200 }, order: [], hidden: ["phone"] }),
    );
    getMock.mockResolvedValue({
      data: {
        tableId: "contacts",
        layout: { widths: { name: 320 }, order: ["phone", "name"], hidden: [] },
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    });

    renderTable();

    await waitFor(() => expect(screen.getByText("+79161234567")).toBeDefined());
    // Remote побеждает local без миграции: иначе старое устройство затёрло бы
    // раскладку, сохранённую с другого браузера.
    expect(putMock).not.toHaveBeenCalled();
  });

  it("сохраняет изменение на сервер", async () => {
    getMock.mockResolvedValue({ data: null });
    renderTable();

    await waitFor(() => expect(screen.getByRole("button", { name: /Колонки/ })).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Колонки/ }));
    const menuItem = screen
      .getAllByRole("button", { name: /^Телефон/ })
      .find((button) => !(button.textContent ?? "").includes("▼"));
    await user.click(menuItem!);

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [path, body] = putMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/v1/crm/table-layouts/contacts");
    expect((body as ColumnLayout).hidden).toContain("phone");
  });

  it("остаётся работоспособной, когда GET упал", async () => {
    window.localStorage.setItem(
      `${LAYOUT_STORAGE_PREFIX}contacts`,
      JSON.stringify({ widths: { name: 240 }, order: [], hidden: [] }),
    );
    getMock.mockRejectedValue(new Error("network down"));

    const { container } = renderTable();

    // Отказ GET — это offline, а не «на сервере пусто»: работаем на локальном
    // fallback и не выдаём его за серверное состояние.
    await waitFor(() => {
      const grid = container.querySelector<HTMLElement>("[style*='--rt-col-name']");
      expect(grid?.style.getPropertyValue("--rt-col-name")).toBe("240px");
    });
    expect(putMock).not.toHaveBeenCalled();
  });
});
