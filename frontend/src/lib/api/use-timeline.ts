"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";

export type TimelineRecordType = "deal" | "contact" | "company";
export type TimelineEventType = "message" | "note" | "task" | "stage_change";

export interface TimelineEventDTO {
  id: string;
  type: TimelineEventType;
  createdAt: string;
  authorId?: string | null;
  authorName?: string | null;
  data: Record<string, unknown>;
}

export interface TimelineListResult {
  items: TimelineEventDTO[];
  total: number;
  limit: number;
  offset: number;
}

export const timelineKeys = {
  all: ["timeline"] as const,
  record: (type: TimelineRecordType, id: string) => ["timeline", type, id] as const,
};

export function useRecordTimeline(
  type: TimelineRecordType,
  id: string | null,
  options?: { limit?: number; offset?: number },
): UseQueryResult<TimelineListResult, ApiClientError> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return useQuery<TimelineListResult, ApiClientError>({
    queryKey: [...timelineKeys.record(type, id ?? ""), { limit, offset }],
    queryFn: async () => {
      const response = await apiClient.get<TimelineEventDTO[]>(
        `/api/v1/crm/records/${type}/${id}/timeline`,
        { query: { limit, offset } },
      );
      const meta: ApiMeta = response.meta ?? {};
      return {
        items: response.data,
        total: typeof meta.total === "number" ? meta.total : response.data.length,
        limit: typeof meta.limit === "number" ? meta.limit : limit,
        offset: typeof meta.offset === "number" ? meta.offset : offset,
      };
    },
    enabled: id !== null && id.length > 0,
  });
}
