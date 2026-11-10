"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// DTOs — mirror backend/src/modules/repairs/repairs.types.ts.
// ---------------------------------------------------------------------------

export type RepairStatus =
  | "intake"
  | "waiting_parts"
  | "ready"
  | "issued"
  | "diagnostics"
  | "approval"
  | "in_progress"
  | "rejected";
export type RepairPriority = "low" | "normal" | "high" | "urgent";
export type RepairPaymentStatus = "unpaid" | "invoiced" | "paid";

export interface EquipmentDTO {
  type: string;
  brand: string;
  model: string;
  serialNumber: string;
  packageContents: string;
  packageContentsItems?: string[];
  appearance: string;
}

export interface DiagnosticsDTO {
  performed_at: string;
  performed_by: string;
  findings: string;
  recommended_action: string;
  condition_notes: string;
}

export interface RepairWorkDTO {
  id: string;
  description: string;
  masterId: string;
  masterName: string;
  quantity?: number;
  unitPrice?: number;
  cost: number;
  createdAt: string;
}

export interface RepairPartDTO {
  id: string;
  warehouseItemId?: string | null;
  status?: string | null;
  name: string;
  article: string;
  quantity: number;
  retailPrice: number;
  costPrice: number;
  retailTotal: number;
  costTotal: number;
  margin: number;
  createdAt: string;
}

export interface RepairNoteDTO {
  id: string;
  authorId: string;
  authorName: string;
  userId?: string;
  repairId?: string;
  repairOrderId?: string;
  dealId?: string | null;
  kind: string;
  content: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}

export interface RepairPhotoDTO {
  id: string;
  url: string;
  caption: string;
  uploadedBy: string;
  createdAt: string;
}

export interface RepairTotalsDTO {
  worksTotal: number;
  partsRetailTotal: number;
  partsCostTotal: number;
  grandTotal: number;
  margin: number;
  marginPercent: number;
}

export interface ClientLookupDealDTO {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  stageId: string;
  stageName: string;
  stageColor: string;
  pipelineId: string;
  pipelineName: string;
  createdAt: string;
  ownerName: string | null;
}

export interface ClientLookupResultDTO {
  found: boolean;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    middleName: string;
    phone: string;
    email: string | null;
    companyId: string | null;
    companyName: string | null;
  } | null;
  company: {
    id: string;
    name: string;
    inn: string;
    ogrn: string;
    bik: string;
    accountNumber: string;
    legalAddress: string;
  } | null;
  activeDeals: ClientLookupDealDTO[];
}

export interface AdditionalContact {
  name: string;
  phone: string;
  role?: string;
}

export interface DictionaryItemDTO {
  id: string;
  name: string;
  brandName?: string;
  brandId?: string;
}

export interface ServiceDictionariesDTO {
  types: DictionaryItemDTO[];
  brands: DictionaryItemDTO[];
  models: DictionaryItemDTO[];
  accessories: DictionaryItemDTO[];
  malfunctions: DictionaryItemDTO[];
}

export interface EquipmentHistoryItemDTO {
  id: string;
  ticketNumber: string;
  receivedAt: string;
  completedAt: string | null;
  deliveredAt: string | null;
  status: string;
  defectDescription: string;
  malfunctions: string[];
  estimatedCost: number;
  finalCost: number | null;
  masterName: string;
  dealId?: string | null;
  dealTitle?: string | null;
  customerName?: string;
  customerPhone?: string;
  works?: { id: string; description: string; cost: number; masterName: string }[];
}

export interface EquipmentSearchSerialResultDTO {
  found: boolean;
  equipment: {
    type: string;
    brand: string;
    model: string;
    serial: string;
    packageContents: string[];
  } | null;
  customer: {
    id: string;
    name: string;
    phone: string;
  } | null;
  historyCount: number;
  history: EquipmentHistoryItemDTO[];
}

