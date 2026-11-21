import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { RepairIntakeModal } from "./RepairIntakeModal";

const MOCK_USER = {
  id: "master-1",
  name: "Мастер Иван",
  email: "ivan@example.com",
  role: "technician",
  permissions: new Set(["service_center:write"]),
};

const MOCK_TEAM_RESULT = {
  data: {
    members: [
      { id: "master-1", fullName: "Мастер Иван", role: "technician", status: "active" },
    ],
  },
  isLoading: false,
};

const MOCK_MASTERS_RESULT = {
  data: [{ id: "master-1", fullName: "Мастер Иван", role: "technician" }],
  isLoading: false,
};

const MOCK_DICTIONARIES_RESULT = {
  data: {
    types: ["Смартфон", "Ноутбук"],
    brands: ["Apple", "Samsung"],
    models: ["iPhone 15 Pro", "Galaxy S24"],
    accessories: ["Обойма", "2 АКБ", "Кейс"],
    malfunctions: ["Не включается", "Разбит экран", "Не стреляет"],
  },
  isLoading: false,
};

const MOCK_EMPTY_LOOKUP = {
  data: undefined,
  isLoading: false,
  isFetching: false,
};

vi.mock("@/lib/auth/use-auth", () => ({
  useCurrentUser: () => MOCK_USER,
}));

vi.mock("@/lib/api/use-team", () => ({
  useTeamMembers: () => MOCK_TEAM_RESULT,
}));

vi.mock("@/lib/api/use-deals", () => ({
  useDeals: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
  }),
  useDeal: () => ({
    data: undefined,
    isLoading: false,
  }),
  useCreateDeal: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  usePipelines: () => ({
    data: [],
    isLoading: false,
  }),
  useKanban: () => ({
    data: [],
    isLoading: false,
  }),
}));

vi.mock("@/lib/api/use-contacts", () => ({
  useContacts: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
  }),
  useContact: () => ({
    data: null,
    isLoading: false,
  }),
  useContactLookup: () => ({
    data: null,
    isFetching: false,
  }),
  useFindDuplicateContacts: () => ({
    data: [],
    isLoading: false,
  }),
}));

vi.mock("@/lib/api/use-companies", () => ({
  useCompanies: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
  }),
  useCompany: () => ({
    data: null,
    isLoading: false,
  }),
}));

vi.mock("@/lib/api/use-repairs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRepairClientLookup: () => MOCK_EMPTY_LOOKUP,
    useCompanyInnLookup: () => MOCK_EMPTY_LOOKUP,
    useRepairDictionaries: () => MOCK_DICTIONARIES_RESULT,
    useAddRepairDictionaryItem: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useRenameRepairDictionaryItem: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useDeleteRepairDictionaryItem: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useSearchEquipmentBySerial: () => ({
      data: undefined,
      isFetching: false,
    }),
    useRepairMasters: () => MOCK_MASTERS_RESULT,
  };
});

describe("RepairIntakeModal Component", () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when open is false", () => {
    render(
      <RepairIntakeModal
        open={false}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    expect(screen.queryByText("Приёмка оборудования")).toBeNull();
  });

  it("renders modal with Client section and Equipment fields when open is true", () => {
    render(
      <RepairIntakeModal
        open={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />,
    );

    expect(screen.getByText("Приёмка оборудования")).toBeDefined();
    expect(screen.getByText("Клиент и сделка")).toBeDefined();
    expect(screen.getByText("Оборудование")).toBeDefined();
    expect(screen.getByText("Тип оборудования")).toBeDefined();
    expect(screen.getByText("Бренд")).toBeDefined();
    expect(screen.getByText("Модель")).toBeDefined();
    expect(screen.getByText("Комплектация")).toBeDefined();
    expect(screen.getByText("Заявленные неисправности")).toBeDefined();
    expect(screen.getByText("Внешний вид")).toBeDefined();
  });
});
