"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// Задачи. Образец — объект Task в Twenty: заголовок, описание, срок,
// исполнитель, статус и привязка к записи через junction TaskTarget. У нас связь
// выражена тремя nullable FK (deal_id / contact_id / company_id), поэтому наружу
// она отдаётся парой linkedEntityType + linkedEntityId.
// ---------------------------------------------------------------------------

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "done";
export type LinkedEntityType = "deal" | "contact" | "company";

export interface TaskDTO {
  id: string;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  linkedEntityType: LinkedEntityType | null;
  linkedEntityId: string | null;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  assigneeId: string;
  completedAt: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TasksParams {
  filter?: "today" | "overdue" | "upcoming" | "my" | "unassigned";
  /** Поиск по заголовку и описанию — палитра ⌘K запрашивает только реальные данные. */
  search?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  /** Задачи одной записи — вкладка «Задачи» на карточке контакта/компании/сделки. */
  linkedEntityType?: LinkedEntityType;
  linkedEntityId?: string;
  limit?: number;
  offset?: number;
}

export interface TasksResult {
  items: TaskDTO[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: string;
  assignee_id: string;
  linked_entity_type?: LinkedEntityType | "";
  linked_entity_id?: string;
  deal_id?: string | null;
  contact_id?: string | null;
  company_id?: string | null;
  notify_telegram?: boolean;
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: string;
  assignee_id?: string;
  /**
   * Связь передаётся парой, как её принимает бэкенд.
   *
   * Полей не было вовсе, и смена связи при правке молча терялась: форма
   * показывала новое значение, приходил тост «Задача обновлена», а связь
   * оставалась прежней. Пустой тип вместе с пустым идентификатором снимает связь.
   */
  linked_entity_type?: LinkedEntityType | "";
  linked_entity_id?: string;
  deal_id?: string | null;
  contact_id?: string | null;
  company_id?: string | null;
  notify_telegram?: boolean;
}

const BASE = "/api/v1/crm/tasks";

export const taskKeys = {
  all: ["tasks"] as const,
  list: (params: TasksParams) => ["tasks", "list", params] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
};

export function useTask(id: string | null): UseQueryResult<TaskDTO, ApiClientError> {
  return useQuery<TaskDTO, ApiClientError>({
    queryKey: taskKeys.detail(id ?? ""),
    queryFn: async () => (await apiClient.get<TaskDTO>(`${BASE}/${id ?? ""}`)).data,
    enabled: id !== null && id.length > 0,
  });
}

export function useTasks(params: TasksParams = {}): UseQueryResult<TasksResult, ApiClientError> {
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  return useQuery<TasksResult, ApiClientError>({
    queryKey: taskKeys.list({ ...params, limit, offset }),
    queryFn: async () => {
      const response = await apiClient.get<TaskDTO[]>(BASE, {
        query: {
          filter: params.filter,
          search: params.search,
          priority: params.priority,
          status: params.status,
          // Бэкенд требует пару: тип без идентификатора отклоняется схемой.
          linked_entity_type: params.linkedEntityId === undefined ? undefined : params.linkedEntityType,
          linked_entity_id: params.linkedEntityType === undefined ? undefined : params.linkedEntityId,
          limit,
          offset,
        },
      });
      const meta: ApiMeta = response.meta ?? {};

      return {
        items: response.data,
        total: typeof meta.total === "number" ? meta.total : response.data.length,
        limit: typeof meta.limit === "number" ? meta.limit : limit,
        offset: typeof meta.offset === "number" ? meta.offset : offset,
      };
    },
    enabled: params.linkedEntityType === undefined || (params.linkedEntityId ?? "").length > 0,
    placeholderData: (previous) => previous,
  });
}

interface ToggleContext {
  previous: Array<[readonly unknown[], TasksResult | undefined]>;
}

/**
 * Переключение статуса чекбоксом.
 *
 * Оптимистично правит все кэшированные списки: чекбокс должен отзываться сразу,
 * а задача видна одновременно на странице задач и во вкладке карточки.
 */
export function useToggleTaskStatus(): UseMutationResult<
  TaskDTO,
  ApiClientError,
  { id: string; status: TaskStatus },
  ToggleContext
> {
  const queryClient = useQueryClient();

  return useMutation<TaskDTO, ApiClientError, { id: string; status: TaskStatus }, ToggleContext>({
    mutationFn: async ({ id, status }) =>
      (await apiClient.patch<TaskDTO>(`${BASE}/${id}/status`, { status })).data,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });
      const previous = queryClient.getQueriesData<TasksResult>({ queryKey: taskKeys.all });

      queryClient.setQueriesData<TasksResult>({ queryKey: taskKeys.all }, (old) =>
        old === undefined
          ? old
          : {
              ...old,
              items: old.items.map((task) =>
                task.id === variables.id
                  ? {
                      ...task,
                      status: variables.status,
                      completedAt: variables.status === "done" ? new Date().toISOString() : null,
                      isOverdue: variables.status === "done" ? false : task.isOverdue,
                    }
                  : task,
              ),
            },
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useCreateTask(): UseMutationResult<TaskDTO, ApiClientError, CreateTaskPayload> {
  const queryClient = useQueryClient();

  return useMutation<TaskDTO, ApiClientError, CreateTaskPayload>({
    mutationFn: async (payload) => (await apiClient.post<TaskDTO>(BASE, payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useUpdateTask(): UseMutationResult<
  TaskDTO,
  ApiClientError,
  { id: string; payload: UpdateTaskPayload }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }) =>
      (await apiClient.patch<TaskDTO>(`${BASE}/${id}`, payload)).data,
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useDeleteTask(): UseMutationResult<null, ApiClientError, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id) => {
      await apiClient.delete<null>(`${BASE}/${id}`);
      return null;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useDueTasks(hoursAhead = 24): UseQueryResult<TaskDTO[], ApiClientError> {
  return useQuery<TaskDTO[], ApiClientError>({
    queryKey: ["tasks", "due", hoursAhead],
    queryFn: async () => {
      const response = await apiClient.get<TaskDTO[]>(`${BASE}/reminders/due`, {
        query: { hours_ahead: hoursAhead },
      });
      return response.data;
    },
  });
}

export function useCheckTaskReminders(): UseMutationResult<
  { checked: number; sent: number },
  ApiClientError,
  { hoursAhead?: number } | void
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      const response = await apiClient.post<{ checked: number; sent: number }>(
        `${BASE}/reminders/check`,
        payload ?? {},
      );
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
