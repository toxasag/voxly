import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DealDocumentsSection } from "@/components/crm/deals/DealDocumentsSection";
import type { DealDTO, DealItemDTO } from "@/lib/api/use-deals";
import type { InvoiceDTO } from "@/lib/api/use-invoices";

const createInvoiceMutateAsync = vi.fn();
const sendInvoiceMutateAsync = vi.fn();
const deleteInvoiceMutateAsync = vi.fn();
const markPaidMutateAsync = vi.fn();
const syncElbaMutateAsync = vi.fn();
const openPrintMock = vi.fn();
const downloadBlobMock = vi.fn();
const refetchMock = vi.fn();

let mockDocuments: InvoiceDTO[] = [];

vi.mock("@/components/shared/Guard", () => ({
  Guard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/finance/InvoiceEditModal", () => ({
  InvoiceEditModal: () => null,
}));

vi.mock("@/lib/api/use-companies", () => ({
  useCompany: vi.fn(() => ({ data: null })),
}));

vi.mock("@/lib/api/apiClient", () => ({
  apiClient: {
    downloadBlob: (...args: unknown[]) => downloadBlobMock(...args),
  },
}));

const mockOrganizations = [
  {
    id: "org-1",
    name: "ИП Иванов",
    inn: "7700123456",
    isDefault: true,
    vatMode: "none" as const,
    elbaEnabled: false,
    elbaHasApiKey: false,
    elbaOrganizationId: "",
    elbaAutoSyncInvoices: false,
  },
];

