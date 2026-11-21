"use client";

import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiClient, triggerBrowserDownload } from "./apiClient";

export interface WarehouseItemModelDTO {
  id: string;
  name: string;
  brandId?: string;
  brandName?: string;
}

export interface WarehouseItemDTO {
  id: string;
  sku: string;
  name: string;
  brand?: string;
  category: string;
  unit: string;
  minStock: number;
  retailPrice: number;
  costPrice: number;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  price?: number;
  quantity?: number;
  models?: WarehouseItemModelDTO[];
  modelIds?: string[];
  modelNames?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseBatchDTO {
  id: string;
  itemId: string;
  itemName?: string;
  batchNumber: string;
  supplierName: string;
  purchasePrice: number;
  initialQuantity: number;
  remainingQuantity: number;
  receivedAt: string;
  createdAt: string;
}

export interface WarehouseMovementDTO {
  id: string;
  itemId: string;
  itemName?: string;
  batchId: string | null;
  repairOrderId: string | null;
  repairTicketNumber?: string | null;
  type: string;
  quantity: number;
  costPrice: number;
  description: string;
  createdByName?: string | null;
  createdAt: string;
}

export interface PurchaseRequestDTO {
  id: string;
  repairOrderId: string | null;
  repairTicketNumber?: string | null;
  itemId: string | null;
  itemName: string;
  sku: string;
  quantity: number;
  unit: string;
  estimatedPrice: number;
  status: "pending" | "ordered" | "received" | "cancelled";
  comment: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWarehouseItemPayload {
  sku?: string;
  name: string;
  brand?: string;
  category?: string;
  unit?: string;
  min_stock?: number;
  retail_price?: number;
  cost_price?: number;
  model_ids?: string[];
  models?: string[];
}

export interface IntakeBatchPayload {
  item_id?: string;
  name: string;
  sku?: string;
  category?: string;
  unit?: string;
  batch_number?: string;
  supplier_name?: string;
  purchase_price: number;
  quantity: number;
  retail_price?: number;
  record_finance_expense?: boolean;
  cash_account_id?: string;
}

export interface CreatePurchaseRequestPayload {
  repair_order_id?: string;
  item_id?: string;
  item_name: string;
  sku?: string;
  quantity: number;
  unit?: string;
  estimated_price?: number;
  comment?: string;
}

export interface WarehouseSettingsDTO {
  allowNegativeStock: boolean;
}

export interface AggregatedPurchaseRequestDTO {
  id: string;
  itemId: string | null;
  itemName: string;
  sku: string;
  unit: string;
  quantity: number;
  estimatedPrice: number;
  status: "pending" | "ordered" | "received" | "cancelled";
  repairOrders: string;
  repair_orders: string;
  requestIds: string[];
  availableStock: number;
  totalStock: number;
}

export interface SupplierOrderItemDTO {
  id: string;
  supplierOrderId: string;
  purchaseRequestId: string | null;
  itemId: string | null;
  itemName: string;
  sku: string;
  requestedQuantity: number;
  extraQuantity: number;
  repairOrderId?: string | null;
  purchaseRequestIds?: string[];
  repairOrders?: string;
  quantity: number;
  unit: string;
  price: number;
  totalPrice: number;
  createdAt: string;
}

export interface SupplierOrderDTO {
  id: string;
  orderNumber: string;
  supplierName: string;
  supplierCompanyId: string | null;
  status: "draft" | "pending_payment" | "paid" | "received" | "cancelled";
  totalAmount: number;
  cashAccountId: string | null;
  financeTransactionId: string | null;
  notes: string;
  paidAt: string | null;
  receivedAt: string | null;
  createdBy: string | null;
  createdByName?: string | null;
  items: SupplierOrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierOrderPayload {
  supplier_name: string;
  supplier_company_id?: string | null;
  purchase_request_ids?: string[];
  items?: {
    purchase_request_id?: string | null;
    purchase_request_ids?: string[];
    item_id?: string | null;
    item_name: string;
    sku?: string;
    requested_quantity?: number;
    extra_quantity?: number;
    quantity: number;
    unit?: string;
    price: number;
    repair_orders?: string;
  }[];
  notes?: string;
}

export interface UpdateSupplierOrderPayload {
  supplier_name?: string;
  supplier_company_id?: string | null;
  notes?: string;
  status?: "draft" | "pending_payment" | "paid" | "received" | "cancelled";
  items?: {
    id?: string;
    purchase_request_id?: string | null;
    purchase_request_ids?: string[];
    item_id?: string | null;
    item_name: string;
    sku?: string;
    requested_quantity?: number;
    extra_quantity?: number;
    quantity: number;
    unit?: string;
    price: number;
    repair_orders?: string;
  }[];
}

export interface ReceiptSupplierOrderPayload {
  cash_account_id?: string;
  mark_paid?: boolean;
  comment?: string;
}

export interface PaySupplierOrderPayload {
  cash_account_id?: string;
  comment?: string;
}

export interface PaySupplierOrderResult {
  order: SupplierOrderDTO;
  status: string;
  transaction_id: string;
}

export const warehouseKeys = {
  all: ["warehouse"] as const,
  items: (search?: string) => [...warehouseKeys.all, "items", search ?? ""] as const,
  batches: (itemId?: string) => [...warehouseKeys.all, "batches", itemId ?? ""] as const,
  movements: () => [...warehouseKeys.all, "movements"] as const,
  categories: () => [...warehouseKeys.all, "categories"] as const,
  brands: () => [...warehouseKeys.all, "brands"] as const,
  models: (brandId?: string, brand?: string) =>
    [...warehouseKeys.all, "models", brandId ?? "", brand ?? ""] as const,
  purchases: (status?: string, orderId?: string) => {
    const key = [...warehouseKeys.all, "purchases"] as string[];
    if (status !== undefined || orderId !== undefined) {
      key.push(status ?? "");
      if (orderId !== undefined) {
        key.push(orderId);
      }
    }
    return key;
  },
};

export interface WarehousePaginationMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PaginatedWarehouseResponse {
  items: WarehouseItemDTO[];
  meta: WarehousePaginationMeta;
}

export interface WarehousePaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  brand?: string;
  all?: boolean;
}

export function useWarehouse(params?: WarehousePaginationParams) {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const search = params?.search;
  const category = params?.category;
  const brand = params?.brand;
  const all = params?.all;

  return useQuery({
    queryKey: [
      "warehouse",
      "items",
      page,
      limit,
      search ?? "",
      category ?? "",
      brand ?? "",
      Boolean(all),
    ],
    queryFn: async (): Promise<PaginatedWarehouseResponse> => {
      const q = new URLSearchParams();
      if (!all) {
        q.set("page", String(page));
        q.set("limit", String(limit));
      } else {
        q.set("all", "true");
      }
      if (search && search.trim()) {
        q.set("search", search.trim());
      }
      if (category && category.trim()) {
        q.set("category", category.trim());
      }
      if (brand && brand.trim()) {
        q.set("brand", brand.trim());
      }

      const qs = q.toString();
      const res = await apiClient.get<WarehouseItemDTO[]>(
        `/api/v1/warehouse/items${qs ? `?${qs}` : ""}`,
      );

      const rawMeta = res.meta || {};
      const total = Number(rawMeta.total ?? res.data.length);
      const curPage = Number(rawMeta.page ?? page);
      const curLimit = Number(rawMeta.limit ?? limit);
      const pages = Number(rawMeta.pages ?? (total === 0 ? 0 : Math.ceil(total / curLimit)));

      return {
        items: res.data ?? [],
        meta: {
          total,
          page: curPage,
          limit: curLimit,
          pages,
        },
      };
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useWarehouseItems(search?: string) {
  return useQuery({
    queryKey: warehouseKeys.items(search),
    queryFn: async () => {
      const params = search ? `?search=${encodeURIComponent(search)}&all=true` : "?all=true";
      const res = await apiClient.get<WarehouseItemDTO[]>(`/api/v1/warehouse/items${params}`);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useWarehouseItem(id?: string | null) {
  return useQuery({
    queryKey: ["warehouse", "items", id],
    queryFn: async () => {
      if (!id) throw new Error("Item ID is required");
      const res = await apiClient.get<WarehouseItemDTO>(`/api/v1/warehouse/items/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateWarehouseItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateWarehouseItemPayload) => {
      const res = await apiClient.post<WarehouseItemDTO>("/api/v1/warehouse/items", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
    },
  });
}

export function useUpdateWarehouseItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<CreateWarehouseItemPayload> }) => {
      const res = await apiClient.patch<WarehouseItemDTO>(`/api/v1/warehouse/items/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
    },
  });
}

export function useDeleteWarehouseItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<{ success: boolean }>(`/api/v1/warehouse/items/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
    },
  });
}

export function useIntakeWarehouseBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IntakeBatchPayload) => {
      const res = await apiClient.post<WarehouseBatchDTO>("/api/v1/warehouse/intake", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.batches() });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.movements() });
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
    },
  });
}

export function useWarehouseBatches(itemId?: string) {
  return useQuery({
    queryKey: warehouseKeys.batches(itemId),
    queryFn: async () => {
      const params = itemId ? `?item_id=${encodeURIComponent(itemId)}` : "";
      const res = await apiClient.get<WarehouseBatchDTO[]>(`/api/v1/warehouse/batches${params}`);
      return res.data;
    },
  });
}

export function useWarehouseMovements(limit: number = 100) {
  return useQuery({
    queryKey: warehouseKeys.movements(),
    queryFn: async () => {
      const res = await apiClient.get<WarehouseMovementDTO[]>(`/api/v1/warehouse/movements?limit=${limit}`);
      return res.data;
    },
  });
}

export function usePurchaseRequests(status?: string, orderId?: string) {
  return useQuery({
    queryKey: warehouseKeys.purchases(status, orderId),
    queryFn: async () => {
      const q = new URLSearchParams();
      if (status) q.append("status", status);
      if (orderId) q.append("repair_order_id", orderId);
      const res = await apiClient.get<PurchaseRequestDTO[]>(`/api/v1/warehouse/purchases?${q.toString()}`);
      return res.data;
    },
  });
}

export function useCreatePurchaseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePurchaseRequestPayload) => {
      const res = await apiClient.post<PurchaseRequestDTO>("/api/v1/warehouse/purchases", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "purchases"] });
    },
  });
}

export function useUpdatePurchaseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: { status?: string; comment?: string };
    }) => {
      const res = await apiClient.patch<PurchaseRequestDTO>(`/api/v1/warehouse/purchases/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "purchases"] });
    },
  });
}

export function useWarehouseSettings() {
  return useQuery({
    queryKey: [...warehouseKeys.all, "settings"] as const,
    queryFn: async () => {
      const res = await apiClient.get<WarehouseSettingsDTO>("/api/v1/warehouse/settings");
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateWarehouseSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { allow_negative_stock: boolean }) => {
      const res = await apiClient.patch<WarehouseSettingsDTO>("/api/v1/warehouse/settings", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "settings"] });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
    },
  });
}

export function useAggregatedPurchaseRequests(status?: string) {
  return useQuery({
    queryKey: [...warehouseKeys.all, "aggregated-purchases", status ?? ""] as const,
    queryFn: async () => {
      const q = status ? `?status=${encodeURIComponent(status)}` : "";
      const res = await apiClient.get<AggregatedPurchaseRequestDTO[]>(`/api/v1/warehouse/purchase-requests${q}`);
      return res.data;
    },
  });
}

export function useSupplierOrders(status?: string) {
  return useQuery({
    queryKey: [...warehouseKeys.all, "supplier-orders", status ?? ""] as const,
    queryFn: async () => {
      const q = status ? `?status=${encodeURIComponent(status)}` : "";
      const res = await apiClient.get<SupplierOrderDTO[]>(`/api/v1/warehouse/supplier-orders${q}`);
      return res.data;
    },
  });
}

export function useCreateSupplierOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateSupplierOrderPayload) => {
      const res = await apiClient.post<SupplierOrderDTO>("/api/v1/warehouse/supplier-orders", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "supplier-orders"] });
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "aggregated-purchases"] });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.purchases() });
    },
  });
}

