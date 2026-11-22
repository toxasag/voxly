"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// DTOs — mirror backend/src/modules/finance/finance.types.ts.
// ---------------------------------------------------------------------------

export type TransactionType = "income" | "expense";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type AccountType = "bank" | "cash" | "acquiring" | "safe";
export type OrgType = "ip" | "ooo" | "self_employed";
export type VatMode = "none" | "included_5" | "included_7" | "included_10" | "included_20";

export interface InvoiceFormConfig {
  showLogo: boolean;
  showQrCode: boolean;
  showContactsHeader: boolean;
  showEdo: boolean;
  showNotice: boolean;
  noticeText: string;
  showBasis: boolean;
  showAccountant: boolean;
  showStamp: boolean;
  showSignature: boolean;
  invoiceNumberPrefix: string;
  accentColor: string;
  footerNote: string;
}

export interface InvoiceIssuerSnapshot {
  organizationId?: string;
  orgType?: OrgType;
  name: string;
  shortName?: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  website: string;
  edoInfo: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  settlementAccount: string;
  directorTitle: string;
  directorName: string;
  accountantName: string;
  logoUrl: string;
  logoWidth: number;
  stampUrl: string;
  signatureUrl: string;
  invoiceConfig: InvoiceFormConfig;
}

export interface FinanceOrganizationDTO {
  id: string;
  isDefault: boolean;
  orgType: OrgType;
  name: string;
  shortName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  website: string;
  edoInfo: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  settlementAccount: string;
  directorTitle: string;
  directorName: string;
  accountantName: string;
  vatMode: VatMode;
  vatRate: number;
  logoUrl: string;
  logoWidth: number;
  stampUrl: string;
  signatureUrl: string;
  invoiceConfig: InvoiceFormConfig;
  elbaEnabled: boolean;
  elbaHasApiKey: boolean;
  elbaApiKeyHint: string;
  elbaOrganizationId: string;
  elbaOrganizationName: string;
  elbaBankAccountId: string;
  elbaAutoSyncInvoices: boolean;
  elbaLastSyncAt: string | null;
  elbaLastError: string;
  createdAt: string;
  updatedAt: string;
}

export interface ElbaOrganization {
  id: string;
  name: string;
  shortName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  type?: string | null;
}

export interface ElbaBankAccount {
  id: string;
  accountNumber: string;
  closed: boolean;
  bank: {
    name?: string | null;
    bik?: string | null;
    corrAccount?: string | null;
    city?: string | null;
    cityType?: string | null;
  };
}

export interface SaveOrganizationPayload {
  is_default?: boolean;
  org_type?: OrgType;
  name?: string;
  short_name?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  legal_address?: string;
  actual_address?: string;
  phone?: string;
  email?: string;
  website?: string;
  edo_info?: string;
  bank_name?: string;
  bik?: string;
  corr_account?: string;
  settlement_account?: string;
  director_title?: string;
  director_name?: string;
  accountant_name?: string;
  vat_mode?: VatMode;
  logo_url?: string;
  logo_width?: number;
  stamp_url?: string;
  signature_url?: string;
  invoice_config?: Partial<InvoiceFormConfig>;
  elba_enabled?: boolean;
  elba_api_key?: string;
  clear_elba_api_key?: boolean;
  elba_organization_id?: string;
  elba_organization_name?: string;
  elba_bank_account_id?: string;
  elba_auto_sync_invoices?: boolean;
}

export interface AccountDTO {
  id: string;
  name: string;
  accountType?: AccountType;
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
  counterpartyName?: string;
  counterpartyInn?: string;
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
  vatMode?: VatMode;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency: string;
  notes: string;
  paidAt: string | null;
  paidAccountId: string | null;
  issuerOrganizationId?: string | null;
  issuerSnapshot?: InvoiceIssuerSnapshot | null;
  elbaBillId?: string;
  elbaSyncedAt?: string | null;
  elbaSyncError?: string;
  lineItems: InvoiceItemDTO[];
}

export interface PnlCategoryDTO {
  categoryName: string;
  amount: number;
  percentage: number;
}

export interface PnlCogsBreakdownItemDTO {
  movementId: string;
  itemName: string;
  batchNumber: string;
  supplierName: string;
  ticketNumber: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  occurredAt: string;
}

