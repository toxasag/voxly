"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export type ActivityChannel =
  | "web_widget"
  | "web_form"
  | "telegram"
  | "whatsapp"
  | "max"
  | "call"
  | "crm";

export type ActivityKind =
  | "widget_launch"
  | "form_submission"
  | "im_session_inbound"
  | "im_session_outbound"
  | "note"
  | "task"
  | "stage_change";

export interface ContactActivityItemDTO {
  id: string;
  type: ActivityKind | string;
  activityChannel: ActivityChannel | string;
  activityKind: ActivityKind | string;
  direction?: "inbound" | "outbound" | null;
  timestamp: string;
  title: string;
  description?: string;
  authorName?: string;
  clientHandle?: string;
  dealId?: string;
  dealTitle?: string;
  payload: Record<string, unknown>;
}

export interface ContactTimelineFilterParams {
  channel?: ActivityChannel;
  kind?: ActivityKind;
  dealId?: string;
  limit?: number;
  offset?: number;
}

export interface ContactTimelineResponse {
  items: ContactActivityItemDTO[];
  total: number;
  limit: number;
  offset: number;
}

export const contactTimelineKeys = {
  all: ["contacts", "timeline"] as const,
  detail: (contactId: string, params?: ContactTimelineFilterParams) =>
    ["contacts", contactId, "timeline", params] as const,
};

export function useContactTimeline(
  contactId: string | null | undefined,
  params?: ContactTimelineFilterParams,
) {
  return useQuery({
    queryKey: contactTimelineKeys.detail(contactId ?? "", params),
    queryFn: async (): Promise<ContactTimelineResponse> => {
      if (!contactId) {
        return { items: [], total: 0, limit: 50, offset: 0 };
      }
      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.offset) searchParams.set("offset", String(params.offset));
      if (params?.channel) searchParams.set("channel", params.channel);
      if (params?.kind) searchParams.set("kind", params.kind);
      if (params?.dealId) searchParams.set("deal_id", params.dealId);

      const qs = searchParams.toString();
      const url = `/api/v1/crm/contacts/${contactId}/timeline${qs ? `?${qs}` : ""}`;
      const res = await apiClient.get<{
        data: ContactActivityItemDTO[];
        meta: { total: number; limit: number; offset: number };
      }>(url);

      const raw = res.data;
      const data = (raw as any)?.data ?? [];
      const meta = (raw as any)?.meta ?? {};

      return {
        items: data,
        total: typeof meta.total === "number" ? meta.total : data.length,
        limit: meta.limit ?? 50,
        offset: meta.offset ?? 0,
      };
    },
    enabled: Boolean(contactId),
  });
}