export function useUpdateSupplierOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: UpdateSupplierOrderPayload;
    }): Promise<SupplierOrderDTO> => {
      const res = await apiClient.patch<SupplierOrderDTO>(
        `/api/v1/warehouse/supplier-orders/${id}`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "supplier-orders"] });
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "aggregated-purchases"] });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.purchases() });
    },
  });
}

export function useDeleteSupplierOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      await apiClient.delete(`/api/v1/warehouse/supplier-orders/${id}`);
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "supplier-orders"] });
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "aggregated-purchases"] });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.purchases() });
    },
  });
}

export function usePaySupplierOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload?: PaySupplierOrderPayload;
    }): Promise<PaySupplierOrderResult> => {
      const res = await apiClient.post<SupplierOrderDTO>(
        `/api/v1/warehouse/supplier-orders/${id}/pay`,
        payload ?? {},
      );
      const raw = res as unknown as {
        data: SupplierOrderDTO;
        status: string;
        transaction_id: string;
      };
      return {
        order: raw.data,
        status: raw.status,
        transaction_id: raw.transaction_id,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "supplier-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
    },
  });
}

export function useCreateReceiptFromSupplierOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload?: ReceiptSupplierOrderPayload;
    }): Promise<{ success: boolean; order: SupplierOrderDTO; batchesCreated: number; transactionId?: string }> => {
      const res = await apiClient.post<{ success: boolean; order: SupplierOrderDTO; batchesCreated: number; transactionId?: string }>(
        `/api/v1/warehouse/supplier-orders/${id}/create-receipt`,
        payload ?? {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "supplier-orders"] });
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "aggregated-purchases"] });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.purchases() });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.batches() });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.movements() });
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Export / Import / Bulk Operations
// ---------------------------------------------------------------------------

