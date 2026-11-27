import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DealProductsServicesTab } from "@/components/crm/deals/DealProductsServicesTab";
import type { DealDTO } from "@/lib/api/use-deals";
import type { WarehouseItemDTO } from "@/lib/api/use-warehouse";
import type { ServiceItemDTO } from "@/lib/api/use-services";

const addItemMutateAsync = vi.fn();
const deleteItemMutateAsync = vi.fn();
const createPurchaseMutateAsync = vi.fn();
const createServiceMutateAsync = vi.fn();

const mockWarehouseItems: WarehouseItemDTO[] = [
  {
    id: "wh-1",
    sku: "TYA-001",
    name: "Плата питания Тоя 12В",
    brand: "Toyo",
    category: "Электроника",
    unit: "шт",
    minStock: 1,
    retailPrice: 4500,
    price: 4500,
    costPrice: 2100,
    fifoCostPrice: 2300,
    avgBatchCostPrice: 2300,
    stockValuation: 11500,
    activeBatchesCount: 2,
    totalStock: 5,
    quantity: 5,
    reservedStock: 1,
    availableStock: 4,
    reserved: true,
    status: "reserved",
    stockStatus: "reserved",
    models: [{ id: "m-1", name: "TOYA-300", brandId: "b-1", brandName: "Toyo" }],
    modelIds: ["m-1"],
    modelNames: ["TOYA-300"],
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
  },
  {
    id: "wh-2",
    sku: "TYA-002",
    name: "Подшипник шпинделя 6204",
    brand: "SKF",
    category: "Механика",
    unit: "шт",
    minStock: 2,
    retailPrice: 1200,
    price: 1200,
    costPrice: 600,
    fifoCostPrice: 600,
    avgBatchCostPrice: 600,
    stockValuation: 0,
    activeBatchesCount: 0,
    totalStock: 0,
    quantity: 0,
    reservedStock: 0,
    availableStock: 0,
    reserved: false,
    status: "out_of_stock",
    stockStatus: "out_of_stock",
    models: [],
    modelIds: [],
    modelNames: [],
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
  },
];

const mockServices: ServiceItemDTO[] = [
  {
    id: "srv-1",
    name: "Диагностика оборудования Тоя",
    description: "Полная дефектовка узлов",
    price: 1500,
    defaultPrice: 1500,
    unit: "усл",
    durationMinutes: 60,
    createdAt: "2026-11-01T10:00:00Z",
  },
  {
    id: "srv-2",
    name: "Замена платы управления",
    description: "Демонтаж, установка и проверка",
    price: 3000,
    defaultPrice: 3000,
    unit: "усл",
    durationMinutes: 90,
    createdAt: "2026-11-01T10:00:00Z",
  },
];

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: vi.fn(() => ({
    tenant: {
      id: "tenant-1",
      installedModules: ["crm", "service_center", "finance"],
    },
  })),
}));

vi.mock("@/lib/api/use-invoices", () => ({
  useDealEconomics: vi.fn(() => ({ data: undefined })),
}));

vi.mock("@/lib/api/use-deals", () => ({
  useDealItems: vi.fn(() => ({
    data: { data: [], totalBudget: 0 },
    isLoading: false,
  })),
  useAddDealItem: vi.fn(() => ({
    mutateAsync: addItemMutateAsync,
    isPending: false,
  })),
  useDeleteDealItem: vi.fn(() => ({
    mutateAsync: deleteItemMutateAsync,
    isPending: false,
  })),
}));

vi.mock("@/lib/api/use-warehouse", () => ({
  useWarehouseItems: vi.fn(() => ({
    data: mockWarehouseItems,
    isLoading: false,
    isError: false,
  })),
  useWarehouseSettings: vi.fn(() => ({
    data: { allowNegativeStock: true },
  })),
  usePurchaseRequests: vi.fn(() => ({
    data: [],
  })),
  useCreatePurchaseRequest: vi.fn(() => ({
    mutateAsync: createPurchaseMutateAsync,
    isPending: false,
  })),
}));

