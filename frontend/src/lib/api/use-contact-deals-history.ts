"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export interface ContactDealItemDTO {
  id: string;
  title: string;
  budget: number;
  currency: string;
  stageId: string;
  stageName: string;
  stageColorKey: string;
  isWon: boolean;
  isLost: boolean;
  pipelineId: string;
  pipelineName: string;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  closedAt: string | null;
  daysInPipeline: number;
}

export interface ContactDealsHistoryDTO {
  deals: ContactDealItemDTO[];
  metrics: {
    totalDeals: number;
    wonDeals: number;
    lostDeals: number;
    openDeals: number;
    totalBudget: number;
    wonRevenue: number;
    ltv: number;
    avgCheck: number;
    firstDealAt: string | null;
    lastDealAt: string | null;
    repeatCustomer: boolean;
  };
}

export const contactDealsHistoryKeys = {
  all: ["contacts", "deals-history"] as const,
  detail: (contactId: string) => ["contacts", contactId, "deals-history"] as const,
};

export function useContactDealsHistory(contactId: string | null | undefined) {
  return useQuery({
    queryKey: contactDealsHistoryKeys.detail(contactId ?? ""),
    queryFn: async (): Promise<ContactDealsHistoryDTO> => {
      if (!contactId) {
        return {
          deals: [],
          metrics: {
            totalDeals: 0,
            wonDeals: 0,
            lostDeals: 0,
            openDeals: 0,
            totalBudget: 0,
            wonRevenue: 0,
            ltv: 0,
            avgCheck: 0,
            firstDealAt: null,
            lastDealAt: null,
            repeatCustomer: false,
          },
        };
      }
      const res = await apiClient.get<{ data: ContactDealsHistoryDTO }>(
        `/api/v1/crm/contacts/${contactId}/deals-history`,
      );
      return res.data.data;
    },
    enabled: Boolean(contactId),
  });
}
