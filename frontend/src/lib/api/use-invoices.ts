"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// DTOs — mirror backend/src/modules/finance/finance.types.ts.
// ---------------------------------------------------------------------------

export type TransactionType = "income" | "expense";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export interface AccountDTO {
  id: string;
  name: string;
  currency: string;
  balance: number;
  isDefault: boolean;
}

export interface TransactionDTO {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string | null;
  categoryName: string;
  description: string;
  accountId: string;
  accountName: string;
  dealId: string | null;
  repairOrderId: string | null;
  invoiceId: string | null;
  occurredAt: string;
}

export interface InvoiceItemDTO {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  source: string;
  sourceLabel: string | null;
}

export interface InvoiceDTO {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  companyId: string | null;
  companyName: string;
  companyInn: string;
  companyAddress: string;
  contactName: string;
  contactPhone: string;
  dealId: string | null;
  repairOrderId: string | null;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency: string;
  notes: string;
  paidAt: string | null;
  paidAccountId: string | null;
  lineItems: InvoiceItemDTO[];
}

export interface PnlCategoryDTO {
  categoryName: string;
  amount: number;
  percentage: number;
}

export interface PnlDTO {
  from: string;
  to: string;
  income: number;
  expenses: number;
  netProfit: number;
  incomeByCategory: PnlCategoryDTO[];
  expensesByCategory: PnlCategoryDTO[];
}

export interface TransactionsListResult {
  items: TransactionDTO[];
  total: number;
  limit: number;
  offset: number;
}

export interface InvoicesListResult {
  items: InvoiceDTO[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface CreateAccountPayload {
  name: string;
  currency?: string;
  opening_balance?: number;
  is_default?: boolean;
}

export interface TransferPayload {
  from_account_id: string;
  to_account_id: string;
  amount: number;
  description?: string;
  occurred_at?: string;
}

export interface CreateTransactionPayload {
  account_id: string;
  type: TransactionType;
  amount: number;
  currency?: string;
  category_id?: string;
  category_name: string;
  description?: string;
  counterparty_name?: string;
  counterparty_inn?: string;
  deal_id?: string;
  repair_order_id?: string;
  invoice_id?: string;
  occurred_at?: string;
}

export interface CreateInvoicePayload {
  company_id?: string;
  company_name: string;
  company_inn?: string;
  company_address?: string;
  contact_name?: string;
  contact_phone?: string;
  deal_id?: string;
  repair_order_id?: string;
  due_date: string;
  vat_rate?: number;
  currency?: string;
  notes?: string;
  line_items: {
    description: string;
    quantity?: number;
    unit_price: number;
    source?: string;
    source_label?: string;
  }[];
}

export interface UpdateInvoicePayload {
  status?: InvoiceStatus;
  due_date?: string;
  notes?: string;
}

export interface MarkInvoicePaidPayload {
  account_id: string;
  occurred_at?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const financeKeys = {
  all: ["finance"] as const,
  accounts: ["finance", "accounts"] as const,
  transactions: (params: { limit?: number; offset?: number; type?: string; search?: string }) => ["finance", "transactions", params] as const,
  invoices: (params: { limit?: number; offset?: number; status?: string; search?: string; companyId?: string }) => ["finance", "invoices", params] as const,
  invoiceDetail: (id: string) => ["finance", "invoices", id] as const,
  pnl: (from?: string, to?: string) => ["finance", "pnl", from, to],
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAccounts(): UseQueryResult<AccountDTO[], ApiClientError> {
  return useQuery<AccountDTO[], ApiClientError>({
    queryKey: financeKeys.accounts,
    queryFn: async () => (await apiClient.get<AccountDTO[]>("/api/v1/finance/accounts")).data,
  });
}

export function useTransactions(params: { limit?: number; offset?: number; type?: string; search?: string } = {}): UseQueryResult<TransactionsListResult, ApiClientError> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  return useQuery<TransactionsListResult, ApiClientError>({
    queryKey: financeKeys.transactions(params),
    queryFn: async () => {
      const res = await apiClient.get<TransactionDTO[]>("/api/v1/finance/transactions", {
        query: {
          limit,
          offset,
          type: params.type,
          search: params.search,
        },
      });

      const meta: ApiMeta = res.meta ?? {};

      return {
        items: res.data,
        total: typeof meta.total === "number" ? meta.total : res.data.length,
        limit: typeof meta.limit === "number" ? meta.limit : limit,
        offset: typeof meta.offset === "number" ? meta.offset : offset,
      };
    },
    placeholderData: (previous) => previous,
  });
}

export function useInvoices(params: { limit?: number; offset?: number; status?: string; search?: string; companyId?: string } = {}): UseQueryResult<InvoicesListResult, ApiClientError> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  return useQuery<InvoicesListResult, ApiClientError>({
    queryKey: financeKeys.invoices(params),
    queryFn: async () => {
      const res = await apiClient.get<InvoiceDTO[]>("/api/v1/invoices", {
        query: {
          limit,
          offset,
          status: params.status,
          search: params.search,
          company_id: params.companyId,
        },
      });

      const meta: ApiMeta = res.meta ?? {};

      return {
        items: res.data,
        total: typeof meta.total === "number" ? meta.total : res.data.length,
        limit: typeof meta.limit === "number" ? meta.limit : limit,
        offset: typeof meta.offset === "number" ? meta.offset : offset,
      };
    },
    placeholderData: (previous) => previous,
  });
}

export function useInvoice(id: string | null): UseQueryResult<InvoiceDTO, ApiClientError> {
  return useQuery<InvoiceDTO, ApiClientError>({
    queryKey: financeKeys.invoiceDetail(id ?? ""),
    queryFn: async () => {
      const res = await apiClient.get<InvoiceDTO>(`/api/v1/invoices/${id ?? ""}`);
      return res.data;
    },
    enabled: id !== null && id.length > 0,
  });
}

export function usePnl(from?: string, to?: string): UseQueryResult<PnlDTO, ApiClientError> {
  return useQuery<PnlDTO, ApiClientError>({
    queryKey: financeKeys.pnl(from, to),
    queryFn: async () => {
      const res = await apiClient.get<PnlDTO>("/api/v1/finance/pnl", {
        query: { from, to },
      });
      return res.data;
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateAccount(): UseMutationResult<AccountDTO, ApiClientError, CreateAccountPayload> {
  const queryClient = useQueryClient();

  return useMutation<AccountDTO, ApiClientError, CreateAccountPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<AccountDTO>("/api/v1/finance/accounts", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.accounts });
    },
  });
}

export function useTransfer(): UseMutationResult<{ from: AccountDTO; to: AccountDTO }, ApiClientError, TransferPayload> {
  const queryClient = useQueryClient();

  return useMutation<{ from: AccountDTO; to: AccountDTO }, ApiClientError, TransferPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<{ from: AccountDTO; to: AccountDTO }>("/api/v1/finance/accounts/transfer", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.accounts });
    },
  });
}