vi.mock("@/lib/api/use-services", () => ({
  useServices: vi.fn(() => ({
    data: mockServices,
    isLoading: false,
    isError: false,
  })),
  useCreateService: vi.fn(() => ({
    mutateAsync: createServiceMutateAsync,
    isPending: false,
  })),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function makeDeal(): DealDTO {
  return {
    id: "deal-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    contactId: null,
    companyId: null,
    companyName: null,
    contactName: null,
    ownerName: null,
    title: "ремонт тоя заказ",
    description: "",
    budget: 0,
    currency: "RUB",
    customFields: {},
    sourceMetadata: {},
    createdBy: "user-1",
    ownerId: "user-1",
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: "2026-11-27T10:00:00Z",
    updatedAt: "2026-11-27T10:00:00Z",
  };
}

describe("DealProductsServicesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addItemMutateAsync.mockResolvedValue({ id: "di-1" });
    createServiceMutateAsync.mockResolvedValue({
      id: "srv-new",
      name: "Калибровка датчика",
      description: "",
      price: 2000,
      defaultPrice: 2000,
      unit: "усл",
      durationMinutes: null,
      createdAt: "2026-11-27T10:00:00Z",
    });
  });

  it("searches warehouse catalog like Service Center and submits selected product with item_id and FIFO cost", async () => {
    render(<DealProductsServicesTab deal={makeDeal()} />);

    fireEvent.click(screen.getByRole("button", { name: /Добавить позицию/i }));

    // При пустой форме не должно быть преждевременного предупреждения о ручном товаре
    expect(screen.queryByText(/Товар введён вручную/i)).toBeNull();

    const searchInput = screen.getByRole("combobox");
    fireEvent.focus(searchInput);

    // Ищем по комбинации токенов (артикул + модель, как в СЦ matchesWarehouseItem)
    fireEvent.change(searchInput, { target: { value: "TYA-001 TOYA-300" } });

    expect(screen.getByText("Плата питания Тоя 12В")).toBeDefined();
    expect(screen.queryByText("Подшипник шпинделя 6204")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Плата питания Тоя 12В/i }));

    // Позиция привязана к складу и показано наличие
    expect(screen.getByText(/Привязано к складу/i)).toBeDefined();
    expect(screen.getByText(/В наличии на складе:/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Добавить в сделку/i }));

    await waitFor(() => {
      expect(addItemMutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(addItemMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        item_type: "product",
        item_id: "wh-1",
        name: "Плата питания Тоя 12В",
        sku: "TYA-001",
        price: 4500,
        cost_price: 2300,
        quantity: 1,
        unit: "шт",
        save_to_catalog: false,
        add_to_purchase_request: false,
      }),
    );
  });

  it("auto-enables purchase request on out-of-stock warehouse product and resets item_id when edited manually", async () => {
    render(<DealProductsServicesTab deal={makeDeal()} />);

    fireEvent.click(screen.getByRole("button", { name: /Добавить позицию/i }));

    const searchInput = screen.getByRole("combobox");
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "6204 SKF" } });
    fireEvent.click(screen.getByRole("button", { name: /Подшипник шпинделя 6204/i }));

    expect(screen.getByText(/Недостаточно на складе:/i)).toBeDefined();
    const purchaseCheckbox = screen.getByLabelText(/Создать заявку на закупку/i) as HTMLInputElement;
    expect(purchaseCheckbox.checked).toBe(true);

    // Если пользователь изменил название вручную — привязка к старому item_id должна сброситься
    fireEvent.change(searchInput, { target: { value: "Кастомная деталь без каталога" } });
    expect(screen.queryByText(/Привязано к складу/i)).toBeNull();
    expect(screen.getByText(/Товар введён вручную/i)).toBeDefined();

    const saveCheckbox = screen.getByLabelText(/Сохранить в номенклатуру склада/i) as HTMLInputElement;
    fireEvent.click(saveCheckbox);
    expect(saveCheckbox.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Добавить в сделку/i }));

    await waitFor(() => {
      expect(addItemMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          item_type: "product",
          item_id: null,
          name: "Кастомная деталь без каталога",
          save_to_catalog: true,
        }),
      );
    });
  });

  it("searches services catalog and allows saving a new service to catalog directly from dropdown", async () => {
    render(<DealProductsServicesTab deal={makeDeal()} />);

    fireEvent.click(screen.getByRole("button", { name: /Добавить позицию/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Услуга$/i }));

    const searchInput = screen.getByRole("combobox");
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "дефектовка" } });

    // Поиск работает и по description (matchesSearchTokens)
    expect(screen.getByText("Диагностика оборудования Тоя")).toBeDefined();
    expect(screen.queryByText("Замена платы управления")).toBeNull();

    // Вводим новую услугу — появляется кнопка быстрого сохранения в справочник как в WorkItemsTable
    fireEvent.change(searchInput, { target: { value: "Калибровка датчика" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить в справочник/i }));

    await waitFor(() => {
      expect(createServiceMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Калибровка датчика",
        }),
      );
    });

    expect(screen.getByText(/Из справочника услуг/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Добавить в сделку/i }));

    await waitFor(() => {
      expect(addItemMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          item_type: "service",
          item_id: "srv-new",
          name: "Калибровка датчика",
        }),
      );
    });
  });
});
