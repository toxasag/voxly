"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export interface StageRuleDTO {
  id: string;
  tenantId: string;
  pipelineId: string | null;
  stageId: string | null;
  channelAccountId: string | null;
  channel: string;
  name: string;
  delaySeconds: number;
  templateText: string;
  mediaUrl: string | null;
  mediaType: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStageRulePayload {
  pipelineId?: string | null;
  stageId: string;
  channelAccountId?: string | null;
  channel?: string;
  name: string;
  delaySeconds?: number;
  templateText: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isActive?: boolean;
}

export const STAGE_RULES_QUERY_KEY = ["stage-rules"] as const;
const BASE_PATH = "/api/v1/crm/stage-rules";

export function useStageRules(stageId?: string): UseQueryResult<StageRuleDTO[], ApiClientError> {
  const qs = stageId ? `?stageId=${encodeURIComponent(stageId)}` : "";
  return useQuery({
    queryKey: [...STAGE_RULES_QUERY_KEY, stageId],
    queryFn: async () => {
      const res = await apiClient.get<StageRuleDTO[]>(`${BASE_PATH}${qs}`);
      return res.data;
    },
  });
}

export function useCreateStageRule(): UseMutationResult<StageRuleDTO, ApiClientError, CreateStageRulePayload> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<StageRuleDTO>(BASE_PATH, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STAGE_RULES_QUERY_KEY });
    },
  });
}

export function useDeleteStageRule(): UseMutationResult<void, ApiClientError, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete<void>(`${BASE_PATH}/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STAGE_RULES_QUERY_KEY });
    },
  });
}
