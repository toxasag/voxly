import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { WorkItemsTable } from "./WorkItemsTable";
import type {
  RepairMasterDTO,
  RepairServiceCatalogItemDTO,
} from "@/lib/api/use-repairs";

const mockCatalogServices: RepairServiceCatalogItemDTO[] = [
  {
    id: "svc-1",
    name: "Очистка и смазка деталей",
    description: "Базовое ТО",
    defaultPrice: 1000,
    unit: "усл",
    durationMinutes: 30,
    createdAt: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "svc-2",
    name: "Пайка коннектора питания",
    defaultPrice: 800,
    unit: "усл",
    durationMinutes: 20,
    createdAt: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "svc-3",
    name: "Промывка деталей в ультразвуковой ванне",
    defaultPrice: 1600,
    unit: "усл",
    durationMinutes: 40,
    createdAt: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "svc-4",
    name: "Сборка/Разборка",
    defaultPrice: 1000,
    unit: "усл",
    durationMinutes: 30,
    createdAt: "2026-11-01T10:00:00.000Z",
  },
];

const mockMasters: RepairMasterDTO[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Даниил Доносов",
    email: "master@remtoua.ru",
    phone: "+79990001122",
    role: "manager",
  },
];

const createWorkMutateAsync = vi.fn();
const createWorksBatchMutateAsync = vi.fn();
const deleteWorkMutateAsync = vi.fn();
const addServiceMutateAsync = vi.fn();
const deleteServiceMutateAsync = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/api/use-team", () => ({
  useTeamMembers: () => ({ data: { members: [] } }),
}));

vi.mock("@/components/services/EditServiceModal", () => ({
  EditServiceModal: () => null,
}));

vi.mock("@/lib/api/use-repairs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRepairMasters: () => ({ data: mockMasters }),
    useRepairServicesCatalog: () => ({ data: mockCatalogServices, isLoading: false }),
    useAddRepairServiceToCatalog: () => ({
      mutateAsync: addServiceMutateAsync,
      isPending: false,
    }),
    useDeleteRepairServiceFromCatalog: () => ({
      mutateAsync: deleteServiceMutateAsync,
      isPending: false,
    }),
    useCreateWork: () => ({
      mutateAsync: createWorkMutateAsync,
      isPending: false,
    }),
    useCreateWorksBatch: () => ({
      mutateAsync: createWorksBatchMutateAsync,
      isPending: false,
    }),
    useDeleteWork: () => ({
      mutateAsync: deleteWorkMutateAsync,
      isPending: false,
    }),
  };
});

describe("WorkItemsTable — мультивыбор услуг", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createWorkMutateAsync.mockResolvedValue({
      id: "w-1",
      description: "Диагностика",
      masterId: mockMasters[0].id,
      masterName: mockMasters[0].fullName,
      quantity: 1,
      unitPrice: 500,
      cost: 500,
      createdAt: "2026-11-26T10:00:00.000Z",
    });
    createWorksBatchMutateAsync.mockResolvedValue({
      items: [],
      addedCount: 2,
      mergedCount: 0,
    });
  });

  it("позволяет выбрать несколько услуг в выпадающем списке и добавить их одним пакетом", async () => {
    const onDraftStateChange = vi.fn();
    render(
      <WorkItemsTable
        orderId="order-123"
        items={[]}
        onDraftStateChange={onDraftStateChange}
      />,
    );

    const input = screen.getByPlaceholderText("Выберите из каталога или введите работу...");
    fireEvent.focus(input);

    // Кликаем по двум услугам — дропдаун должен остаться открытым
    fireEvent.click(screen.getByText("Очистка и смазка деталей"));
    fireEvent.click(screen.getByText("Пайка коннектора питания"));

    expect(screen.getByText("Каталог типовых услуг")).toBeTruthy();
    expect(screen.getByText("Выбрано услуг: 2")).toBeTruthy();
    expect(onDraftStateChange).toHaveBeenLastCalledWith("выбрано услуг: 2");

    // Увеличиваем количество второй услуги с 1 до 2 прямо в выпадающем списке
    fireEvent.click(screen.getByLabelText("Увеличить количество: Пайка коннектора питания"));

    // Нажимаем «Добавить выбранные (2)»
    fireEvent.click(screen.getByRole("button", { name: /Добавить выбранные \(2\)/i }));

    await waitFor(() => {
      expect(createWorksBatchMutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(createWorksBatchMutateAsync).toHaveBeenCalledWith({
      orderId: "order-123",
      payload: {
        items: [
          {
            description: "Очистка и смазка деталей",
            master_id: mockMasters[0].id,
            master_name: "Даниил Доносов",
            quantity: 1,
            unit_price: 1000,
            cost: 1000,
          },
          {
            description: "Пайка коннектора питания",
            master_id: mockMasters[0].id,
            master_name: "Даниил Доносов",
            quantity: 2,
            unit_price: 800,
            cost: 1600,
          },
        ],
      },
    });

    // После добавления выбор очищается
    await waitFor(() => {
      expect(screen.queryByText("Выбрано услуг: 2")).toBeNull();
    });
  });

  it("поддерживает «Выбрать все» и «Снять все» в выпадающем каталоге", () => {
    render(<WorkItemsTable orderId="order-123" items={[]} />);

    const input = screen.getByPlaceholderText("Выберите из каталога или введите работу...");
    fireEvent.focus(input);

    fireEvent.click(screen.getByRole("button", { name: "Выбрать все" }));
    expect(screen.getByText("Выбрано услуг: 4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Снять все" }));
    expect(screen.queryByText(/Выбрано услуг:/)).toBeNull();
  });

  it("позволяет массово выбрать и добавить услуги через диалог «Справочник услуг»", async () => {
    render(<WorkItemsTable orderId="order-123" items={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Справочник услуг/i }));

    fireEvent.click(screen.getByLabelText("Выбрать услугу Промывка деталей в ультразвуковой ванне"));
    fireEvent.click(screen.getByLabelText("Выбрать услугу Сборка/Разборка"));

    fireEvent.click(screen.getByRole("button", { name: /Добавить выбранные \(2\)/i }));

    await waitFor(() => {
      expect(createWorksBatchMutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(createWorksBatchMutateAsync).toHaveBeenCalledWith({
      orderId: "order-123",
      payload: {
        items: [
          {
            description: "Промывка деталей в ультразвуковой ванне",
            master_id: mockMasters[0].id,
            master_name: "Даниил Доносов",
            quantity: 1,
            unit_price: 1600,
            cost: 1600,
          },
          {
            description: "Сборка/Разборка",
            master_id: mockMasters[0].id,
            master_name: "Даниил Доносов",
            quantity: 1,
            unit_price: 1000,
            cost: 1000,
          },
        ],
      },
    });
  });

  it("сохраняет ручное добавление одной произвольной работы", async () => {
    render(<WorkItemsTable orderId="order-123" items={[]} />);

    const descInput = screen.getByPlaceholderText("Выберите из каталога или введите работу...");
    const priceInput = screen.getByPlaceholderText("Цена/ед.");

    fireEvent.change(descInput, { target: { value: "Нестандартная настройка" } });
    fireEvent.change(priceInput, { target: { value: "2500" } });

    fireEvent.click(screen.getByTitle("Добавить работу"));

    await waitFor(() => {
      expect(createWorkMutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(createWorkMutateAsync).toHaveBeenCalledWith({
      orderId: "order-123",
      payload: {
        description: "Нестандартная настройка",
        master_id: mockMasters[0].id,
        master_name: "Даниил Доносов",
        quantity: 1,
        unit_price: 2500,
        cost: 2500,
      },
    });
  });
});
