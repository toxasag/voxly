"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";

export type DealMessageSource = "human" | "manager" | "client" | "ai" | "ai_bot" | "system";
export type DealMessageDirection = "inbound" | "outbound" | "neutral";

/** Ключи пресета цвета стадии; маппятся в статические классы на фронте. */
export type StageColorKey = "amber" | "emerald" | "sky" | "rose" | "violet" | "orange" | "cyan" | "slate";

export interface DealDTO {
  id: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  companyId: string | null;
  title: string;
  description: string;
  budget: number;
  currency: string;
  sourceMetadata?: Record<string, unknown> | null;
  customFields: Record<string, unknown>;
  createdBy: string;
  ownerId: string | null;
  closeDate: string | null;
  position: number;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  companyName: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  companyCity?: string | null;
  contactName: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactJobTitle?: string | null;
  contactIsPersonal?: boolean;
  ownerName: string | null;
  latestNote?: string | null;
  tasksCount?: number;
  pendingTasksCount?: number;
  nextTaskTitle?: string | null;
  nextTaskDueDate?: string | null;
}
export interface PipelineDTO { id: string; name: string; sortOrder: number; }
export interface KanbanColumnDTO { stageId: string; stageName: string; sortOrder: number; isWon: boolean; isLost: boolean; /** Системный этап: вход в воронку, «успех» или «провал» — не правится и не двигается. */ isSystem: boolean; stageColor: StageColorKey; dealCount: number; budgetTotal: number; deals: DealDTO[]; }
/**
 * Доставка исходящего в канал. `neutral` — доставлять некуда (входящее,
 * системная запись), `failed` держит причину в `deliveryError`.
 */
export type DealMessageDeliveryStatus = "neutral" | "pending" | "sent" | "failed" | "received";
export interface DealMessageDTO { id: string; dealId: string; channelAccountId: string | null; source: DealMessageSource; direction: DealMessageDirection; senderName: string; content: string; channel: string; attachment: string | null; attachmentType: string | null; metadata?: Record<string, unknown> | null; deliveryStatus: DealMessageDeliveryStatus; deliveryError: string | null; createdAt: string; }
/** contactId / companyId — секции «Сделки» на карточках контакта и компании. */
export interface DealsParams { pipelineId?: string; stageId?: string; status?: "active" | "won" | "lost" | "all"; search?: string; contactId?: string; companyId?: string; limit?: number; offset?: number; }
export interface DealsResult { items: DealDTO[]; total: number; limit: number; offset: number; }
export interface SendDealMessagePayload { content: string; channel: string; source?: DealMessageSource; direction?: DealMessageDirection; attachment?: string; attachment_type?: string; }
export interface CreateDealPayload { title: string; description?: string; budget: number; currency?: string; pipeline_id: string; stage_id: string; contact_id?: string; company_id?: string; owner_id?: string; close_date?: string; custom_fields?: Record<string, unknown>; }
export interface UpdateDealPayload { title?: string; description?: string; budget?: number; currency?: string; stage_id?: string; contact_id?: string; company_id?: string; owner_id?: string; close_date?: string; position?: number; custom_fields?: Record<string, unknown>; }

const BASE = "/api/v1/crm/deals";
export const dealKeys = { all: ["deals"] as const, list: (p: DealsParams) => ["deals", "list", p] as const, detail: (id: string) => ["deals", "detail", id] as const, pipelines: ["deals", "pipelines"] as const, kanban: (id: string) => ["deals", "kanban", id] as const, timeline: (id: string) => ["deals", "timeline", id] as const };

export function usePipelines(): UseQueryResult<PipelineDTO[], ApiClientError> {
  return useQuery({ queryKey: dealKeys.pipelines, queryFn: async () => (await apiClient.get<PipelineDTO[]>(`${BASE}/pipelines`)).data });
}