export interface RepairOrderDTO {
  id: string;
  ticketNumber: string;
  dealId?: string | null;
  dealTitle?: string | null;
  dealNote?: string | null;
  dealBudget?: number | null;
  dealStageName?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  companyInn?: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  equipment: EquipmentDTO;
  defectDescription: string;
  malfunctions?: string[];
  defectPhotos: string[];
  additionalContacts?: AdditionalContact[];
  status: RepairStatus;
  paymentStatus: RepairPaymentStatus;
  nextStatus: RepairStatus | null;
  allowedTransitions: RepairStatus[];
  priority: RepairPriority;
  masterId: string;
  masterName: string;
  estimatedCost: number;
  finalCost: number | null;
  notes: string;
  diagnostics: DiagnosticsDTO | null;
  receivedAt: string;
  completedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepairOrderDetailDTO extends RepairOrderDTO {
  works: RepairWorkDTO[];
  parts: RepairPartDTO[];
  notes_log: RepairNoteDTO[];
  photos: RepairPhotoDTO[];
  totals: RepairTotalsDTO;
}

export interface RepairsListResult {
  items: RepairOrderDTO[];
  total: number;
  limit: number;
  offset: number;
}

export interface RepairsQueryParams {
  dealId?: string;
  status?: RepairStatus;
  paymentStatus?: RepairPaymentStatus;
  priority?: RepairPriority;
  masterId?: string;
  customerId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface EquipmentIntakeItem {
  equipment_type: string;
  equipment_brand: string;
  equipment_model: string;
  equipment_serial?: string;
  package_contents?: string;
  package_contents_items?: string[];
  appearance?: string;
  defect_description?: string;
  malfunctions?: string[];
  defect_photos?: string[];
  estimated_cost?: number;
}

export interface CreateBatchRepairPayload {
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  additional_contacts?: AdditionalContact[];
  company_id?: string;
  company_name?: string;
  company_inn?: string;
  company_ogrn?: string;
  company_bik?: string;
  company_account_number?: string;
  company_legal_address?: string;
  deal_id?: string;
  priority?: RepairPriority;
  payment_status?: RepairPaymentStatus;
  master_id?: string;
  master_name?: string;
  estimated_cost?: number;
  notes?: string;
  equipments: EquipmentIntakeItem[];
}

export interface CreateRepairPayload {
  deal_id?: string;
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  additional_contacts?: AdditionalContact[];
  company_id?: string;
  company_name?: string;
  company_inn?: string;
  company_ogrn?: string;
  company_bik?: string;
  company_account_number?: string;
  company_legal_address?: string;
  equipment_type: string;
  equipment_brand: string;
  equipment_model: string;
  equipment_serial?: string;
  package_contents?: string;
  package_contents_items?: string[];
  appearance?: string;
  defect_description?: string;
  malfunctions?: string[];
  defect_photos?: string[];
  priority?: RepairPriority;
  payment_status?: RepairPaymentStatus;
  master_id?: string;
  master_name?: string;
  estimated_cost?: number;
  notes?: string;
}

export interface RepairServiceCatalogItemDTO {
  id: string;
  name: string;
  defaultPrice: number;
  createdAt: string;
}

export interface UpdateRepairPayload {
  deal_id?: string;
  deal_title?: string;
  deal_note?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  company_id?: string;
  company_name?: string;
  company_inn?: string;
  additional_contacts?: AdditionalContact[];
  equipment_type?: string;
  equipment_brand?: string;
  equipment_model?: string;
  equipment_serial?: string;
  package_contents?: string;
  package_contents_items?: string[];
  appearance?: string;
  defect_description?: string;
  malfunctions?: string[];
  priority?: RepairPriority;
  payment_status?: RepairPaymentStatus;
  master_id?: string;
  master_name?: string;
  estimated_cost?: number;
  final_cost?: number;
  notes?: string;
}

export interface ChangeStatusPayload {
  status: RepairStatus;
  comment?: string;
  diagnostics?: {
    findings: string;
    recommended_action: string;
    condition_notes?: string;
  };
}

export interface CreateWorkPayload {
  description: string;
  master_id: string;
  master_name: string;
  quantity?: number;
  unit_price?: number;
  cost?: number;
}

export interface UpdateWorkPayload {
  description?: string;
  master_id?: string;
  master_name?: string;
  quantity?: number;
  unit_price?: number;
  cost?: number;
}

export interface CreatePartPayload {
  warehouse_item_id?: string;
  status?: string;
  name: string;
  article?: string;
  quantity?: number;
  retail_price: number;
  cost_price?: number;
}

export interface UpdatePartPayload {
  name?: string;
  article?: string;
  quantity?: number;
  retail_price?: number;
  cost_price?: number;
}

export interface CreateNotePayload {
  content: string;
}

export interface CreatePhotoPayload {
  url: string;
  caption?: string;
}

const BASE_PATH = "/api/v1/repairs";

export const DEFAULT_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const repairKeys = {
  all: ["repairs"] as const,
  list: (params: RepairsQueryParams) => ["repairs", "list", params] as const,
  detail: (id: string) => ["repairs", "detail", id] as const,
  totals: (id: string) => ["repairs", "totals", id] as const,
  works: (id: string) => ["repairs", "works", id] as const,
  parts: (id: string) => ["repairs", "parts", id] as const,
  notes: (id: string) => ["repairs", "notes", id] as const,
  photos: (id: string) => ["repairs", "photos", id] as const,
  clientLookup: (params: { phone?: string; query?: string }) => ["repairs", "client-lookup", params] as const,
  dictionaries: ["repairs", "dictionaries"] as const,
  servicesCatalog: ["repairs", "services-catalog"] as const,
  equipmentHistory: (serial: string) => ["repairs", "equipment", "history", serial] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useRepairs(params: RepairsQueryParams = {}): UseQueryResult<RepairsListResult, ApiClientError> {
  const limit = params.limit ?? DEFAULT_PAGE_SIZE;
  const offset = params.offset ?? 0;

  return useQuery<RepairsListResult, ApiClientError>({
    queryKey: repairKeys.list({ ...params, limit, offset }),
    queryFn: async () => {
      const res = await apiClient.get<RepairOrderDTO[]>(BASE_PATH, {
        query: {
          deal_id: params.dealId,
          status: params.status,
          payment_status: params.paymentStatus,
          priority: params.priority,
          master_id: params.masterId,
          customer_id: params.customerId,
          search: params.search,
          limit,
          offset,
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

export function useRepair(id: string | null): UseQueryResult<RepairOrderDetailDTO, ApiClientError> {
  return useQuery<RepairOrderDetailDTO, ApiClientError>({
    queryKey: repairKeys.detail(id ?? ""),
    queryFn: async () => {
      const res = await apiClient.get<RepairOrderDetailDTO>(`${BASE_PATH}/${id ?? ""}`);
      return res.data;
    },
    enabled: id !== null && id.length > 0,
  });
}

export function useRepairTotals(id: string | null): UseQueryResult<RepairTotalsDTO, ApiClientError> {
  return useQuery<RepairTotalsDTO, ApiClientError>({
    queryKey: repairKeys.totals(id ?? ""),
    queryFn: async () => {
      const res = await apiClient.get<RepairTotalsDTO>(`${BASE_PATH}/${id ?? ""}/totals`);
      return res.data;
    },
    enabled: id !== null && id.length > 0,
  });
}

export function useRepairWorks(id: string | null): UseQueryResult<RepairWorkDTO[], ApiClientError> {
  return useQuery<RepairWorkDTO[], ApiClientError>({
    queryKey: repairKeys.works(id ?? ""),
    queryFn: async () => {
      const res = await apiClient.get<RepairWorkDTO[]>(`${BASE_PATH}/${id ?? ""}/works`);
      return res.data;
    },
    enabled: id !== null && id.length > 0,
  });
}

export function useRepairParts(id: string | null): UseQueryResult<RepairPartDTO[], ApiClientError> {
  return useQuery<RepairPartDTO[], ApiClientError>({
    queryKey: repairKeys.parts(id ?? ""),
    queryFn: async () => {
      const res = await apiClient.get<RepairPartDTO[]>(`${BASE_PATH}/${id ?? ""}/parts`);
      return res.data;
    },
    enabled: id !== null && id.length > 0,
  });
}

export function useRepairNotes(id: string | null): UseQueryResult<RepairNoteDTO[], ApiClientError> {
  return useQuery<RepairNoteDTO[], ApiClientError>({
    queryKey: repairKeys.notes(id ?? ""),
    queryFn: async () => {
      const res = await apiClient.get<RepairNoteDTO[]>(`${BASE_PATH}/${id ?? ""}/notes`);
      return res.data;
    },
    enabled: id !== null && id.length > 0,
  });
}

export function useRepairPhotos(id: string | null): UseQueryResult<RepairPhotoDTO[], ApiClientError> {
  return useQuery<RepairPhotoDTO[], ApiClientError>({
    queryKey: repairKeys.photos(id ?? ""),
    queryFn: async () => {
      const res = await apiClient.get<RepairPhotoDTO[]>(`${BASE_PATH}/${id ?? ""}/photos`);
      return res.data;
    },
    enabled: id !== null && id.length > 0,
  });
}

export function useRepairClientLookup(params: {
  phone?: string;
  query?: string;
  enabled?: boolean;
}): UseQueryResult<ClientLookupResultDTO, ApiClientError> {
  const phone = params.phone?.trim() ?? "";
  const query = params.query?.trim() ?? "";
  const isEnabled = (params.enabled ?? true) && (phone.replace(/\D/g, "").length >= 6 || query.length >= 2);

  return useQuery<ClientLookupResultDTO, ApiClientError>({
    queryKey: repairKeys.clientLookup({ phone, query }),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (phone) searchParams.set("phone", phone);
      if (query) searchParams.set("query", query);
      const res = await apiClient.get<ClientLookupResultDTO>(`${BASE_PATH}/client-lookup?${searchParams.toString()}`);
      return res.data;
    },
    enabled: isEnabled,
    staleTime: 30_000,
  });
}

export const dictionaryKeys = {
  all: ["dictionaries"] as const,
  brands: () => ["dictionaries", "brands"] as const,
  brandModels: (brandId?: string) => ["dictionaries", "brands", brandId, "models"] as const,
};

export function useRepairDictionaries(): UseQueryResult<ServiceDictionariesDTO, ApiClientError> {
  return useQuery<ServiceDictionariesDTO, ApiClientError>({
    queryKey: repairKeys.dictionaries,
    queryFn: async () => {
      const res = await apiClient.get<ServiceDictionariesDTO>(`${BASE_PATH}/dictionaries`);
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useBrands(): UseQueryResult<DictionaryItemDTO[], ApiClientError> {
  return useQuery<DictionaryItemDTO[], ApiClientError>({
    queryKey: dictionaryKeys.brands(),
    queryFn: async () => {
      const res = await apiClient.get<DictionaryItemDTO[]>("/api/v1/dictionaries/brands");
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useBrandModels(brandId?: string): UseQueryResult<DictionaryItemDTO[], ApiClientError> {
  const isEnabled = Boolean(brandId && brandId.trim().length > 0);
  return useQuery<DictionaryItemDTO[], ApiClientError>({
    queryKey: dictionaryKeys.brandModels(brandId),
    queryFn: async () => {
      if (!brandId) return [];
      const res = await apiClient.get<DictionaryItemDTO[]>(`/api/v1/dictionaries/brands/${brandId}/models`);
      return res.data;
    },
    enabled: isEnabled,
    staleTime: 60_000,
  });
}

export function useCreateBrand(): UseMutationResult<
  DictionaryItemDTO,
  ApiClientError,
  { name: string }
> {
  const queryClient = useQueryClient();
  return useMutation<DictionaryItemDTO, ApiClientError, { name: string }>({
    mutationFn: async ({ name }) => {
      const res = await apiClient.post<DictionaryItemDTO>("/api/v1/dictionaries/brands", { name });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dictionaryKeys.brands() });
      void queryClient.invalidateQueries({ queryKey: repairKeys.dictionaries });
    },
  });
}

export function useCreateBrandModel(): UseMutationResult<
  DictionaryItemDTO,
  ApiClientError,
  { brandId: string; name: string }
> {
  const queryClient = useQueryClient();
  return useMutation<DictionaryItemDTO, ApiClientError, { brandId: string; name: string }>({
    mutationFn: async ({ brandId, name }) => {
      const res = await apiClient.post<DictionaryItemDTO>(`/api/v1/dictionaries/brands/${brandId}/models`, { name });
      return res.data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: dictionaryKeys.brandModels(variables.brandId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.dictionaries });
    },
  });
}

export function useRepairServicesCatalog(): UseQueryResult<RepairServiceCatalogItemDTO[], ApiClientError> {
  return useQuery<RepairServiceCatalogItemDTO[], ApiClientError>({
    queryKey: repairKeys.servicesCatalog,
    queryFn: async () => {
      const res = await apiClient.get<RepairServiceCatalogItemDTO[]>(`${BASE_PATH}/catalog/services`);
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useAddRepairServiceToCatalog(): UseMutationResult<
  RepairServiceCatalogItemDTO,
  ApiClientError,
  { name: string; default_price?: number }
> {
  const queryClient = useQueryClient();

  return useMutation<RepairServiceCatalogItemDTO, ApiClientError, { name: string; default_price?: number }>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<RepairServiceCatalogItemDTO>(`${BASE_PATH}/catalog/services`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.servicesCatalog });
    },
  });
}

export function useDeleteRepairServiceFromCatalog(): UseMutationResult<
  { success: boolean },
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, ApiClientError, string>({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<{ success: boolean }>(`${BASE_PATH}/catalog/services/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.servicesCatalog });
    },
  });
}

export function useSearchEquipmentBySerial(serial: string): UseQueryResult<EquipmentSearchSerialResultDTO, ApiClientError> {
  const trimmed = serial.trim();
  const isEnabled = trimmed.length >= 3;

  return useQuery<EquipmentSearchSerialResultDTO, ApiClientError>({
    queryKey: repairKeys.equipmentHistory(trimmed),
    queryFn: async () => {
      const res = await apiClient.get<EquipmentSearchSerialResultDTO>(
        `${BASE_PATH}/equipment/search-serial?serial=${encodeURIComponent(trimmed)}`,
      );
      return res.data;
    },
    enabled: isEnabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateRepair(): UseMutationResult<RepairOrderDTO, ApiClientError, CreateRepairPayload> {
  const queryClient = useQueryClient();

  return useMutation<RepairOrderDTO, ApiClientError, CreateRepairPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<RepairOrderDTO>(BASE_PATH, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
      void queryClient.invalidateQueries({ queryKey: ["companies"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useCreateBatchRepair(): UseMutationResult<RepairOrderDTO[], ApiClientError, CreateBatchRepairPayload> {
  const queryClient = useQueryClient();

  return useMutation<RepairOrderDTO[], ApiClientError, CreateBatchRepairPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<RepairOrderDTO[]>(`${BASE_PATH}/batch`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
      void queryClient.invalidateQueries({ queryKey: ["companies"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useAddRepairDictionaryItem(): UseMutationResult<
  { id: string; name: string; brandId?: string; brandName?: string },
  ApiClientError,
  { category: string; name: string; brand_name?: string; brand_id?: string }
> {
  const queryClient = useQueryClient();

  return useMutation<
    { id: string; name: string; brandId?: string; brandName?: string },
    ApiClientError,
    { category: string; name: string; brand_name?: string; brand_id?: string }
  >({
    mutationFn: async ({ category, name, brand_name, brand_id }) => {
      const res = await apiClient.post<{ id: string; name: string; brandId?: string; brandName?: string }>(
        `${BASE_PATH}/dictionaries/${category}`,
        {
          name,
          brand_name,
          brand_id,
        },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.dictionaries });
      void queryClient.invalidateQueries({ queryKey: dictionaryKeys.all });
    },
  });
}

export function useRenameRepairDictionaryItem(): UseMutationResult<
  { id: string; name: string },
  ApiClientError,
  { category: string; id: string; name: string }
> {
  const queryClient = useQueryClient();

  return useMutation<{ id: string; name: string }, ApiClientError, { category: string; id: string; name: string }>({
    mutationFn: async ({ category, id, name }) => {
      const res = await apiClient.patch<{ id: string; name: string }>(`${BASE_PATH}/dictionaries/${category}/${id}`, {
        name,
      });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.dictionaries });
      void queryClient.invalidateQueries({ queryKey: dictionaryKeys.all });
    },
  });
}

export function useDeleteRepairDictionaryItem(): UseMutationResult<
  { success: boolean; id: string },
  ApiClientError,
  { category: string; id: string }
> {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; id: string }, ApiClientError, { category: string; id: string }>({
    mutationFn: async ({ category, id }) => {
      const res = await apiClient.delete<{ success: boolean; id: string }>(`${BASE_PATH}/dictionaries/${category}/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.dictionaries });
      void queryClient.invalidateQueries({ queryKey: dictionaryKeys.all });
    },
  });
}

export function useUpdateRepair(): UseMutationResult<RepairOrderDTO, ApiClientError, { id: string; payload: UpdateRepairPayload }> {
  const queryClient = useQueryClient();

  return useMutation<RepairOrderDTO, ApiClientError, { id: string; payload: UpdateRepairPayload }>({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.patch<RepairOrderDTO>(`${BASE_PATH}/${id}`, payload);
      return res.data;
    },
    onSuccess: (order) => {
      queryClient.setQueryData(repairKeys.detail(order.id), (old: RepairOrderDetailDTO | undefined) => {
        if (!old) return old;
        return { ...old, ...order };
      });
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useDeleteRepair(): UseMutationResult<void, ApiClientError, string> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiClientError, string>({
    mutationFn: async (id) => {
      await apiClient.delete(`${BASE_PATH}/${id}`);
    },
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: repairKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useChangeRepairStatus(): UseMutationResult<RepairOrderDTO, ApiClientError, { id: string; payload: ChangeStatusPayload }> {
  const queryClient = useQueryClient();

  return useMutation<RepairOrderDTO, ApiClientError, { id: string; payload: ChangeStatusPayload }>({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.patch<RepairOrderDTO>(`${BASE_PATH}/${id}/status`, payload);
      return res.data;
    },
    onSuccess: (order) => {
      queryClient.setQueryData(repairKeys.detail(order.id), (old: RepairOrderDetailDTO | undefined) => {
        if (!old) return old;
        return { ...old, ...order };
      });
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useUpdateRepairPaymentStatus(): UseMutationResult<
  RepairOrderDTO,
  ApiClientError,
  { id: string; paymentStatus: RepairPaymentStatus }
> {
  const queryClient = useQueryClient();

  return useMutation<RepairOrderDTO, ApiClientError, { id: string; paymentStatus: RepairPaymentStatus }>({
    mutationFn: async ({ id, paymentStatus }) => {
      const res = await apiClient.patch<RepairOrderDTO>(`${BASE_PATH}/${id}/payment-status`, {
        payment_status: paymentStatus,
      });
      return res.data;
    },
    onSuccess: (order) => {
      queryClient.setQueryData(repairKeys.detail(order.id), (old: RepairOrderDetailDTO | undefined) => {
        if (!old) return old;
        return { ...old, ...order };
      });
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useCreateWork(): UseMutationResult<RepairWorkDTO, ApiClientError, { orderId: string; payload: CreateWorkPayload }> {
  const queryClient = useQueryClient();

  return useMutation<RepairWorkDTO, ApiClientError, { orderId: string; payload: CreateWorkPayload }>({
    mutationFn: async ({ orderId, payload }) => {
      const res = await apiClient.post<RepairWorkDTO>(`${BASE_PATH}/${orderId}/works`, payload);
      return res.data;
    },
    onSuccess: (work, variables) => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.works(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.detail(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.totals(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useUpdateWork(): UseMutationResult<RepairWorkDTO, ApiClientError, { orderId: string; workId: string; payload: UpdateWorkPayload }> {
  const queryClient = useQueryClient();

  return useMutation<RepairWorkDTO, ApiClientError, { orderId: string; workId: string; payload: UpdateWorkPayload }>({
    mutationFn: async ({ orderId, workId, payload }) => {
      const res = await apiClient.patch<RepairWorkDTO>(`${BASE_PATH}/${orderId}/works/${workId}`, payload);
      return res.data;
    },
    onSuccess: (work, variables) => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.works(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.detail(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.totals(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useDeleteWork(): UseMutationResult<{ id: string; deleted: boolean }, ApiClientError, { orderId: string; workId: string }> {
  const queryClient = useQueryClient();

  return useMutation<{ id: string; deleted: boolean }, ApiClientError, { orderId: string; workId: string }>({
    mutationFn: async ({ orderId, workId }) => {
      const res = await apiClient.delete<{ id: string; deleted: boolean }>(`${BASE_PATH}/${orderId}/works/${workId}`);
      return res.data ?? { id: workId, deleted: true };
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.works(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.detail(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.totals(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useCreatePart(): UseMutationResult<RepairPartDTO, ApiClientError, { orderId: string; payload: CreatePartPayload }> {
  const queryClient = useQueryClient();

  return useMutation<RepairPartDTO, ApiClientError, { orderId: string; payload: CreatePartPayload }>({
    mutationFn: async ({ orderId, payload }) => {
      const res = await apiClient.post<RepairPartDTO>(`${BASE_PATH}/${orderId}/parts`, payload);
      return res.data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.parts(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.detail(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.totals(variables.orderId) });
    },
  });
}

export function useUpdatePart(): UseMutationResult<RepairPartDTO, ApiClientError, { orderId: string; partId: string; payload: UpdatePartPayload }> {
  const queryClient = useQueryClient();

  return useMutation<RepairPartDTO, ApiClientError, { orderId: string; partId: string; payload: UpdatePartPayload }>({
    mutationFn: async ({ orderId, partId, payload }) => {
      const res = await apiClient.patch<RepairPartDTO>(`${BASE_PATH}/${orderId}/parts/${partId}`, payload);
      return res.data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.parts(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.detail(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.totals(variables.orderId) });
    },
  });
}

export function useDeletePart(): UseMutationResult<{ id: string; deleted: boolean }, ApiClientError, { orderId: string; partId: string }> {
  const queryClient = useQueryClient();

  return useMutation<{ id: string; deleted: boolean }, ApiClientError, { orderId: string; partId: string }>({
    mutationFn: async ({ orderId, partId }) => {
      const res = await apiClient.delete<{ id: string; deleted: boolean }>(`${BASE_PATH}/${orderId}/parts/${partId}`);
      return res.data ?? { id: partId, deleted: true };
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.parts(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.detail(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.totals(variables.orderId) });
    },
  });
}

export function useCreateNote(): UseMutationResult<RepairNoteDTO, ApiClientError, { orderId: string; payload: CreateNotePayload }> {
  const queryClient = useQueryClient();

  return useMutation<RepairNoteDTO, ApiClientError, { orderId: string; payload: CreateNotePayload }>({
    mutationFn: async ({ orderId, payload }) => {
      const res = await apiClient.post<RepairNoteDTO>(`${BASE_PATH}/${orderId}/notes`, payload);
      return res.data;
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.notes(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.detail(variables.orderId) });
      if (data?.dealId) {
        void queryClient.invalidateQueries({ queryKey: ["notes", "list", "deal", data.dealId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}

export const useCreateRepairNote = useCreateNote;

export function useCreatePhoto(): UseMutationResult<RepairPhotoDTO, ApiClientError, { orderId: string; payload: CreatePhotoPayload }> {
  const queryClient = useQueryClient();

  return useMutation<RepairPhotoDTO, ApiClientError, { orderId: string; payload: CreatePhotoPayload }>({
    mutationFn: async ({ orderId, payload }) => {
      const res = await apiClient.post<RepairPhotoDTO>(`${BASE_PATH}/${orderId}/photos`, payload);
      return res.data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.photos(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: repairKeys.detail(variables.orderId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Batch Operations
// ---------------------------------------------------------------------------

export interface BatchUpdateStatusResult {
  updated: number;
  ids: string[];
  errors: { id: string; error: string }[];
}

export function useBatchUpdateRepairStatus(): UseMutationResult<
  BatchUpdateStatusResult,
  ApiClientError,
  { ids: string[]; status: RepairStatus; comment?: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<BatchUpdateStatusResult>(`${BASE_PATH}/batch-status`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
    },
  });
}

export function useBatchUpdateRepairPaymentStatus(): UseMutationResult<
  { updated: number; ids: string[] },
  ApiClientError,
  { ids: string[]; paymentStatus: RepairPaymentStatus }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, paymentStatus }) => {
      const res = await apiClient.post<{ updated: number; ids: string[] }>(`${BASE_PATH}/batch-payment-status`, {
        ids,
        payment_status: paymentStatus,
      });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
    },
  });
}

export function useBatchDeleteRepairs(): UseMutationResult<
  { count: number; ids: string[] },
  ApiClientError,
  { ids: string[] }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<{ count: number; ids: string[] }>(`${BASE_PATH}/batch-delete`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repairKeys.all });
    },
  });
}

export { useCompanyInnLookup, type CompanyInnLookupResult } from "./use-companies";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function repairFullName(ticket: RepairOrderDTO): string {
  return `${ticket.customerName} (${ticket.customerPhone})`;
}