export interface PnlCogsSummaryDTO {
  partsRevenue: number;
  worksRevenue: number;
  partsCogs: number;
  partsGrossProfit: number;
  partsMarkupPercent: number;
  partsMarginPercent: number;
  accrualGrossProfit: number;
  stockValuation: number;
  writeOffsCount: number;
  breakdown: PnlCogsBreakdownItemDTO[];
}

export interface PnlDTO {
  from: string;
  to: string;
  income: number;
  expenses: number;
  netProfit: number;
  incomeByCategory: PnlCategoryDTO[];
  expensesByCategory: PnlCategoryDTO[];
  cogs?: PnlCogsSummaryDTO;
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
  account_type?: AccountType;
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
  issuer_organization_id?: string;
  company_id?: string;
  company_name: string;
  company_inn?: string;
  company_address?: string;
  contact_name?: string;
  contact_phone?: string;
  deal_id?: string;
  repair_order_id?: string;
  due_date: string;
  vat_mode?: VatMode;
  vat_rate?: number;
  currency?: string;
  notes?: string;
  sync_to_elba?: boolean;
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
  issuer_organization_id?: string;
  company_id?: string;
  company_name?: string;
  company_inn?: string;
  company_address?: string;
  contact_name?: string;
  contact_phone?: string;
  due_date?: string;
  vat_mode?: VatMode;
  vat_rate?: number;
  notes?: string;
  line_items?: {
    description: string;
    quantity?: number;
    unit_price: number;
    source?: string;
    source_label?: string;
  }[];
}

export interface MarkInvoicePaidPayload {
  account_id: string;
  occurred_at?: string;
  description?: string;
}

export interface FinanceCategoryDTO {
  id: string;
  name: string;
  type: "income" | "expense";
  parentId?: string | null;
  createdAt: string;
}

export interface CreateFinanceCategoryPayload {
  name: string;
  type: "income" | "expense";
  parent_id?: string | null;
}