vi.mock("@/lib/api/use-invoices", () => ({
  useInvoices: vi.fn(() => ({
    data: { items: mockDocuments, total: mockDocuments.length, limit: 50, offset: 0 },
    isLoading: false,
    refetch: refetchMock,
  })),
  useFinanceOrganizations: vi.fn(() => ({
    data: mockOrganizations,
    isLoading: false,
  })),
  useCreateInvoice: vi.fn(() => ({
    mutateAsync: createInvoiceMutateAsync,
    isPending: false,
  })),
  useSendInvoice: vi.fn(() => ({
    mutateAsync: sendInvoiceMutateAsync,
    isPending: false,
  })),
  useDeleteInvoice: vi.fn(() => ({
    mutateAsync: deleteInvoiceMutateAsync,
    isPending: false,
  })),
  useMarkInvoicePaid: vi.fn(() => ({
    mutateAsync: markPaidMutateAsync,
    isPending: false,
  })),
  useSyncInvoiceToElba: vi.fn(() => ({
    mutateAsync: syncElbaMutateAsync,
    isPending: false,
  })),
  openInvoiceRfPrintWindow: (...args: unknown[]) => openPrintMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function makeDeal(): DealDTO {
  return {
    id: "deal-1",
    pipelineId: "p-1",
    stageId: "s-1",
    contactId: "c-1",
    companyId: "co-1",
    title: "ремонт тоя заказ",
    description: "",
    budget: 6600,
    currency: "RUB",
    customFields: {},
    createdBy: "u-1",
    ownerId: "u-1",
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: "2026-11-27T11:00:00.000Z",
    updatedAt: "2026-11-27T11:00:00.000Z",
    companyName: "ООО Тоя Сервис",
    contactName: "Иван Петров",
    contactPhone: "+79991112233",
    contactEmail: "client@toya.ru",
    ownerName: "Антон",
  };
}

function makeItems(): DealItemDTO[] {
  return [
    {
      id: "di-1",
      dealId: "deal-1",
      itemType: "product",
      itemId: "wh-1",
      name: "GSN50 поз.39 Поршень",
      description: "",
      sku: "Б/А",
      price: 2800,
      costPrice: 2037,
      quantity: 2,
      unit: "шт",
      discountPercent: 0,
      discountAmount: 0,
      totalAmount: 5600,
      sortOrder: 0,
      createdAt: "2026-11-27T13:28:52.000Z",
    },
  ];
}

function makeDoc(type: "proposal" | "invoice"): InvoiceDTO {
  return {
    id: type === "proposal" ? "doc-kp-1" : "doc-inv-1",
    invoiceNumber: type === "proposal" ? "КП-2026-0001" : "СЧ-2026-0001",
    documentType: type,
    status: type === "proposal" ? "draft" : "sent",
    issueDate: "2026-11-27T14:00:00.000Z",
    dueDate: "2026-12-04T00:00:00.000Z",
    companyId: "co-1",
    companyName: "ООО Тоя Сервис",
    companyInn: "7700112233",
    companyAddress: "",
    contactName: "Иван Петров",
    contactPhone: "+79991112233",
    dealId: "deal-1",
    repairOrderId: null,
    subtotal: 5600,
    vatMode: "none",
    vatRate: 0,
    vatAmount: 0,
    total: 5600,
    currency: "RUB",
    notes: "",
    paidAt: null,
    paidAccountId: null,
    lineItems: [
      {
        id: "li-1",
        description: "GSN50 поз.39 Поршень",
        quantity: 2,
        unitPrice: 2800,
        total: 5600,
        source: "deal",
        sourceLabel: null,
      },
    ],
  };
}

describe("DealDocumentsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocuments = [];
    createInvoiceMutateAsync.mockResolvedValue(makeDoc("proposal"));
    sendInvoiceMutateAsync.mockResolvedValue({ success: true, channels: ["Telegram"], message: "ok" });
    openPrintMock.mockResolvedValue(undefined);
    downloadBlobMock.mockResolvedValue({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }) });
  });

  it("opens KP generator sheet from deal items and submits document_type='proposal'", async () => {
    render(<DealDocumentsSection deal={makeDeal()} items={makeItems()} />);

    fireEvent.click(screen.getByRole("button", { name: /Сформировать КП/i }));
    expect(screen.getByText(/Сформировать коммерческое предложение/i)).toBeDefined();

    const submitButtons = screen.getAllByRole("button", { name: /Сформировать КП/i });
    fireEvent.click(submitButtons[submitButtons.length - 1]!);

    await waitFor(() => {
      expect(createInvoiceMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          document_type: "proposal",
          deal_id: "deal-1",
          company_name: "ООО Тоя Сервис",
          due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          line_items: [
            expect.objectContaining({
              description: "GSN50 поз.39 Поршень (Б/А)",
              quantity: 2,
              unit_price: 2800,
            }),
          ],
        }),
      );
    });
  });

  it("renders KP and Invoice with print, PDF download, and client send actions", async () => {
    mockDocuments = [makeDoc("proposal"), makeDoc("invoice")];
    const origCreateObjectURL = window.URL.createObjectURL;
    const origRevokeObjectURL = window.URL.revokeObjectURL;
    window.URL.createObjectURL = vi.fn(() => "blob:test");
    window.URL.revokeObjectURL = vi.fn();

    try {
      render(<DealDocumentsSection deal={makeDeal()} items={makeItems()} />);

      expect(screen.getByText("№ КП-2026-0001")).toBeDefined();
      expect(screen.getByText("№ СЧ-2026-0001")).toBeDefined();

      fireEvent.click(screen.getAllByRole("button", { name: /Печать/i })[0]!);
      await waitFor(() => expect(openPrintMock).toHaveBeenCalledWith("doc-kp-1"));

      fireEvent.click(screen.getAllByRole("button", { name: /PDF/i })[0]!);
      await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledWith("/api/v1/invoices/doc-kp-1/pdf"));

      fireEvent.click(screen.getAllByRole("button", { name: /Отправить/i })[0]!);
      fireEvent.click(screen.getByRole("button", { name: /На E-mail \(client@toya\.ru\)/i }));
      await waitFor(() =>
        expect(sendInvoiceMutateAsync).toHaveBeenCalledWith({
          id: "doc-kp-1",
          channel_type: "email",
          recipient_email: "client@toya.ru",
        }),
      );
    } finally {
      window.URL.createObjectURL = origCreateObjectURL;
      window.URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});