export function useDeals(params: DealsParams = {}): UseQueryResult<DealsResult, ApiClientError> {
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;
  return useQuery({
    queryKey: dealKeys.list({ ...params, limit, offset }),
    queryFn: async () => {
      const response = await apiClient.get<DealDTO[]>(BASE, { query: { pipeline_id: params.pipelineId, stage_id: params.stageId, status: params.status, search: params.search, contact_id: params.contactId, company_id: params.companyId, limit, offset } });
      const meta: ApiMeta = response.meta ?? {};
      return { items: response.data, total: typeof meta.total === "number" ? meta.total : response.data.length, limit: typeof meta.limit === "number" ? meta.limit : limit, offset: typeof meta.offset === "number" ? meta.offset : offset };
    },
    placeholderData: (previous) => previous,
  });
}

export function useKanban(pipelineId: string | null): UseQueryResult<KanbanColumnDTO[], ApiClientError> {
  return useQuery({ queryKey: dealKeys.kanban(pipelineId ?? ""), queryFn: async () => (await apiClient.get<KanbanColumnDTO[]>(`${BASE}/kanban`, { query: { pipeline_id: pipelineId } })).data, enabled: pipelineId !== null && pipelineId.length > 0 });
}

export function useDeal(id: string | null): UseQueryResult<DealDTO, ApiClientError> {
  return useQuery({ queryKey: dealKeys.detail(id ?? ""), queryFn: async () => (await apiClient.get<DealDTO>(`${BASE}/${id ?? ""}`)).data, enabled: id !== null && id.length > 0 });
}

interface MoveContext { previous: KanbanColumnDTO[] | undefined; }

export function useMoveDealStage(): UseMutationResult<DealDTO, ApiClientError, { id: string; stageId: string; pipelineId: string; targetIndex?: number }, MoveContext> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stageId, targetIndex }) => (await apiClient.patch<DealDTO>(`${BASE}/${id}/stage`, { stage_id: stageId, target_index: targetIndex })).data,
    onMutate: async (variables) => {
      const key = dealKeys.kanban(variables.pipelineId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<KanbanColumnDTO[]>(key);
      queryClient.setQueryData<KanbanColumnDTO[]>(key, (columns) => {
        if (columns === undefined) return columns;
        const moved = columns.flatMap((column) => column.deals.map((deal) => deal.id === variables.id ? { ...deal, stageId: variables.stageId } : deal));
        return columns.map((column) => {
          const deals = moved.filter((deal) => deal.stageId === column.stageId);
          return { ...column, deals, dealCount: deals.length, budgetTotal: deals.reduce((sum, deal) => sum + deal.budget, 0) };
        });
      });
      return { previous };
    },
    onError: (_error, variables, context) => { if (context?.previous !== undefined) queryClient.setQueryData(dealKeys.kanban(variables.pipelineId), context.previous); },
    onSuccess: (deal) => { queryClient.setQueryData(dealKeys.detail(deal.id), deal); },
    onSettled: (_data, _error, variables) => { void queryClient.invalidateQueries({ queryKey: dealKeys.kanban(variables.pipelineId) }); },
  });
}

/**
 * Интервал опроса таймлайна при открытом чате.
 *
 * 5 секунд — компромисс: ответ клиента появляется почти сразу, а нагрузка
 * остаётся на одной открытой сделке, а не на всех. Постоянного канала (SSE,
 * вебсокет) на бэкенде пока нет.
 */
const TIMELINE_POLL_MS = 5000;

/**
 * Хронология сделки.
 *
 * `live` включает опрос и передаётся только открытой вкладкой чата: без него
 * входящее сообщение появлялось лишь после F5 — инвалидация была только после
 * своей отправки. Опрашивать все сделки подряд незачем, поэтому решение о
 * «живом» режиме принимает вкладка, а не хук.
 *
 * `refetchIntervalInBackground` не включаем (по умолчанию `false`): в неактивной
 * вкладке браузера опрос останавливается сам, и возвращение к вкладке даёт
 * свежие данные через `refetchOnWindowFocus`.
 */
