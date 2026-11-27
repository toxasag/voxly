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
  fifoCostPrice?: number;
  avgBatchCostPrice?: number;
  stockValuation?: number;
  activeBatchesCount?: number;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  reserved?: boolean;
  status?: "reserved" | "in_stock" | "out_of_stock";
  stockStatus?: "reserved" | "in_stock" | "out_of_stock";
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
  supplierOrderId?: string | null;
  receiptId?: string | null;
  itemName?: string;
  batchNumber: string;
  supplierName: string;
  purchasePrice: number;
  basePurchasePrice?: number;
  landedCostPerUnit?: number;
  landedCostTotal?: number;
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
  dealId?: string | null;
  dealItemId?: string | null;
  dealTitle?: string | null;
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
  dealId?: string | null;
  dealItemId?: string | null;
  repairTicketNumber?: string | null;
  dealTitle?: string | null;
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

export type IntakeDocumentBasis =
  | "supplier_order"
  | "initial_balance"
  | "direct_purchase"
  | "inventory_adjustment";

export interface IntakeDocumentItemPayload {
  item_id?: string;
  name: string;
  sku?: string;
  category?: string;
  unit?: string;
  quantity: number;
  purchase_price: number;
  retail_price?: number;
  batch_number?: string;
}

export interface IntakeDocumentPayload {
  basis: IntakeDocumentBasis;
  supplier_order_id?: string | null;
  supplier_name?: string;
  supplier_company_id?: string | null;
  incoming_document_number?: string;
  document_date?: string;
  notes?: string;
  items: IntakeDocumentItemPayload[];
  record_finance_expense?: boolean;
  cash_account_id?: string | null;
  payment_comment?: string;
}

export interface IntakeDocumentResultDTO {
  success: boolean;
  documentNumber: string;
  basis: IntakeDocumentBasis;
  batchesCreated: number;
  totalQuantity: number;
  totalAmount: number;
  transactionId?: string;
  supplierOrderId?: string;
}

export interface CreatePurchaseRequestPayload {
  repair_order_id?: string;
  deal_id?: string;
  deal_item_id?: string;
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

export type LandedCostAllocationMethod = "by_value" | "by_quantity" | "manual";

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
  receivedQuantity?: number;
  remainingQuantity?: number;
  unit: string;
  price: number;
  totalPrice: number;
  createdAt: string;
}

export interface SupplierOrderReceiptItemDTO {
  id: string;
  receiptId: string;
  supplierOrderItemId: string;
  batchId: string | null;
  itemId: string | null;
  itemName: string;
  quantity: number;
  baseUnitPrice: number;
  allocatedExtraCost: number;
  unitLandedCost: number;
  effectiveUnitPrice: number;
  createdAt: string;
}

export interface SupplierOrderReceiptCostDTO {
  id: string;
  receiptId: string;
  description: string;
  amount: number;
  categoryId: string | null;
  categoryName: string;
  cashAccountId: string | null;
  transactionId: string | null;
  createdAt: string;
}

export interface SupplierOrderReceiptDTO {
  id: string;
  supplierOrderId: string;
  receiptNumber: string;
  allocationMethod: LandedCostAllocationMethod;
  extraCostsTotal: number;
  notes: string;
  createdBy: string | null;
  createdByName?: string | null;
  items: SupplierOrderReceiptItemDTO[];
  costs: SupplierOrderReceiptCostDTO[];
  createdAt: string;
}