export interface UpdateFinanceCategoryPayload {
  name?: string;
  type?: "income" | "expense";
  parent_id?: string | null;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const financeKeys = {
  all: ["finance"] as const,
  accounts: ["finance", "accounts"] as const,
  categories: (type?: "income" | "expense") => ["finance", "categories", type] as const,
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

export function useFinanceCategories(type?: "income" | "expense"): UseQueryResult<FinanceCategoryDTO[], ApiClientError> {
  return useQuery<FinanceCategoryDTO[], ApiClientError>({
    queryKey: financeKeys.categories(type),
    queryFn: async () => {
      const res = await apiClient.get<FinanceCategoryDTO[]>("/api/v1/finance/categories", {
        query: { type },
      });
      return res.data;
    },
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
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["repairs"] });
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useDeleteInvoice(): UseMutationResult<{ success: boolean; id: string }, ApiClientError, string> {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; id: string }, ApiClientError, string>({
    mutationFn: async (id) => {
      const res = await apiClient.delete<{ success: boolean; id: string }>(`/api/v1/invoices/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["repairs"] });
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

export interface CreateInvoiceFromActsPayload {
  repair_order_ids: string[];
  issuer_organization_id?: string;
  company_id?: string;
  company_name?: string;
  company_inn?: string;
  company_address?: string;
  contact_name?: string;
  contact_phone?: string;
  deal_id?: string;
  due_date?: string;
  vat_mode?: VatMode;
  vat_rate?: number;
  currency?: string;
  notes?: string;
  sync_to_elba?: boolean;
}

export interface BatchPaymentPayload {
  repair_order_ids: string[];
  cash_account_id: string;
  category_id?: string;
  works_category_id?: string;
  parts_category_id?: string;
  split_works_and_parts?: boolean;
  description?: string;
}

export interface SendInvoicePayload {
  channel_type: "telegram" | "whatsapp" | "all";
}

export function useRepairInvoices(repairOrderId: string | null): UseQueryResult<InvoiceDTO[], ApiClientError> {
  return useQuery<InvoiceDTO[], ApiClientError>({
    queryKey: ["repairs", repairOrderId, "invoices"],
    queryFn: async () => {
      if (!repairOrderId) return [];
      const res = await apiClient.get<InvoiceDTO[]>(`/api/v1/repairs/${repairOrderId}/invoices`);
      return res.data;
    },
    enabled: Boolean(repairOrderId),
  });
}

export function useCreateInvoiceFromActs(): UseMutationResult<
  InvoiceDTO,
  ApiClientError,
  CreateInvoiceFromActsPayload
> {
  const queryClient = useQueryClient();
  return useMutation<InvoiceDTO, ApiClientError, CreateInvoiceFromActsPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<InvoiceDTO>("/api/v1/invoices/from-repairs", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["repairs"] });
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useBatchPayment(): UseMutationResult<
  { success: boolean; totalPaid: number; count: number },
  ApiClientError,
  BatchPaymentPayload
> {
  const queryClient = useQueryClient();
  return useMutation<
    { success: boolean; totalPaid: number; count: number },
    ApiClientError,
    BatchPaymentPayload
  >({
    mutationFn: async (payload) => {
      const res = await apiClient.post<{ success: boolean; totalPaid: number; count: number }>(
        "/api/v1/finance/payments/batch",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repairs"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useSendInvoice(): UseMutationResult<
  { success: boolean; channels: string[]; message: string },
  ApiClientError,
  { id: string; channel_type: "telegram" | "whatsapp" | "all" }
> {
  return useMutation<
    { success: boolean; channels: string[]; message: string },
    ApiClientError,
    { id: string; channel_type: "telegram" | "whatsapp" | "all" }
  >({
    mutationFn: async ({ id, channel_type }) => {
      const res = await apiClient.post<{ success: boolean; channels: string[]; message: string }>(
        `/api/v1/invoices/${id}/send`,
        { channel_type },
      );
      return res.data;
    },
  });
}

export function useCreateFinanceCategory(): UseMutationResult<
  FinanceCategoryDTO,
  ApiClientError,
  CreateFinanceCategoryPayload
> {
  const queryClient = useQueryClient();
  return useMutation<FinanceCategoryDTO, ApiClientError, CreateFinanceCategoryPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<FinanceCategoryDTO>("/api/v1/finance/categories", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "categories"] });
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useUpdateFinanceCategory(): UseMutationResult<
  FinanceCategoryDTO,
  ApiClientError,
  { id: string; payload: UpdateFinanceCategoryPayload }
> {
  const queryClient = useQueryClient();
  return useMutation<FinanceCategoryDTO, ApiClientError, { id: string; payload: UpdateFinanceCategoryPayload }>({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.patch<FinanceCategoryDTO>(`/api/v1/finance/categories/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "categories"] });
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useDeleteFinanceCategory(): UseMutationResult<
  { success: boolean },
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, ApiClientError, string>({
    mutationFn: async (id) => {
      const res = await apiClient.delete<{ success: boolean }>(`/api/v1/finance/categories/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "categories"] });
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useDeleteTransaction(): UseMutationResult<
  { success: boolean; count: number },
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; count: number }, ApiClientError, string>({
    mutationFn: async (id) => {
      const res = await apiClient.delete<{ success: boolean; count: number }>(`/api/v1/finance/transactions/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useBulkDeleteTransactions(): UseMutationResult<
  { success: boolean; count: number },
  ApiClientError,
  string[]
> {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; count: number }, ApiClientError, string[]>({
    mutationFn: async (ids) => {
      const res = await apiClient.post<{ success: boolean; count: number }>("/api/v1/finance/transactions/bulk-delete", { ids });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export function useBulkDuplicateTransactions(): UseMutationResult<
  { data: TransactionDTO[]; count: number },
  ApiClientError,
  string[]
> {
  const queryClient = useQueryClient();
  return useMutation<{ data: TransactionDTO[]; count: number }, ApiClientError, string[]>({
    mutationFn: async (ids) => {
      const res = await apiClient.post<{ data: TransactionDTO[]; count: number }>("/api/v1/finance/transactions/bulk-duplicate", { ids });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });
}

export interface CounterpartyContact {
  id: string;
  name: string;
  phone: string;
  email: string;
}

export interface CounterpartyCompany {
  id: string;
  name: string;
  inn: string;
  phone: string;
}

export interface CounterpartiesData {
  contacts: CounterpartyContact[];
  companies: CounterpartyCompany[];
}

export function useCounterparties(search?: string): UseQueryResult<CounterpartiesData, ApiClientError> {
  return useQuery<CounterpartiesData, ApiClientError>({
    queryKey: ["finance", "counterparties", search ?? ""],
    queryFn: async () => {
      const res = await apiClient.get<CounterpartiesData>("/api/v1/finance/counterparties", {
        query: { search: search?.trim() || undefined },
      });
      return res.data;
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Finance Organizations, RF Invoice Form & Kontur.Elba
// ---------------------------------------------------------------------------

export const organizationKeys = {
  all: ["finance", "organizations"] as const,
};

export function useFinanceOrganizations(): UseQueryResult<FinanceOrganizationDTO[], ApiClientError> {
  return useQuery<FinanceOrganizationDTO[], ApiClientError>({
    queryKey: organizationKeys.all,
    queryFn: async () => {
      const res = await apiClient.get<FinanceOrganizationDTO[]>("/api/v1/finance/organizations");
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useCreateFinanceOrganization(): UseMutationResult<
  FinanceOrganizationDTO,
  ApiClientError,
  SaveOrganizationPayload & { name: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<FinanceOrganizationDTO>("/api/v1/finance/organizations", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}

export function useUpdateFinanceOrganization(): UseMutationResult<
  FinanceOrganizationDTO,
  ApiClientError,
  { id: string; payload: SaveOrganizationPayload }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.patch<FinanceOrganizationDTO>(
        `/api/v1/finance/organizations/${id}`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}

export function useSetDefaultFinanceOrganization(): UseMutationResult<
  FinanceOrganizationDTO,
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const res = await apiClient.post<FinanceOrganizationDTO>(
        `/api/v1/finance/organizations/${id}/set-default`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}

export function useDeleteFinanceOrganization(): UseMutationResult<
  { success: boolean },
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const res = await apiClient.delete<{ success: boolean }>(
        `/api/v1/finance/organizations/${id}`,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}

export function useTestElbaConnection(): UseMutationResult<
  { connected: boolean; organizations: ElbaOrganization[]; bankAccounts: ElbaBankAccount[] },
  ApiClientError,
  { id: string; api_key?: string }
> {
  return useMutation({
    mutationFn: async ({ id, api_key }) => {
      const res = await apiClient.post<{
        connected: boolean;
        organizations: ElbaOrganization[];
        bankAccounts: ElbaBankAccount[];
      }>(`/api/v1/finance/organizations/${id}/elba/test`, api_key ? { api_key } : {});
      return res.data;
    },
  });
}

export function useElbaBankAccounts(): UseMutationResult<
  ElbaBankAccount[],
  ApiClientError,
  { id: string; elba_organization_id: string; api_key?: string }
> {
  return useMutation({
    mutationFn: async ({ id, elba_organization_id, api_key }) => {
      const res = await apiClient.post<ElbaBankAccount[]>(
        `/api/v1/finance/organizations/${id}/elba/bank-accounts`,
        { elba_organization_id, ...(api_key ? { api_key } : {}) },
      );
      return res.data;
    },
  });
}

export function useInvoicePreviewHtml(): UseMutationResult<
  { html: string },
  ApiClientError,
  { id: string; payload: SaveOrganizationPayload }
> {
  return useMutation({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.post<{ html: string }>(
        `/api/v1/finance/organizations/${id}/invoice-preview`,
        payload,
      );
      return res.data;
    },
  });
}

export function useSyncInvoiceToElba(): UseMutationResult<
  { invoice: InvoiceDTO; elbaBillId: string },
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId) => {
      const res = await apiClient.post<{ invoice: InvoiceDTO; elbaBillId: string }>(
        `/api/v1/invoices/${invoiceId}/sync-elba`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["repairs"] });
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
      void queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}

export async function fetchInvoiceRfHtml(invoiceId: string, autoPrint = false): Promise<string> {
  const path = autoPrint
    ? `/api/v1/invoices/${invoiceId}/html?print=1`
    : `/api/v1/invoices/${invoiceId}/html`;
  const { blob } = await apiClient.downloadBlob(path);
  return blob.text();
}

export async function openInvoiceRfPrintWindow(invoiceId: string): Promise<void> {
  const html = await fetchInvoiceRfHtml(invoiceId, true);
  const w = window.open("", "_blank", "width=880,height=1040");
  if (!w) {
    throw new Error("Всплывающее окно заблокировано браузером");
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
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