export function useCreateTransaction(): UseMutationResult<TransactionDTO, ApiClientError, CreateTransactionPayload> {
  const queryClient = useQueryClient();

  return useMutation<TransactionDTO, ApiClientError, CreateTransactionPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<TransactionDTO>("/api/v1/finance/transactions", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useCreateInvoice(): UseMutationResult<InvoiceDTO, ApiClientError, CreateInvoicePayload> {
  const queryClient = useQueryClient();

  return useMutation<InvoiceDTO, ApiClientError, CreateInvoicePayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<InvoiceDTO>("/api/v1/invoices", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useCreateInvoiceFromRepair(): UseMutationResult<InvoiceDTO, ApiClientError, { repairId: string; payload: Omit<CreateInvoicePayload, "line_items"> }> {
  const queryClient = useQueryClient();

  return useMutation<InvoiceDTO, ApiClientError, { repairId: string; payload: Omit<CreateInvoicePayload, "line_items"> }>({
    mutationFn: async ({ repairId, payload }) => {
      const res = await apiClient.post<InvoiceDTO>(`/api/v1/invoices/from-repair/${repairId}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useUpdateInvoice(): UseMutationResult<InvoiceDTO, ApiClientError, { id: string; payload: UpdateInvoicePayload }> {
  const queryClient = useQueryClient();

  return useMutation<InvoiceDTO, ApiClientError, { id: string; payload: UpdateInvoicePayload }>({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.patch<InvoiceDTO>(`/api/v1/invoices/${id}`, payload);
      return res.data;
    },
    onSuccess: (invoice) => {
      queryClient.setQueryData(financeKeys.invoiceDetail(invoice.id), invoice);
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useMarkInvoicePaid(): UseMutationResult<InvoiceDTO, ApiClientError, { id: string; payload: MarkInvoicePaidPayload }> {
  const queryClient = useQueryClient();

  return useMutation<InvoiceDTO, ApiClientError, { id: string; payload: MarkInvoicePaidPayload }>({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.post<InvoiceDTO>(`/api/v1/invoices/${id}/pay`, payload);
      return res.data;
    },
    onSuccess: (invoice) => {
      queryClient.setQueryData(financeKeys.invoiceDetail(invoice.id), invoice);
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatInvoiceNumber(invoice: InvoiceDTO): string {
  return invoice.invoiceNumber;
}

export function formatCurrency(amount: number, currency: string = "RUB"): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