export interface SupplierOrderDTO {
  id: string;
  orderNumber: string;
  supplierName: string;
  supplierCompanyId: string | null;
  status: "draft" | "pending_payment" | "paid" | "partially_received" | "received" | "cancelled";
  totalAmount: number;
  cashAccountId: string | null;
  financeTransactionId: string | null;
  notes: string;
  paidAt: string | null;
  receivedAt: string | null;
  createdBy: string | null;
  createdByName?: string | null;
  items: SupplierOrderItemDTO[];
  orderedQuantityTotal?: number;
  receivedQuantityTotal?: number;
  extraCostsTotal?: number;
  receipts?: SupplierOrderReceiptDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierOrderPayload {
  supplier_name: string;
  supplier_company_id?: string | null;
  purchase_request_ids?: string[];
  status?: "draft" | "pending_payment" | "paid";
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

export interface ReceiptSupplierOrderItemInput {
  supplier_order_item_id: string;
  quantity: number;
  manual_extra_cost?: number;
}

export interface ReceiptExtraCostInput {
  description: string;
  amount: number;
  category_id?: string | null;
  category_name?: string;
  cash_account_id?: string | null;
  counterparty_name?: string;
}

export interface ReceiptSupplierOrderPayload {
  cash_account_id?: string;
  mark_paid?: boolean;
  comment?: string;
  items?: ReceiptSupplierOrderItemInput[];
  allocation_method?: LandedCostAllocationMethod;
  extra_costs?: ReceiptExtraCostInput[];
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
  purchases: (status?: string, orderId?: string, dealId?: string) => {
    const key = [...warehouseKeys.all, "purchases"] as string[];
    if (status !== undefined || orderId !== undefined || dealId !== undefined) {
      key.push(status ?? "");
      if (orderId !== undefined || dealId !== undefined) {
        key.push(orderId ?? "");
        if (dealId !== undefined) {
          key.push(dealId);
        }
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
  totalValuation?: number;
  lowStockCount?: number;
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
  model_ids?: string[];
  modelIds?: string[];
  all?: boolean;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useWarehouse(params?: WarehousePaginationParams) {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const search = params?.search;
  const category = params?.category;
  const brand = params?.brand;
  const modelIds = params?.model_ids ?? params?.modelIds;
  const modelIdsKey = (modelIds ?? []).slice().sort().join(",");
  const all = params?.all;
  const sortBy = params?.sortBy;
  const sortDir = params?.sortDir;

  return useQuery({
    queryKey: [
      "warehouse",
      "items",
      page,
      limit,
      search ?? "",
      category ?? "",
      brand ?? "",
      modelIdsKey,
      Boolean(all),
      sortBy ?? "",
      sortDir ?? "",
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
      if (modelIds && modelIds.length > 0) {
        q.set("model_ids", modelIds.join(","));
      }
      if (sortBy) {
        q.set("sort_by", sortBy);
        if (sortDir) q.set("sort_dir", sortDir);
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
      const totalValuation =
        typeof rawMeta.totalValuation === "number" ? rawMeta.totalValuation : undefined;
      const lowStockCount =
        typeof rawMeta.lowStockCount === "number" ? rawMeta.lowStockCount : undefined;

      return {
        items: res.data ?? [],
        meta: {
          total,
          page: curPage,
          limit: curLimit,
          pages,
          totalValuation,
          lowStockCount,
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
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "items"] });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.categories() });
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
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "items"] });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.categories() });
    },
  });
}