export interface ExportWarehouseItemsPayload {
  format: "xlsx" | "csv";
  ids?: string[];
  search?: string;
}

export interface ImportParseResultDTO {
  headers: string[];
  sampleRows: string[][];
  rows?: string[][];
  totalRows: number;
  detectedDelimiter?: string;
  suggestedMapping: Record<string, string>;
}

export interface ImportParsedItem {
  rowNumber: number;
  name: string;
  sku: string;
  brand: string;
  category: string;
  unit: string;
  costPrice: number;
  retailPrice: number;
  minStock: number;
}

export interface ImportDuplicateConflictDTO {
  rowNumber: number;
  reason: "sku_match" | "name_match";
  matchKey: string;
  existing: {
    id: string;
    sku: string;
    name: string;
    brand: string;
    category: string;
    unit: string;
    costPrice: number;
    retailPrice: number;
    minStock: number;
    totalStock?: number;
  };
  incoming: ImportParsedItem;
}

export interface ImportValidatePayload {
  rows: string[][];
  mapping: Record<string, string>;
  skipFirstRow: boolean;
}

export interface ImportValidateResultDTO {
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  duplicates: ImportDuplicateConflictDTO[];
  sampleValid: ImportParsedItem[];
  errors: { rowNumber: number; message: string }[];
}

