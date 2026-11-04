import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { RepairIntakeModal } from "./RepairIntakeModal";

vi.mock("@/lib/api/use-team", () => ({
  useTeamMembers: () => ({
    data: {
      members: [
        { id: "master-1", fullName: "Мастер Иван", role: "technician" },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/api/use-deals", () => ({
  useDeals: () => ({
    data: { items: [], total: 0 },
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
    expect(screen.getByText("Выбрать сделку")).toBeDefined();
    expect(screen.getByText("Новый клиент / сделка")).toBeDefined();
    expect(screen.getByText("Оборудование")).toBeDefined();
  });
});