export function useDeleteWarehouseItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (arg: string | { id: string; force?: boolean }) => {
      const id = typeof arg === "string" ? arg : arg.id;
      const force = typeof arg === "string" ? false : Boolean(arg.force);
      const url = force ? `/api/v1/warehouse/items/${id}?force=true` : `/api/v1/warehouse/items/${id}`;
      const res = await apiClient.delete<{ success: boolean }>(url);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
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

export function useIntakeWarehouseDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IntakeDocumentPayload) => {
      const res = await apiClient.post<IntakeDocumentResultDTO>("/api/v1/warehouse/intake-document", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export interface WarehouseTabParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  itemId?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface PaginatedWarehouseTabResponse<T> {
  items: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

function buildWarehouseTabQuery(params: WarehouseTabParams = {}): string {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 25));
  if (params.search && params.search.trim()) q.set("search", params.search.trim());
  if (params.status && params.status !== "all") q.set("status", params.status);
  if (params.itemId) q.set("item_id", params.itemId);
  if (params.sortBy) {
    q.set("sort_by", params.sortBy);
    if (params.sortDir) q.set("sort_dir", params.sortDir);
  }
  return q.toString();
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

export function useWarehouseBatchesPaginated(params: WarehouseTabParams = {}, options?: { enabled?: boolean }) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 25;
  return useQuery<PaginatedWarehouseTabResponse<WarehouseBatchDTO>>({
    queryKey: [...warehouseKeys.all, "batches-paginated", { ...params, page, limit }],
    queryFn: async () => {
      const qs = buildWarehouseTabQuery({ ...params, page, limit });
      const res = await apiClient.get<WarehouseBatchDTO[]>(`/api/v1/warehouse/batches?${qs}`);
      const m = res.meta ?? {};
      const total = Number(m.total ?? res.data.length);
      return {
        items: res.data ?? [],
        meta: {
          total,
          page: Number(m.page ?? page),
          limit: Number(m.limit ?? limit),
          pages: Number(m.pages ?? (total === 0 ? 0 : Math.ceil(total / limit))),
        },
      };
    },
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
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

export function useWarehouseMovementsPaginated(params: WarehouseTabParams = {}, options?: { enabled?: boolean }) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 25;
  return useQuery<PaginatedWarehouseTabResponse<WarehouseMovementDTO>>({
    queryKey: [...warehouseKeys.all, "movements-paginated", { ...params, page, limit }],
    queryFn: async () => {
      const qs = buildWarehouseTabQuery({ ...params, page, limit });
      const res = await apiClient.get<WarehouseMovementDTO[]>(`/api/v1/warehouse/movements?${qs}`);
      const m = res.meta ?? {};
      const total = Number(m.total ?? res.data.length);
      return {
        items: res.data ?? [],
        meta: {
          total,
          page: Number(m.page ?? page),
          limit: Number(m.limit ?? limit),
          pages: Number(m.pages ?? (total === 0 ? 0 : Math.ceil(total / limit))),
        },
      };
    },
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function usePurchaseRequests(status?: string, orderId?: string, dealId?: string) {
  return useQuery({
    queryKey: warehouseKeys.purchases(status, orderId, dealId),
    queryFn: async () => {
      const q = new URLSearchParams();
      if (status) q.append("status", status);
      if (orderId) q.append("repair_order_id", orderId);
      if (dealId) q.append("deal_id", dealId);
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

export type WarehouseBulkScopePayload = {
  mode?: "ids" | "all";
  ids?: string[];
  excluded_ids?: string[];
  filters?: Record<string, unknown>;
};

export function useBulkCreatePurchaseRequests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: WarehouseBulkScopePayload & {
        itemIds?: string[];
        comment?: string;
        status?: string;
        repair_order_id?: string;
        deal_id?: string;
      },
    ) => {
      const res = await apiClient.post<PurchaseRequestDTO[]>("/api/v1/purchase-requests", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "purchases"] });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

export interface UpdatePurchaseRequestPayload {
  item_name?: string;
  sku?: string;
  quantity?: number;
  unit?: string;
  estimated_price?: number;
  status?: "pending" | "ordered" | "received" | "cancelled";
  comment?: string;
}

export function useUpdatePurchaseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: UpdatePurchaseRequestPayload;
    }) => {
      const res = await apiClient.patch<PurchaseRequestDTO>(`/api/v1/warehouse/purchases/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "purchases"] });
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "aggregated-purchases"] });
    },
  });
}

export function useDeletePurchaseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<{ deleted: boolean; id: string }>(`/api/v1/warehouse/purchases/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "purchases"] });
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "aggregated-purchases"] });
      void queryClient.invalidateQueries({ queryKey: [...warehouseKeys.all, "supplier-orders"] });
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

export function useAggregatedPurchaseRequestsPaginated(
  params: WarehouseTabParams = {},
  options?: { enabled?: boolean },
) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 25;
  return useQuery<PaginatedWarehouseTabResponse<AggregatedPurchaseRequestDTO>>({
    queryKey: [...warehouseKeys.all, "aggregated-purchases-paginated", { ...params, page, limit }],
    queryFn: async () => {
      const qs = buildWarehouseTabQuery({ ...params, page, limit });
      const res = await apiClient.get<AggregatedPurchaseRequestDTO[]>(
        `/api/v1/warehouse/purchase-requests?${qs}`,
      );
      const m = res.meta ?? {};
      const total = Number(m.total ?? res.data.length);
      return {
        items: res.data ?? [],
        meta: {
          total,
          page: Number(m.page ?? page),
          limit: Number(m.limit ?? limit),
          pages: Number(m.pages ?? (total === 0 ? 0 : Math.ceil(total / limit))),
        },
      };
    },
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
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

export function useSupplierOrdersPaginated(
  params: WarehouseTabParams = {},
  options?: { enabled?: boolean },
) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 25;
  return useQuery<PaginatedWarehouseTabResponse<SupplierOrderDTO>>({
    queryKey: [...warehouseKeys.all, "supplier-orders-paginated", { ...params, page, limit }],
    queryFn: async () => {
      const qs = buildWarehouseTabQuery({ ...params, page, limit });
      const res = await apiClient.get<SupplierOrderDTO[]>(`/api/v1/warehouse/supplier-orders?${qs}`);
      const m = res.meta ?? {};
      const total = Number(m.total ?? res.data.length);
      return {
        items: res.data ?? [],
        meta: {
          total,
          page: Number(m.page ?? page),
          limit: Number(m.limit ?? limit),
          pages: Number(m.pages ?? (total === 0 ? 0 : Math.ceil(total / limit))),
        },
      };
    },
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
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
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
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
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
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
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
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
    }): Promise<{
      success: boolean;
      order: SupplierOrderDTO;
      batchesCreated: number;
      receiptId?: string;
      status?: SupplierOrderDTO["status"];
      extraCostsTotal?: number;
      transactionId?: string;
    }> => {
      const res = await apiClient.post<{
        success: boolean;
        order: SupplierOrderDTO;
        batchesCreated: number;
        receiptId?: string;
        status?: SupplierOrderDTO["status"];
        extraCostsTotal?: number;
        transactionId?: string;
      }>(
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
      void queryClient.invalidateQueries({ queryKey: ["repairs"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Export / Import / Bulk Operations
// ---------------------------------------------------------------------------

export interface ExportWarehouseItemsPayload {
  format: "xlsx" | "csv";
  mode?: "ids" | "all";
  ids?: string[];
  excluded_ids?: string[];
  filters?: Record<string, unknown>;
  search?: string;
  category?: string;
  brand?: string;
  model_ids?: string[];
  sort_by?: string;
  sort_dir?: "asc" | "desc";
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
  mode?: "ids" | "all";
  ids?: string[];
  excluded_ids?: string[];
  filters?: Record<string, unknown>;
  category?: string;
  brand?: string;
  unit?: string;
  min_stock?: number;
  retail_price_action?: PriceAdjustmentAction;
  cost_price_action?: PriceAdjustmentAction;
  models?: string[];
  model_ids?: string[];
  models_mode?: "replace" | "add" | "remove";
}

export interface BulkDeleteWarehouseItemsPayload {
  mode?: "ids" | "all";
  ids?: string[];
  excluded_ids?: string[];
  filters?: Record<string, unknown>;
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
    mutationFn: async (
      payload: BulkDeleteWarehouseItemsPayload & { force?: boolean },
    ): Promise<{ deletedCount: number; errors?: string[] }> => {
      const res = await apiClient.post<{ deletedCount: number; errors?: string[] }>(
        "/api/v1/warehouse/items/bulk-delete",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
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


// ---------------------------------------------------------------------------
// Редактирование и удаление партий, движений, массовые операции
// ---------------------------------------------------------------------------

export interface UpdateWarehouseBatchPayload {
  batch_number?: string;
  supplier_name?: string;
  purchase_price?: number;
  initial_quantity?: number;
  remaining_quantity?: number;
  received_at?: string;
}

export interface UpdateWarehouseMovementPayload {
  description?: string;
  quantity?: number;
  cost_price?: number;
}

export function useUpdateWarehouseBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateWarehouseBatchPayload }) => {
      const res = await apiClient.patch<WarehouseBatchDTO>(`/api/v1/warehouse/batches/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

export function useDeleteWarehouseBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<{ deleted: boolean; id: string }>(`/api/v1/warehouse/batches/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

function normalizeWarehouseBulkPayload(input: string[] | WarehouseBulkScopePayload): WarehouseBulkScopePayload {
  return Array.isArray(input) ? { mode: "ids", ids: input } : input;
}

export function useBulkDeleteWarehouseBatches() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: string[] | WarehouseBulkScopePayload) => {
      const res = await apiClient.post<{ deletedCount: number }>(
        "/api/v1/warehouse/batches/bulk-delete",
        normalizeWarehouseBulkPayload(input),
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

export function useUpdateWarehouseMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateWarehouseMovementPayload }) => {
      const res = await apiClient.patch<WarehouseMovementDTO>(`/api/v1/warehouse/movements/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

export function useDeleteWarehouseMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<{ deleted: boolean; id: string }>(`/api/v1/warehouse/movements/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

export function useBulkDeleteWarehouseMovements() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: string[] | WarehouseBulkScopePayload) => {
      const res = await apiClient.post<{ deletedCount: number }>(
        "/api/v1/warehouse/movements/bulk-delete",
        normalizeWarehouseBulkPayload(input),
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

export function useBulkDeletePurchaseRequests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: string[] | WarehouseBulkScopePayload) => {
      const res = await apiClient.post<{ deletedCount: number }>(
        "/api/v1/warehouse/purchases/bulk-delete",
        normalizeWarehouseBulkPayload(input),
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

export function useBulkDeleteSupplierOrders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: string[] | WarehouseBulkScopePayload) => {
      const res = await apiClient.post<{ deletedCount: number; rolledBackBatchesCount: number }>(
        "/api/v1/warehouse/supplier-orders/bulk-delete",
        normalizeWarehouseBulkPayload(input),
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
    },
  });
}
