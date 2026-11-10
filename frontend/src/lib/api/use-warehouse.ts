"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./apiClient";

export interface WarehouseItemDTO {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  minStock: number;
  retailPrice: number;
  costPrice: number;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
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
  category?: string;
  unit?: string;
  min_stock?: number;
  retail_price?: number;
  cost_price?: number;
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

export const warehouseKeys = {
  all: ["warehouse"] as const,
  items: (search?: string) => [...warehouseKeys.all, "items", search ?? ""] as const,
  batches: (itemId?: string) => [...warehouseKeys.all, "batches", itemId ?? ""] as const,
  movements: () => [...warehouseKeys.all, "movements"] as const,
  purchases: (status?: string, orderId?: string) =>
    [...warehouseKeys.all, "purchases", status ?? "", orderId ?? ""] as const,
};

export function useWarehouseItems(search?: string) {
  return useQuery({
    queryKey: warehouseKeys.items(search),
    queryFn: async () => {
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await apiClient.get<WarehouseItemDTO[]>(`/api/v1/warehouse/items${params}`);
      return res.data;
    },
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
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.purchases() });
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
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.purchases() });
    },
  });
}
