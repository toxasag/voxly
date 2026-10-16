"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import type { ColumnLayout } from "@/components/crm/shared/use-record-table-layout";

// ---------------------------------------------------------------------------
// Раскладка колонок таблицы записей на сервере.
//
// До этого ширины, порядок и видимость жили только в localStorage: на другом
// браузере или после очистки хранилища таблица возвращалась к умолчаниям.
// Сервер хранит раскладку по паре tenant+user, поэтому она следует за
// сотрудником, а не за устройством.
//
// Query-кэш описывает только серверное состояние: localStorage сюда не
// подмешивается, иначе «нет сети» выглядело бы как «на сервере есть раскладка».
// ---------------------------------------------------------------------------

export type CrmRecordTableId = "contacts" | "companies" | "deals" | "tasks";

export interface RecordTableLayoutDTO {
  tableId: CrmRecordTableId;
  layout: ColumnLayout;
  updatedAt: string;
}

export const recordTableLayoutKeys = {
  all: ["record-table-layouts"] as const,
  detail: (tableId: CrmRecordTableId) => [...recordTableLayoutKeys.all, tableId] as const,
};

const BASE = "/api/v1/crm/table-layouts";

export function useRecordTableLayoutQuery(
  tableId: CrmRecordTableId | undefined,
): UseQueryResult<RecordTableLayoutDTO | null, ApiClientError> {
  return useQuery({
    queryKey: recordTableLayoutKeys.detail(tableId ?? "contacts"),
    queryFn: async () =>
      (await apiClient.get<RecordTableLayoutDTO | null>(`${BASE}/${tableId ?? ""}`)).data,
    enabled: tableId !== undefined,
    staleTime: 60_000,
  });
}

export function useSaveRecordTableLayout(): UseMutationResult<
  RecordTableLayoutDTO,
  ApiClientError,
  { tableId: CrmRecordTableId; layout: ColumnLayout }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tableId, layout }) =>
      (await apiClient.put<RecordTableLayoutDTO>(`${BASE}/${tableId}`, layout)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(recordTableLayoutKeys.detail(data.tableId), data);
    },
  });
}
