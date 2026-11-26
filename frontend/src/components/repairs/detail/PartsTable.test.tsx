import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { PartsTable } from "./PartsTable";
import type { PartItem } from "@/lib/repairs/repairs.types";

const createPartMutateAsync = vi.fn();
const updatePartMutateAsync = vi.fn();
const deletePartMutateAsync = vi.fn();
const createPurchaseMutateAsync = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  };
});

vi.mock("./PartAddModal", () => ({
  PartAddModal: () => null,
}));

vi.mock("@/lib/api/use-warehouse", () => ({
  warehouseKeys: { all: ["warehouse"] },
  useWarehouseItems: () => ({
    data: [
      {
        id: "wh-1",
        name: "DCCN40 поз.30 Держатель ствола",
        sku: "",
        retailPrice: 1280,
        costPrice: 448,
        fifoCostPrice: 448,
        availableStock: 5,
        totalStock: 5,
      },
    ],
    isLoading: false,
  }),
  useWarehouseSettings: () => ({ data: { allowNegativeStock: true } }),
  usePurchaseRequests: () => ({ data: [] }),
  useCreatePurchaseRequest: () => ({
    mutateAsync: createPurchaseMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/lib/api/use-repairs", () => ({
  useCreatePart: () => ({
    mutateAsync: createPartMutateAsync,
    isPending: false,
  }),
  useUpdatePart: () => ({
    mutateAsync: updatePartMutateAsync,
    isPending: false,
  }),
  useDeletePart: () => ({
    mutateAsync: deletePartMutateAsync,
    isPending: false,
  }),
}));

describe("PartsTable — инлайн-редактирование розничной цены запчасти", () => {
  const sampleParts: PartItem[] = [
    {
      id: "part-1",
      warehouse_item_id: "wh-1",
      status: "reserved",
      name: "DCCN40 поз.30 Держатель ствола",
      article: "Б/А",
      quantity: 1,
      retail_price: 1280,
      cost_price: 448,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    updatePartMutateAsync.mockResolvedValue({
      id: "part-1",
      retailPrice: 1200,
    });
  });

  it("позволяет изменить розничную цену прямо в строке и отправляет PATCH через useUpdatePart", async () => {
    render(<PartsTable orderId="order-1" items={sampleParts} />);

    // Кликаем на кнопку цены «1 280 ₽»
    const priceBtn = screen.getByTitle(
      "Изменить розничную цену (сохранится в наряде и карточке товара на складе)",
    );
    fireEvent.click(priceBtn);

    const input = screen.getByLabelText("Розничная цена: DCCN40 поз.30 Держатель ствола");
    fireEvent.change(input, { target: { value: "1200" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(updatePartMutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(updatePartMutateAsync).toHaveBeenCalledWith({
      orderId: "order-1",
      partId: "part-1",
      payload: { retail_price: 1200 },
    });
  });
});