export function useDealTimeline(id: string | null, live = false): UseQueryResult<DealMessageDTO[], ApiClientError> {
  const enabled = id !== null && id.length > 0;

  return useQuery({
    queryKey: dealKeys.timeline(id ?? ""),
    queryFn: async () => (await apiClient.get<DealMessageDTO[]>(`${BASE}/${id ?? ""}/messages`)).data,
    enabled,
    refetchInterval: live && enabled ? TIMELINE_POLL_MS : false,
  });
}

export function useSendDealMessage(): UseMutationResult<DealMessageDTO, ApiClientError, { dealId: string; payload: SendDealMessagePayload }> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: async ({ dealId, payload }) => (await apiClient.post<DealMessageDTO>(`${BASE}/${dealId}/messages`, payload)).data, onSuccess: (message) => { void queryClient.invalidateQueries({ queryKey: dealKeys.timeline(message.dealId) }); } });
}

export function useCreateDeal(): UseMutationResult<DealDTO, ApiClientError, CreateDealPayload> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await apiClient.post<DealDTO>(BASE, payload)).data,
    onSuccess: () => {
      // A new deal lands on the Kanban board and in list views; invalidate the
      // whole family so every cached pipeline/list picks it up.
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}

// -----------------------------------------------------------------------------
// Stages — визуальный редактор воронки (кнопка «Настроить» на канбане).
// -----------------------------------------------------------------------------

export interface CreateStagePayload { name: string; color?: StageColorKey; }
export interface UpdateStagePayload { name?: string; color?: StageColorKey; sort_order?: number; }

function invalidateBoard(qc: ReturnType<typeof useQueryClient>, pipelineId: string): void {
  void qc.invalidateQueries({ queryKey: dealKeys.kanban(pipelineId) });
}

export function useCreateStage(pipelineId: string): UseMutationResult<KanbanColumnDTO, ApiClientError, CreateStagePayload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await apiClient.post<KanbanColumnDTO>(`${BASE}/pipelines/${pipelineId}/stages`, payload)).data,
    onSuccess: () => invalidateBoard(qc, pipelineId),
  });
}

export function useUpdateStage(pipelineId: string): UseMutationResult<KanbanColumnDTO, ApiClientError, { stageId: string } & UpdateStagePayload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ stageId, ...patch }) => (await apiClient.patch<KanbanColumnDTO>(`${BASE}/pipelines/${pipelineId}/stages/${stageId}`, patch)).data,
    onSuccess: () => invalidateBoard(qc, pipelineId),
  });
}

export function useDeleteStage(pipelineId: string): UseMutationResult<null, ApiClientError, { stageId: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ stageId }) => { await apiClient.delete<null>(`${BASE}/pipelines/${pipelineId}/stages/${stageId}`); return null; },
    onSuccess: () => invalidateBoard(qc, pipelineId),
  });
}

/**
 * Правка сделки из таблицы.
 *
 * Обновляет кэш точечно (`setQueryData` по канбану и деталям) до инвалидации:
 * при inline-редактировании значение должно остаться на экране сразу, иначе
 * ячейка на миг возвращает старое, пока идёт refetch.
 */
export function useUpdateDeal(): UseMutationResult<DealDTO, ApiClientError, { id: string; pipelineId: string; payload: UpdateDealPayload }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }) => (await apiClient.patch<DealDTO>(`${BASE}/${id}`, payload)).data,
    onSuccess: (deal, variables) => {
      queryClient.setQueryData(dealKeys.detail(deal.id), deal);
      queryClient.setQueryData<KanbanColumnDTO[]>(dealKeys.kanban(variables.pipelineId), (columns) => {
        if (columns === undefined) return columns;
        return columns.map((column) => {
          const deals = column.deals.map((entry) => (entry.id === deal.id ? deal : entry));
          const stillHere = deal.stageId === column.stageId;
          const filtered = stillHere ? deals : deals.filter((entry) => entry.id !== deal.id);
          const withMoved = stillHere && !column.deals.some((entry) => entry.id === deal.id)
            ? [deal, ...filtered]
            : filtered;
          return {
            ...column,
            deals: withMoved,
            dealCount: withMoved.length,
            budgetTotal: withMoved.reduce((sum, entry) => sum + entry.budget, 0),
          };
        });
      });
      void queryClient.invalidateQueries({ queryKey: dealKeys.kanban(variables.pipelineId) });
    },
  });
}

