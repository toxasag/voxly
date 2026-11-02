import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useForm } from "react-hook-form";
import { RepairClientSection } from "./RepairClientSection";
import type { CreateRepairPayload } from "@/schemas/repair.schema";
import type { DealDTO } from "@/lib/api/use-deals";
import type { ContactDTO } from "@/lib/api/use-contacts";

const mockDeals: DealDTO[] = [
  {
    id: "deal-101",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    contactId: "contact-55",
    companyId: "comp-10",
    title: "Ремонт iMac 27",
    description: "Замена матрицы",
    budget: 35000,
    currency: "RUB",
    customFields: {},
    createdBy: "user-1",
    ownerId: null,
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    companyName: "ООО СпецСервис",
    contactName: "Алексей Смирнов",
    contactPhone: "+79997776655",
    ownerName: "Менеджер",
  },
];

const mockMatchedContact: ContactDTO = {
  id: "contact-99",
  firstName: "Дмитрий",
  lastName: "Ковалев",
  middleName: "",
  phone: "+79998881122",
  phones: [],
  email: "kovalev@test.ru",
  telegramUsername: null,
  whatsapp: null,
  socials: [],
  jobTitle: "",
  companyName: "Вектор Плюс",
  companyId: "comp-99",
  channel: "phone",
  linkedinLink: "",
  customFields: {},
  notes: "",
  createdBy: "user-1",
  createdByName: "Менеджер",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dealsCount: 1,
  tasksCount: 0,
};

let currentLookupPhone: string | null = null;

vi.mock("@/lib/api/use-deals", () => ({
  useDeals: ({ search }: { search?: string }) => ({
    data: {
      items: search
        ? mockDeals.filter(
            (d) =>
              d.title.toLowerCase().includes(search.toLowerCase()) ||
              (d.contactName && d.contactName.toLowerCase().includes(search.toLowerCase())) ||
              (d.contactPhone && d.contactPhone.includes(search)),
          )
        : mockDeals,
      total: mockDeals.length,
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/api/use-contacts", () => ({
  useContactLookup: (phone: string | null | undefined) => {
    currentLookupPhone = phone ?? null;
    const isMatch = Boolean(phone && phone.replace(/[^\d]/g, "").includes("9998881122"));
    return {
      data: isMatch ? mockMatchedContact : null,
      isFetching: false,
    };
  },
  useFindDuplicateContacts: () => ({
    data: [],
    isLoading: false,
  }),
}));

function TestWrapper() {
  const form = useForm<CreateRepairPayload>({
    defaultValues: {
      deal_id: "",
      customer_id: "",
      customer_name: "",
      customer_phone: "",
      company_name: "",
      equipment_type: "phone",
      equipment_brand: "Apple",
      equipment_model: "iPhone 15",
      defect_description: "Разбито стекло",
      master_id: "m-1",
      master_name: "Master",
      estimated_cost: 0,
    },
  });

  return (
    <div>
      <RepairClientSection form={form} />
      <div data-testid="form-deal-id">{form.watch("deal_id")}</div>
      <div data-testid="form-customer-name">{form.watch("customer_name")}</div>
      <div data-testid="form-customer-phone">{form.watch("customer_phone")}</div>
      <div data-testid="form-company-name">{form.watch("company_name")}</div>
    </div>
  );
}

describe("RepairClientSection Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with Deal selection mode by default and lists active deals", async () => {
    render(<TestWrapper />);

    expect(screen.getByText("Выбрать сделку")).toBeDefined();
    expect(screen.getByText("Новый клиент / сделка")).toBeDefined();

    const searchInput = screen.getByPlaceholderText(
      "Поиск активной сделки по названию, контакту или телефону...",
    );
    expect(searchInput).toBeDefined();

    // Focus input to open deals dropdown
    fireEvent.focus(searchInput);

    await waitFor(() => {
      expect(screen.getByText("Ремонт iMac 27")).toBeDefined();
      expect(screen.getByText("Алексей Смирнов")).toBeDefined();
      expect(screen.getByText("35 000 ₽")).toBeDefined();
    });
  });

  it("selects an active deal and populates form values", async () => {
    render(<TestWrapper />);

    const searchInput = screen.getByPlaceholderText(
      "Поиск активной сделки по названию, контакту или телефону...",
    );
    fireEvent.focus(searchInput);

    await waitFor(() => {
      expect(screen.getByText("Ремонт iMac 27")).toBeDefined();
    });

    // Click on the deal
    fireEvent.click(screen.getByText("Ремонт iMac 27"));

    await waitFor(() => {
      // Summary card is displayed
      expect(screen.getByText("Сделка CRM")).toBeDefined();
      expect(screen.getByText("Сменить")).toBeDefined();
      expect(screen.getByTestId("form-deal-id").textContent).toBe("deal-101");
      expect(screen.getByTestId("form-customer-name").textContent).toBe("Алексей Смирнов");
      expect(screen.getByTestId("form-customer-phone").textContent).toBe("+79997776655");
      expect(screen.getByTestId("form-company-name").textContent).toBe("ООО СпецСервис");
    });

    // Click «Сменить» to clear
    fireEvent.click(screen.getByText("Сменить"));

    await waitFor(() => {
      expect(screen.getByTestId("form-deal-id").textContent).toBe("");
    });
  });

  it("switches to New Client mode and supports deduplication lookup", async () => {
    render(<TestWrapper />);

    // Switch to Mode 2
    fireEvent.click(screen.getByText("Новый клиент / сделка"));

    expect(screen.getByPlaceholderText("Иванов Иван Иванович")).toBeDefined();
    expect(screen.getByPlaceholderText("+7 (999) 000-00-00")).toBeDefined();
    expect(screen.getByPlaceholderText("ООО Ромашка или Частное лицо")).toBeDefined();

    // Type a matching phone
    const phoneInput = screen.getByPlaceholderText("+7 (999) 000-00-00");
    fireEvent.change(phoneInput, { target: { value: "+7 (999) 888-11-22" } });

    await waitFor(() => {
      expect(screen.getByText(/Контакт найден в базе:/i)).toBeDefined();
      expect(screen.getByText(/Ковалев Дмитрий/i)).toBeDefined();
      expect(screen.getByText("Подставить данные")).toBeDefined();
    });

    // Click «Подставить данные»
    fireEvent.click(screen.getByText("Подставить данные"));

    await waitFor(() => {
      expect(screen.getByTestId("form-customer-name").textContent).toBe("Ковалев Дмитрий");
      expect(screen.getByTestId("form-company-name").textContent).toBe("Вектор Плюс");
    });
  });
});
