"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// Вкладки карточек с сервера (этап 6).
//
// Состав, порядок и условия показа живут в `page_layout_tabs`. React-компонент
// вкладки остаётся в коде — фабрика «tabKey → содержимое» на карточке.
// ---------------------------------------------------------------------------

export type PageLayoutObjectType = "contact" | "company" | "deal";

export interface PageLayoutTabDTO {
  tabKey: string;
  title: string;
  icon: string;
  position: number;
  isActive: boolean;
  moduleSlug: string | null;
  requiredPermission: string | null;
  updatedAt: string;
}

export interface UpdatePageLayoutTabPayload {
  title?: string;
  icon?: string;
  position?: number;
  isActive?: boolean;
}

export const pageLayoutTabKeys = {
  all: ["page-layout-tabs"] as const,
  list: (objectType: PageLayoutObjectType) =>
    [...pageLayoutTabKeys.all, objectType] as const,
};

const BASE = "/api/v1/crm/page-layouts";

export function usePageLayoutTabs(
  objectType: PageLayoutObjectType | undefined,
): UseQueryResult<PageLayoutTabDTO[], ApiClientError> {
  return useQuery({
    queryKey: pageLayoutTabKeys.list(objectType ?? "contact"),
    queryFn: async () =>
      (await apiClient.get<PageLayoutTabDTO[]>(`${BASE}/${objectType ?? ""}/tabs`)).data,
    enabled: objectType !== undefined,
    staleTime: 60_000,
  });
}

export function useUpdatePageLayoutTab(): UseMutationResult<
  PageLayoutTabDTO,
  ApiClientError,
  { objectType: PageLayoutObjectType; tabKey: string; payload: UpdatePageLayoutTabPayload }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ objectType, tabKey, payload }) =>
      (
        await apiClient.patch<PageLayoutTabDTO>(
          `${BASE}/${objectType}/tabs/${tabKey}`,
          payload,
        )
      ).data,
    onSuccess: (data, variables) => {
      queryClient.setQueryData<PageLayoutTabDTO[]>(
        pageLayoutTabKeys.list(variables.objectType),
        (previous) => {
          if (previous === undefined) return [data];
          return previous.map((tab) => (tab.tabKey === data.tabKey ? data : tab));
        },
      );
    },
  });
}
