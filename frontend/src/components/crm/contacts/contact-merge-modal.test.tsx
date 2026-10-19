import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ContactMergeModal } from "./ContactMergeModal";
import type { ContactDTO } from "@/lib/api/use-contacts";

const mockMutateAsync = vi.fn();

vi.mock("@/lib/api/use-contacts", () => ({
  contactFullName: (c: ContactDTO) => `${c.lastName} ${c.firstName}`.trim(),
  useContacts: () => ({
    data: {
      items: [
        {
          id: "contact-2",
          firstName: "Иван",
          lastName: "Дубликатов",
          middleName: "",
          phone: "+79991112233",
          phones: [],
          email: "ivan.dup@test.ru",
          telegramUsername: null,
          whatsapp: null,
          socials: [],
          jobTitle: "Менеджер",
          companyName: "Дубль Корп",
          companyId: null,
          channel: "phone",
          linkedinLink: "",
          customFields: {},
          notes: "",
          createdBy: null,
          createdByName: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          dealsCount: 2,
          tasksCount: 1,
        },
      ],
    },
    isLoading: false,
  }),
  useMergeContacts: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

const mockPrimary: ContactDTO = {
  id: "contact-1",
  firstName: "Иван",
  lastName: "Основной",
  middleName: "",
  phone: "+79998887766",
  phones: [],
  email: "ivan.main@test.ru",
  telegramUsername: null,
  whatsapp: null,
  socials: [],
  jobTitle: "Директор",
  companyName: "Главная Корп",
  companyId: null,
  channel: "telegram",
  linkedinLink: "",
  customFields: {},
  notes: "",
  createdBy: null,
  createdByName: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dealsCount: 5,
  tasksCount: 3,
};

describe("ContactMergeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders primary contact and candidate list", () => {
    render(
      <ContactMergeModal
        open={true}
        onClose={vi.fn()}
        primaryContact={mockPrimary}
      />,
    );

    expect(screen.getByText("Слияние контактов")).toBeDefined();
    expect(screen.getByText("Основной Иван")).toBeDefined();
    expect(screen.getByText("Дубликатов Иван")).toBeDefined();
    expect(screen.getByText("Объединить контакты")).toBeDefined();
  });

  it("allows selecting a secondary contact and executing merge", async () => {
    mockMutateAsync.mockResolvedValueOnce({
      primaryContactId: "contact-1",
      mergedContactIds: ["contact-2"],
      dealsRetargeted: 2,
      tasksRetargeted: 1,
      phonesAdded: 1,
      socialsAdded: 0,
    });

    const onMerged = vi.fn();
    const onClose = vi.fn();

    render(
      <ContactMergeModal
        open={true}
        onClose={onClose}
        primaryContact={mockPrimary}
        onMerged={onMerged}
      />,
    );

    // Click "Выбрать" on candidate
    const selectBtn = screen.getByRole("button", { name: /Выбрать/i });
    fireEvent.click(selectBtn);

    // Now secondary contact is selected
    expect(screen.getByText("Дубликат (удаляется)")).toBeDefined();

    // Click "Объединить контакты"
    const mergeBtn = screen.getByRole("button", { name: /Объединить контакты/i });
    fireEvent.click(mergeBtn);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        primary_id: "contact-1",
        loser_ids: ["contact-2"],
      });
      expect(onMerged).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("allows swapping primary and duplicate contacts", () => {
    const mockSecondary: ContactDTO = {
      ...mockPrimary,
      id: "contact-2",
      firstName: "Иван",
      lastName: "Второй",
    };

    render(
      <ContactMergeModal
        open={true}
        onClose={vi.fn()}
        primaryContact={mockPrimary}
        secondaryContact={mockSecondary}
      />,
    );

    const swapBtn = screen.getByRole("button", { name: /Поменять местами/i });
    fireEvent.click(swapBtn);

    // After swapping, Второй should be primary
    expect(screen.getByText("Основной")).toBeDefined();
  });
});
