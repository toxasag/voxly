import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useForm } from "react-hook-form";
import { RepairClientSection } from "./RepairClientSection";
import type { CreateRepairPayload } from "@/schemas/repair.schema";
import type { ClientLookupResultDTO } from "@/lib/api/use-repairs";

// Mock useRepairClientLookup
const mockLookupData: ClientLookupResultDTO = {
  found: true,
  client: {
    id: "contact-55",
    firstName: "Алексей",
    lastName: "Смирнов",
    middleName: "Иванович",
    phone: "+79997776655",
    email: "smirnov@test.ru",
    companyId: "comp-10",
    companyName: "ООО СпецСервис",
  },
  company: {
    id: "comp-10",
    name: "ООО СпецСервис",
    inn: "7701234567",
    ogrn: "1027700132195",
    bik: "044525225",
    accountNumber: "40702810000000000000",
    legalAddress: "г. Москва, ул. Складочная, д. 1",
  },
  activeDeals: [
    {
      id: "deal-101",
      title: "Ремонт iMac 27",
      description: "Замена матрицы и чистка от пыли",
      budget: 35000,
      currency: "RUB",
      stageId: "stage-1",
      stageName: "В работе",
      stageColor: "#4a38f5",
      pipelineId: "pipe-1",
      pipelineName: "Основная воронка",
      createdAt: "2026-11-01T10:00:00.000Z",
      ownerName: "Иван Мастер",
    },
  ],
};

let currentLookupResponse: {
  data: ClientLookupResultDTO | undefined;
  isLoading: boolean;
  isFetching: boolean;
} = {
  data: undefined,
  isLoading: false,
  isFetching: false,
};

vi.mock("@/lib/api/use-repairs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRepairClientLookup: () => currentLookupResponse,
  };
});

function TestWrapper({ defaultValues }: { defaultValues?: Partial<CreateRepairPayload> }) {
  const form = useForm<CreateRepairPayload>({
    defaultValues: {
      deal_id: "",
      customer_id: "",
      customer_name: "",
      customer_phone: "",
      customer_email: "",
      company_id: "",
      company_name: "",
      company_inn: "",
      company_ogrn: "",
      company_bik: "",
      company_account_number: "",
      company_legal_address: "",
      equipment_type: "phone",
      equipment_brand: "Apple",
      equipment_model: "iPhone 15",
      defect_description: "Разбито стекло",
      master_id: "m-1",
      master_name: "Master",
      estimated_cost: 0,
      ...defaultValues,
    },
  });

  return (
    <div>
      <RepairClientSection form={form} />
      <div data-testid="form-deal-id">{form.watch("deal_id")}</div>
      <div data-testid="form-customer-id">{form.watch("customer_id")}</div>
      <div data-testid="form-customer-name">{form.watch("customer_name")}</div>
      <div data-testid="form-customer-phone">{form.watch("customer_phone")}</div>
      <div data-testid="form-customer-email">{form.watch("customer_email")}</div>
      <div data-testid="form-company-name">{form.watch("company_name")}</div>
      <div data-testid="form-company-id">{form.watch("company_id")}</div>
      <div data-testid="form-company-inn">{form.watch("company_inn")}</div>
      <div data-testid="form-company-bik">{form.watch("company_bik")}</div>
    </div>
  );
}

describe("RepairClientSection Component (Unified Reactive Flow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentLookupResponse = {
      data: undefined,
      isLoading: false,
      isFetching: false,
    };
  });

  it("renders unified inputs without 3 mode-switching buttons", () => {
    render(<TestWrapper />);

    // Header and unified inputs
    expect(screen.getByText("Клиент и сделка")).toBeDefined();
    expect(screen.getByPlaceholderText("+7 (999) 000-00-00")).toBeDefined();
    expect(screen.getByPlaceholderText("Иванов Иван Иванович")).toBeDefined();
    expect(screen.getByPlaceholderText("client@example.ru")).toBeDefined();

    // The old mode buttons MUST NOT exist
    expect(screen.queryByText("Выбрать сделку")).toBeNull();
    expect(screen.queryByText("Новый клиент / сделка")).toBeNull();

    // Default note about auto-creation
    expect(
      screen.getByText("Новый заказ: контакт и сделка будут созданы в CRM при сохранении"),
    ).toBeDefined();
  });

  it("auto-populates client, company, requisites, and lists active deals when customer is found", async () => {
    currentLookupResponse = {
      data: mockLookupData,
      isLoading: false,
      isFetching: false,
    };

    render(<TestWrapper />);

    // Client badge
    await waitFor(() => {
      expect(screen.getByText("Клиент в CRM")).toBeDefined();
      expect(screen.getByTestId("form-customer-id").textContent).toBe("contact-55");
      expect(screen.getByTestId("form-customer-name").textContent).toBe(
        "Смирнов Алексей Иванович",
      );
      expect(screen.getByTestId("form-customer-email").textContent).toBe("smirnov@test.ru");
      expect(screen.getByTestId("form-company-id").textContent).toBe("comp-10");
      expect(screen.getByTestId("form-company-name").textContent).toBe("ООО СпецСервис");
      expect(screen.getByTestId("form-company-inn").textContent).toBe("7701234567");
      expect(screen.getByTestId("form-company-bik").textContent).toBe("044525225");
    });

    // Active deals list should show the deal
    expect(screen.getByText("Ремонт iMac 27")).toBeDefined();
    expect(screen.getByText("В работе")).toBeDefined();
    expect(screen.getByText("35 000 ₽")).toBeDefined();

    // Click on active deal to bind deal_id
    fireEvent.click(screen.getByText("Ремонт iMac 27"));

    await waitFor(() => {
      expect(screen.getByTestId("form-deal-id").textContent).toBe("deal-101");
      expect(screen.getByText("Выбрана сделка для привязки")).toBeDefined();
    });

    // Option to create a new deal instead
    const newDealOption = screen.getByText(
      "+ Создать отдельную новую сделку под данный ремонт",
    );
    fireEvent.click(newDealOption);

    await waitFor(() => {
      expect(screen.getByTestId("form-deal-id").textContent).toBe("");
      expect(screen.getByText("Будет создана новая сделка под ремонт")).toBeDefined();
    });
  });

  it("allows toggling legal company and requisites fields manually", async () => {
    render(<TestWrapper />);

    const companyCheckbox = screen.getByRole("checkbox");
    expect(companyCheckbox).toBeDefined();

    // Toggle on
    fireEvent.click(companyCheckbox);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("ООО «Вектор», ИП Иванов")).toBeDefined();
      expect(
        screen.getByText("Указать реквизиты (ИНН, ОГРН, БИК, Р/с, Адрес)"),
      ).toBeDefined();
    });

    // Expand requisites
    fireEvent.click(screen.getByText("Указать реквизиты (ИНН, ОГРН, БИК, Р/с, Адрес)"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("7701234567")).toBeDefined();
      expect(screen.getByPlaceholderText("1027700132195")).toBeDefined();
      expect(screen.getByPlaceholderText("044525225")).toBeDefined();
      expect(screen.getByPlaceholderText("40702810000000000000")).toBeDefined();
    });

    // Fill INN
    const innInput = screen.getByPlaceholderText("7701234567");
    fireEvent.change(innInput, { target: { value: "7701234567" } });

    await waitFor(() => {
      expect(screen.getByTestId("form-company-inn").textContent).toBe("7701234567");
    });
  });
});