export interface ImportCommitPayload {
  rows: string[][];
  mapping: Record<string, string>;
  skipFirstRow: boolean;
  resolutions?: Record<string, "overwrite" | "skip" | "keep_both">;
  defaultResolution?: "overwrite" | "skip";
}

export interface ImportErrorDetailDTO {
  rowNumber: number;
  reason: string;
}

export interface ImportCommitResultDTO {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  total?: number;
  errors?: ImportErrorDetailDTO[];
}

export interface PriceAdjustmentAction {
  mode: "set" | "percent" | "delta";
  value: number;
}

export interface BulkUpdateWarehouseItemsPayload {
  ids: string[];
  category?: string;
  brand?: string;
  unit?: string;
  min_stock?: number;
  retail_price_action?: PriceAdjustmentAction;
  cost_price_action?: PriceAdjustmentAction;
}

export interface BulkDeleteWarehouseItemsPayload {
  ids: string[];
}

export async function downloadWarehouseExport(payload: ExportWarehouseItemsPayload): Promise<void> {
  const { blob, filename } = await apiClient.downloadBlob("/api/v1/warehouse/export", {
    method: "POST",
    body: payload,
  });
  const fallback = payload.format === "csv" ? "catalog.csv" : "catalog.xlsx";
  triggerBrowserDownload(blob, filename ?? fallback);
}

export function useExportWarehouseItems() {
  return useMutation({
    mutationFn: (payload: ExportWarehouseItemsPayload) => downloadWarehouseExport(payload),
  });
}

export function useImportParse() {
  return useMutation({
    mutationFn: async ({ file, delimiter }: { file: File; delimiter?: string }): Promise<ImportParseResultDTO> => {
      const formData = new FormData();
      formData.append("file", file);
      if (delimiter) {
        formData.append("delimiter", delimiter);
      }
      const res = await apiClient.postFormData<ImportParseResultDTO>(
        "/api/v1/warehouse/import/parse",
        formData,
      );
      return res.data;
    },
  });
}

