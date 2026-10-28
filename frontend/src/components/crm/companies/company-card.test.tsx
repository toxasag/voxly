import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { CompanyCard } from "./CompanyCard";
import type { CompanyDTO } from "@/lib/api/use-companies";

vi.mock("@/lib/api/use-companies", () => ({
  useUpdateCompany: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/api/use-contacts", () => ({
  useContacts: () => ({ data: { items: [] }, isLoading: false }),
  useCreateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  contactFullName: () => "Тестовый Контакт",
}));

vi.mock("@/components/crm/shared/RecordDealsSection", () => ({
  RecordDealsSection: () => <div data-testid="deals-section">Сделки</div>,
}));

vi.mock("@/components/crm/shared/TabsRenderer", () => ({
  useTabsRenderer: ({ contents }: { contents: Record<string, React.ReactNode> }) => [
    { id: "home", label: "Главная", content: contents.home },
  ],
}));

const mockCompany: CompanyDTO = {
  id: "comp-1",
  name: "ООО Вектор Технологии",
  domainName: "vector-tech.ru",
  annualRevenue: 12500000,
  address: {
    city: "Москва",
    street: "ул. Тверская, д. 7",
    postcode: "125009",
    country: "Россия",
  },
  requisites: {
    inn: "7701234567",
    ogrn: "1027700123456",
    bik: "044525225",
    accountNumber: "40702810000000000001",
    legalAddress: "г. Москва, ул. Тверская, д. 7",
  },
  phone: "+7 (495) 123-45-67",
  email: "info@vector-tech.ru",
  linkedinLink: "https://linkedin.com/company/vector-tech",
  managerName: "Менеджер Иван",
  managerId: "user-1",
  notes: "Заметка",
  customFields: {},
  createdBy: "user-admin",
  createdByName: "Администратор",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  contactsCount: 2,
  dealsCount: 1,
  dealsBudgetTotal: 50000,
};

describe("CompanyCard (Block 3.2 Twenty Parity)", () => {
  it("renders standard Twenty CRM company fields and groups", () => {
    render(
      <CompanyCard
        company={mockCompany}
        statsLoading={false}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("ООО Вектор Технологии")).toBeDefined();
    expect(screen.getByText("vector-tech.ru")).toBeDefined();
    expect(screen.getByText("info@vector-tech.ru")).toBeDefined();
    expect(screen.getByText("+7 (495) 123-45-67")).toBeDefined();

    // Раскрываем группу "Ещё", где находятся ИНН и реквизиты
    fireEvent.click(screen.getByText("Ещё"));

    expect(screen.getByText("7701234567")).toBeDefined();
  });
});
