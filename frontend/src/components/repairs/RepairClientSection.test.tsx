import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useForm } from "react-hook-form";
import { RepairClientSection } from "./RepairClientSection";
import type { CreateRepairPayload } from "@/schemas/repair.schema";
import type { DealDTO, PipelineDTO, KanbanColumnDTO } from "@/lib/api/use-deals";
import type { ContactDTO } from "@/lib/api/use-contacts";
import type { CompanyDTO } from "@/lib/api/use-companies";

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

const mockContacts: ContactDTO[] = [
  {
    id: "contact-55",
    firstName: "Алексей",
    lastName: "Смирнов",
    middleName: "",
    phone: "+79997776655",
    phones: [],
    email: "smirnov@test.ru",
    telegramUsername: null,
    whatsapp: null,
    socials: [],
    jobTitle: "",
    companyName: "ООО СпецСервис",
    companyId: "comp-10",
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
  },
  {
    id: "contact-77",
    firstName: "Екатерина",
    lastName: "Павлова",
    middleName: "",
    phone: "+79993332211",
    phones: [],
    email: "pavlova@test.ru",
    telegramUsername: null,
    whatsapp: null,
    socials: [],
    jobTitle: "",
    companyName: "",
    companyId: null,
    channel: "website",
    linkedinLink: "",
    customFields: {},
    notes: "",
    createdBy: "user-1",
    createdByName: "Менеджер",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dealsCount: 0,
    tasksCount: 0,
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

const mockCompanies: CompanyDTO[] = [
  {
    id: "comp-10",
    name: "ООО СпецСервис",
    domainName: "specservice.ru",
    phone: "+74951234567",
    email: "info@specservice.ru",
    requisites: {
      inn: "7701987654",
      ogrn: "1027700132195",
      bik: "044525225",
      accountNumber: "40702810938000000000",
      legalAddress: "г. Москва, ул. Промышленная, д. 5",
    },
    managerName: "Менеджер",
    managerId: null,
    annualRevenue: null,
    linkedinLink: "",
    address: { city: "Москва", street: "Промышленная 5", country: "РФ", postcode: "101000" },
    notes: "",
    customFields: {},
    createdBy: null,
    createdByName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contactsCount: 1,
    dealsCount: 1,
    dealsBudgetTotal: 35000,
  },
];

const mockPipelines: PipelineDTO[] = [
  { id: "pipe-1", name: "Сервисный центр", sortOrder: 0 },
];

const mockStages: KanbanColumnDTO[] = [
  {
    stageId: "stage-1",
    stageName: "Новая заявка",
    sortOrder: 0,
    isWon: false,
    isLost: false,
    isSystem: true,
    stageColor: "sky",
    dealCount: 1,
    budgetTotal: 35000,
    deals: mockDeals,
  },
];

const mockMutateAsync = vi.fn().mockImplementation((payload) =>
  Promise.resolve({
    id: "deal-new-202",
    pipelineId: payload.pipeline_id,
    stageId: payload.stage_id,
    contactId: payload.contact_id,
    companyId: payload.company_id,
    title: payload.title,
    description: "",
    budget: payload.budget,
    currency: "RUB",
    customFields: {},
    createdBy: "user-1",
    ownerId: null,
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    companyName: null,
    contactName: "Алексей Смирнов",
    contactPhone: "+79997776655",
    ownerName: "Менеджер",
  }),
);

vi.mock("@/lib/api/use-deals", () => ({
  useDeals: ({ search, contactId }: { search?: string; contactId?: string }) => {
    let items = mockDeals;
    if (contactId) {
      items = items.filter((d) => d.contactId === contactId);
    }
    if (search) {
      items = items.filter(
        (d) =>
          d.title.toLowerCase().includes(search.toLowerCase()) ||
          (d.contactName && d.contactName.toLowerCase().includes(search.toLowerCase())) ||
          (d.contactPhone && d.contactPhone.includes(search)),
      );
    }
    return {
      data: { items, total: items.length },
      isLoading: false,
    };
  },
  useCreateDeal: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  usePipelines: () => ({
    data: mockPipelines,
    isLoading: false,
  }),
  useKanban: () => ({
    data: mockStages,
    isLoading: false,
  }),
}));

vi.mock("@/lib/api/use-contacts", () => ({
  useContacts: ({ search }: { search?: string }) => ({
    data: {
      items: search
        ? mockContacts.filter((c) =>
            `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()),
          )
        : mockContacts,
      total: mockContacts.length,
    },
    isLoading: false,
  }),
  useContact: (id: string | null) => ({
    data: mockContacts.find((c) => c.id === id) ?? null,
    isLoading: false,
  }),
  useContactLookup: (phone: string | null | undefined) => {
    const isMatch = Boolean(phone && phone.replace(/[^\d]/g, "").includes("9998881122"));
    return {
      data: isMatch ? mockMatchedContact : null,
      isFetching: false,
    };
  },
}));

vi.mock("@/lib/api/use-companies", () => ({
  useCompanies: ({ search }: { search?: string }) => ({
    data: {
      items: search
        ? mockCompanies.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
        : mockCompanies,
      total: mockCompanies.length,
    },
    isLoading: false,
  }),
  useCompany: (id: string | null) => ({
    data: mockCompanies.find((c) => c.id === id) ?? null,
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
    },
  });

  return (
    <div>
      <RepairClientSection form={form} />
      <div data-testid="form-deal-id">{form.watch("deal_id")}</div>
      <div data-testid="form-customer-id">{form.watch("customer_id")}</div>
      <div data-testid="form-customer-name">{form.watch("customer_name")}</div>
      <div data-testid="form-customer-phone">{form.watch("customer_phone")}</div>
      <div data-testid="form-company-name">{form.watch("company_name")}</div>
      <div data-testid="form-company-id">{form.watch("company_id")}</div>
      <div data-testid="form-company-inn">{form.watch("company_inn")}</div>
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
    expect(screen.getByText("Клиент")).toBeDefined();
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

  it("switches to New Client mode and supports deduplication lookup (Scenario 3)", async () => {
    render(<TestWrapper />);

    // Switch to New client mode
    fireEvent.click(screen.getByText("Новый клиент / сделка"));

    expect(screen.getByPlaceholderText("Иванов Иван Иванович")).toBeDefined();
    expect(screen.getByPlaceholderText("+7 (999) 000-00-00")).toBeDefined();

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

  it("selects a client from CRM and displays their active deals (Scenario 1)", async () => {
    render(<TestWrapper />);

    // Switch to Client mode
    fireEvent.click(screen.getByText("Клиент"));

    const searchInput = screen.getByPlaceholderText(
      "Поиск клиента по имени, телефону, email или организации...",
    );
    fireEvent.focus(searchInput);

    await waitFor(() => {
      expect(screen.getByText("Алексей Смирнов")).toBeDefined();
    });

    // Select the client
    fireEvent.click(screen.getByText("Алексей Смирнов"));

    await waitFor(() => {
      expect(screen.getByText("Клиент CRM")).toBeDefined();
      expect(screen.getByTestId("form-customer-id").textContent).toBe("contact-55");
      expect(screen.getByTestId("form-customer-name").textContent).toBe("Алексей Смирнов");
      expect(screen.getByText("Действующие сделки клиента")).toBeDefined();
      expect(screen.getByText("Ремонт iMac 27")).toBeDefined();
    });

    // Click to select the active deal
    fireEvent.click(screen.getByText("Ремонт iMac 27"));

    await waitFor(() => {
      expect(screen.getByText(/Привязано к сделке:/i)).toBeDefined();
      expect(screen.getByTestId("form-deal-id").textContent).toBe("deal-101");
    });
  });

  it("supports inline deal creation for selected client (Scenario 2)", async () => {
    render(<TestWrapper />);

    // Switch to Client mode
    fireEvent.click(screen.getByText("Клиент"));

    const searchInput = screen.getByPlaceholderText(
      "Поиск клиента по имени, телефону, email или организации...",
    );
    fireEvent.focus(searchInput);

    await waitFor(() => {
      expect(screen.getByText("Екатерина Павлова")).toBeDefined();
    });

    // Select the client with 0 deals
    fireEvent.click(screen.getByText("Екатерина Павлова"));

    await waitFor(() => {
      expect(screen.getByText("Создать сделку для клиента")).toBeDefined();
    });

    // Click create deal button
    fireEvent.click(screen.getByText("Создать сделку для клиента"));

    await waitFor(() => {
      expect(screen.getByText("Новая сделка для клиента")).toBeDefined();
      expect(screen.getByText("Создать и привязать")).toBeDefined();
    });

    // Click submit inline deal
    fireEvent.click(screen.getByText("Создать и привязать"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
      expect(screen.getByTestId("form-deal-id").textContent).toBe("deal-new-202");
    });
  });

  it("handles company requisites and auto-fills INN and legal address (Scenario 4)", async () => {
    render(<TestWrapper />);

    // Toggle company checkbox
    const companyCheckbox = screen.getByLabelText(/Организация \/ Юридическое лицо/i);
    fireEvent.click(companyCheckbox);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("ООО Ромашка или Частное лицо")).toBeDefined();
      expect(screen.getByText(/Реквизиты \(ИНН, БИК, р\/с\)/i)).toBeDefined();
    });

    // Focus company input
    const companyInput = screen.getByPlaceholderText("ООО Ромашка или Частное лицо");
    fireEvent.change(companyInput, { target: { value: "СпецСервис" } });

    await waitFor(() => {
      expect(screen.getByText("ООО СпецСервис")).toBeDefined();
    });

    // Select company
    fireEvent.click(screen.getByText("ООО СпецСервис"));

    await waitFor(() => {
      expect(screen.getByTestId("form-company-name").textContent).toBe("ООО СпецСервис");
      expect(screen.getByTestId("form-company-id").textContent).toBe("comp-10");
      expect(screen.getByTestId("form-company-inn").textContent).toBe("7701987654");
    });
  });
});