export function useImportValidate() {
  return useMutation({
    mutationFn: async (payload: ImportValidatePayload): Promise<ImportValidateResultDTO> => {
      const res = await apiClient.post<ImportValidateResultDTO>(
        "/api/v1/warehouse/import/validate",
        payload,
      );
      return res.data;
    },
  });
}

export function useImportCommit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ImportCommitPayload): Promise<ImportCommitResultDTO> => {
      const res = await apiClient.post<ImportCommitResultDTO>(
        "/api/v1/warehouse/import/commit",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
    },
  });
}

export function useBulkUpdateWarehouseItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BulkUpdateWarehouseItemsPayload): Promise<{ updatedCount: number }> => {
      const res = await apiClient.post<{ updatedCount: number }>(
        "/api/v1/warehouse/items/bulk-update",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
    },
  });
}

export function useBulkDeleteWarehouseItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BulkDeleteWarehouseItemsPayload): Promise<{ deletedCount: number; errors?: string[] }> => {
      const res = await apiClient.post<{ deletedCount: number; errors?: string[] }>(
        "/api/v1/warehouse/items/bulk-delete",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.items() });
    },
  });
}

export function useWarehouseCategories() {
  return useQuery({
    queryKey: warehouseKeys.categories(),
    queryFn: async (): Promise<string[]> => {
      const res = await apiClient.get<string[]>("/api/v1/warehouse/categories");
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateWarehouseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<{ id: string; name: string }> => {
      const res = await apiClient.post<{ id: string; name: string }>(
        "/api/v1/warehouse/categories",
        { name },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.categories() });
      void queryClient.invalidateQueries({ queryKey: ["repair-order", "dictionaries"] });
      void queryClient.invalidateQueries({ queryKey: ["dictionaries"] });
    },
  });
}

export function useWarehouseBrands() {
  return useQuery({
    queryKey: warehouseKeys.brands(),
    queryFn: async (): Promise<string[]> => {
      const res = await apiClient.get<string[]>("/api/v1/warehouse/brands");
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateWarehouseBrand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<{ id: string; name: string }> => {
      const res = await apiClient.post<{ id: string; name: string }>(
        "/api/v1/warehouse/brands",
        { name },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.brands() });
      void queryClient.invalidateQueries({ queryKey: ["repair-order", "dictionaries"] });
      void queryClient.invalidateQueries({ queryKey: ["dictionaries"] });
    },
  });
}

export function useWarehouseModels(params?: { brandId?: string; brand?: string }) {
  return useQuery({
    queryKey: warehouseKeys.models(params?.brandId, params?.brand),
    queryFn: async (): Promise<WarehouseItemModelDTO[]> => {
      const q = new URLSearchParams();
      if (params?.brandId) q.set("brandId", params.brandId);
      if (params?.brand) q.set("brand", params.brand);
      const qs = q.toString();
      const res = await apiClient.get<WarehouseItemModelDTO[]>(
        `/api/v1/warehouse/models${qs ? `?${qs}` : ""}`,
      );
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateWarehouseModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      brand_id?: string;
      brand?: string;
    }): Promise<WarehouseItemModelDTO> => {
      const res = await apiClient.post<WarehouseItemModelDTO>(
        "/api/v1/warehouse/models",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "models"] });
      void queryClient.invalidateQueries({ queryKey: ["repair-order", "dictionaries"] });
      void queryClient.invalidateQueries({ queryKey: ["dictionaries"] });
    },
  });
}

export function useUpdateWarehouseModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: { name: string; brand_id?: string; brand?: string };
    }): Promise<WarehouseItemModelDTO> => {
      const res = await apiClient.patch<WarehouseItemModelDTO>(
        `/api/v1/warehouse/models/${id}`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "models"] });
      void queryClient.invalidateQueries({ queryKey: ["repair-order", "dictionaries"] });
      void queryClient.invalidateQueries({ queryKey: ["dictionaries"] });
    },
  });
}

export function useDeleteWarehouseModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ success: boolean; id: string }> => {
      const res = await apiClient.delete<{ success: boolean; id: string }>(
        `/api/v1/warehouse/models/${id}`,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "models"] });
      void queryClient.invalidateQueries({ queryKey: ["repair-order", "dictionaries"] });
      void queryClient.invalidateQueries({ queryKey: ["dictionaries"] });
    },
  });
}