export function useDeleteDeal(): UseMutationResult<null, ApiClientError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => { await apiClient.delete<null>(`${BASE}/${id}`); return null; },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: dealKeys.all }); },
  });
}

export function useMarkDealPersonal(): UseMutationResult<
  { dealId: string; contactId: string | null; stageId: string },
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dealId) =>
      (await apiClient.post<{ dealId: string; contactId: string | null; stageId: string }>(
        `${BASE}/${dealId}/mark-personal`,
        {},
      )).data,
    onSuccess: (_, dealId) => {
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["crm-chat", "deal", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["crm-chat", "deal", dealId, "messages"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useUnmarkDealPersonal(): UseMutationResult<
  { dealId: string; contactId: string | null },
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dealId) =>
      (await apiClient.post<{ dealId: string; contactId: string | null }>(
        `${BASE}/${dealId}/unmark-personal`,
        {},
      )).data,
    onSuccess: (_, dealId) => {
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["crm-chat", "deal", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["crm-chat", "deal", dealId, "messages"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Deal Items (Услуги/Товары в сделке)
// ---------------------------------------------------------------------------

export interface DealItemDTO {
  id: string;
  dealId: string;
  itemType: "product" | "service";
  itemId: string | null;
  name: string;
  description: string;
  sku: string;
  price: number;
  quantity: number;
  unit: string;
  discountPercent: number;
  discountAmount: number;
  totalAmount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateDealItemPayload {
  item_type: "product" | "service";
  item_id?: string | null;
  name: string;
  description?: string;
  sku?: string;
  price?: number;
  quantity?: number;
  unit?: string;
  discount_percent?: number;
  discount_amount?: number;
  sort_order?: number;
}

export interface UpdateDealItemPayload {
  name?: string;
  description?: string;
  sku?: string;
  price?: number;
  quantity?: number;
  unit?: string;
  discount_percent?: number;
  discount_amount?: number;
  sort_order?: number;
}

export function useDealItems(dealId: string | null | undefined) {
  return useQuery({
    queryKey: [...dealKeys.detail(dealId ?? ""), "items"],
    queryFn: async () => {
      if (!dealId) return { data: [], totalBudget: 0 };
      const res = await apiClient.get<DealItemDTO[]>(
        `${BASE}/${dealId}/items`,
      );
      return {
        data: res.data ?? [],
        totalBudget: (res as unknown as { totalBudget: number }).totalBudget ?? 0,
      };
    },
    enabled: Boolean(dealId),
  });
}

export function useAddDealItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateDealItemPayload) => {
      const res = await apiClient.post<DealItemDTO>(`${BASE}/${dealId}/items`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...dealKeys.detail(dealId), "items"] });
      void queryClient.invalidateQueries({ queryKey: dealKeys.detail(dealId) });
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}

export function useUpdateDealItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, payload }: { itemId: string; payload: UpdateDealItemPayload }) => {
      const res = await apiClient.patch<DealItemDTO>(`${BASE}/${dealId}/items/${itemId}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...dealKeys.detail(dealId), "items"] });
      void queryClient.invalidateQueries({ queryKey: dealKeys.detail(dealId) });
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}

export function useDeleteDealItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiClient.delete<{ success: boolean; totalBudget: number }>(
        `${BASE}/${dealId}/items/${itemId}`,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...dealKeys.detail(dealId), "items"] });
      void queryClient.invalidateQueries({ queryKey: dealKeys.detail(dealId) });
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}
