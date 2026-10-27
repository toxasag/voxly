"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export interface DealContactSummaryDTO {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  companyName: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
}

export interface DealOtherDealItemDTO {
  id: string;
  title: string;
  budget: number;
  currency: string;
  stageId: string;
  stageName: string;
  stageColor: string;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
  closedAt: string | null;
}

export interface DealContactTimelineItemDTO {
  id: string;
  type: "note" | "task" | "message" | "stage_change" | "deal_created";
  dealId?: string;
  dealTitle?: string;
  timestamp: string;
  title: string;
  description?: string;
  authorName?: string;
  metadata?: Record<string, unknown>;
}

export interface DealContactHistoryDTO {
  dealId: string;
  contact: DealContactSummaryDTO | null;
  metrics: {
    totalDeals: number;
    wonDeals: number;
    lostDeals: number;
    activeDeals: number;
    totalLtv: number;
    avgCheck: number;
    isRepeatClient: boolean;
  };
  otherDeals: DealOtherDealItemDTO[];
  timeline: DealContactTimelineItemDTO[];
}

export const dealContactHistoryKeys = {
  all: ["deals", "contact-history"] as const,
  detail: (dealId: string) => ["deals", dealId, "contact-history"] as const,
};

export function useDealContactHistory(dealId: string | null | undefined) {
  return useQuery({
    queryKey: dealContactHistoryKeys.detail(dealId ?? ""),
    queryFn: async (): Promise<DealContactHistoryDTO> => {
      if (!dealId) {
        return {
          dealId: "",
          contact: null,
          metrics: {
            totalDeals: 0,
            wonDeals: 0,
            lostDeals: 0,
            activeDeals: 0,
            totalLtv: 0,
            avgCheck: 0,
            isRepeatClient: false,
          },
          otherDeals: [],
          timeline: [],
        };
      }
      const res = await apiClient.get<DealContactHistoryDTO>(
        `/api/v1/crm/deals/${dealId}/contact-history`,
      );
      const payload = (res.data as any)?.data ?? res.data;
      return payload;
    },
    enabled: Boolean(dealId),
  });
}
