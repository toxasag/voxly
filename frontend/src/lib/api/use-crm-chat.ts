"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

export type ChatMessageSource = "human" | "manager" | "client" | "ai" | "ai_bot" | "system";
export type ChatMessageDirection = "inbound" | "outbound" | "neutral";
export type ChatDeliveryStatus = "neutral" | "pending" | "sent" | "failed";

export interface ChatMessageDTO {
  id: string;
  dealId?: string;
  contactId?: string;
  channelAccountId: string | null;
  source: ChatMessageSource;
  direction: ChatMessageDirection;
  senderName: string;
  content: string;
  channel: string;
  attachment: string | null;
  attachmentType: string | null;
  deliveryStatus: ChatDeliveryStatus;
  deliveryError: string | null;
  createdAt: string;
}

export interface SendFromOptionDTO {
  channelAccountId: string;
  channel: string;
  label?: string;
  accountName: string;
  isDefault: boolean;
  available: boolean;
  unavailableReason?: string;
}

export interface AiStatusDTO {
  aiControl: "enabled" | "paused" | "disabled";
  isPaused: boolean;
  pausedUntil: string | null;
  pausedReason: string | null;
}

export type AiControlAction = "enable" | "pause" | "disable";

export interface AiDraftResponseDTO {
  draft: string;
}

export interface SendChatMessagePayload {
  content: string;
  channel: string;
  channel_account_id?: string;
  source?: ChatMessageSource;
  direction?: ChatMessageDirection;
  attachment?: string;
  attachment_type?: string;
}

export const crmChatKeys = {
  all: ["crm-chat"] as const,
  deal: {
    messages: (dealId: string) => ["crm-chat", "deal", dealId, "messages"] as const,
    sendFromOptions: (dealId: string) => ["crm-chat", "deal", dealId, "send-from"] as const,
    aiStatus: (dealId: string) => ["crm-chat", "deal", dealId, "ai-status"] as const,
  },
  contact: {
    messages: (contactId: string) => ["crm-chat", "contact", contactId, "messages"] as const,
    sendFromOptions: (contactId: string) => ["crm-chat", "contact", contactId, "send-from"] as const,
    aiStatus: (contactId: string) => ["crm-chat", "contact", contactId, "ai-status"] as const,
  },
};

// ---------------------------------------------------------------------------
// Хуки для сделок
// ---------------------------------------------------------------------------

export function useDealChatMessages(
  dealId: string,
  options?: { live?: boolean; intervalMs?: number },
): UseQueryResult<ChatMessageDTO[], ApiClientError> {
  const live = options?.live ?? false;
  const intervalMs = options?.intervalMs ?? 4000;

  return useQuery({
    queryKey: crmChatKeys.deal.messages(dealId),
    queryFn: async () => {
      const response = await apiClient.get<ChatMessageDTO[]>(
        `/api/v1/crm/deals/${dealId}/messages`,
      );
      return response.data;
    },
    enabled: dealId.length > 0,
    refetchInterval: live ? intervalMs : false,
  });
}

export function useDealSendFromOptions(
  dealId: string,
): UseQueryResult<SendFromOptionDTO[], ApiClientError> {
  return useQuery({
    queryKey: crmChatKeys.deal.sendFromOptions(dealId),
    queryFn: async () => {
      const response = await apiClient.get<SendFromOptionDTO[]>(
        `/api/v1/crm/deals/${dealId}/send-from-options`,
      );
      return response.data;
    },
    enabled: dealId.length > 0,
  });
}

export function useDealAiStatus(
  dealId: string,
): UseQueryResult<AiStatusDTO, ApiClientError> {
  return useQuery({
    queryKey: crmChatKeys.deal.aiStatus(dealId),
    queryFn: async () => {
      const response = await apiClient.get<AiStatusDTO>(
        `/api/v1/crm/deals/${dealId}/ai-status`,
      );
      return response.data;
    },
    enabled: dealId.length > 0,
    refetchInterval: 5000,
  });
}

export function useDealAiControl(dealId: string): UseMutationResult<
  AiStatusDTO,
  ApiClientError,
  { action: AiControlAction }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action }) => {
      const response = await apiClient.post<AiStatusDTO>(
        `/api/v1/crm/deals/${dealId}/ai-control`,
        { action },
      );
      return response.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(crmChatKeys.deal.aiStatus(dealId), data);
      void qc.invalidateQueries({ queryKey: crmChatKeys.deal.messages(dealId) });
    },
  });
}

export function useDealAiDraft(dealId: string): UseMutationResult<
  AiDraftResponseDTO,
  ApiClientError,
  void
> {
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<AiDraftResponseDTO>(
        `/api/v1/crm/deals/${dealId}/ai-draft`,
        {},
      );
      return response.data;
    },
  });
}

export function useSendDealChatMessage(dealId: string): UseMutationResult<
  ChatMessageDTO,
  ApiClientError,
  SendChatMessagePayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const response = await apiClient.post<ChatMessageDTO>(
        `/api/v1/crm/deals/${dealId}/messages`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmChatKeys.deal.messages(dealId) });
      void qc.invalidateQueries({ queryKey: crmChatKeys.deal.aiStatus(dealId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Хуки для контактов
// ---------------------------------------------------------------------------

export function useContactChatMessages(
  contactId: string,
  options?: { live?: boolean; intervalMs?: number },
): UseQueryResult<ChatMessageDTO[], ApiClientError> {
  const live = options?.live ?? false;
  const intervalMs = options?.intervalMs ?? 4000;

  return useQuery({
    queryKey: crmChatKeys.contact.messages(contactId),
    queryFn: async () => {
      const response = await apiClient.get<ChatMessageDTO[]>(
        `/api/v1/crm/contacts/${contactId}/messages`,
      );
      return response.data;
    },
    enabled: contactId.length > 0,
    refetchInterval: live ? intervalMs : false,
  });
}

export function useContactSendFromOptions(
  contactId: string,
): UseQueryResult<SendFromOptionDTO[], ApiClientError> {
  return useQuery({
    queryKey: crmChatKeys.contact.sendFromOptions(contactId),
    queryFn: async () => {
      const response = await apiClient.get<SendFromOptionDTO[]>(
        `/api/v1/crm/contacts/${contactId}/send-from-options`,
      );
      return response.data;
    },
    enabled: contactId.length > 0,
  });
}

export function useContactAiStatus(
  contactId: string,
): UseQueryResult<AiStatusDTO, ApiClientError> {
  return useQuery({
    queryKey: crmChatKeys.contact.aiStatus(contactId),
    queryFn: async () => {
      const response = await apiClient.get<AiStatusDTO>(
        `/api/v1/crm/contacts/${contactId}/ai-status`,
      );
      return response.data;
    },
    enabled: contactId.length > 0,
    refetchInterval: 5000,
  });
}

export function useContactAiControl(contactId: string): UseMutationResult<
  AiStatusDTO,
  ApiClientError,
  { action: AiControlAction }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action }) => {
      const response = await apiClient.post<AiStatusDTO>(
        `/api/v1/crm/contacts/${contactId}/ai-control`,
        { action },
      );
      return response.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(crmChatKeys.contact.aiStatus(contactId), data);
      void qc.invalidateQueries({ queryKey: crmChatKeys.contact.messages(contactId) });
    },
  });
}

export function useContactAiDraft(contactId: string): UseMutationResult<
  AiDraftResponseDTO,
  ApiClientError,
  void
> {
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<AiDraftResponseDTO>(
        `/api/v1/crm/contacts/${contactId}/ai-draft`,
        {},
      );
      return response.data;
    },
  });
}

export function useSendContactChatMessage(contactId: string): UseMutationResult<
  ChatMessageDTO,
  ApiClientError,
  SendChatMessagePayload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const response = await apiClient.post<ChatMessageDTO>(
        `/api/v1/crm/contacts/${contactId}/messages`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmChatKeys.contact.messages(contactId) });
      void qc.invalidateQueries({ queryKey: crmChatKeys.contact.aiStatus(contactId) });
    },
  });
}

export function useSyncDealChatHistory(dealId: string): UseMutationResult<
  { ok: boolean; synced: number },
  ApiClientError,
  void
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<{ ok: boolean; synced: number }>(
        `/api/v1/crm/deals/${dealId}/sync-chat-history`,
        {},
      );
      return response.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmChatKeys.deal.messages(dealId) });
      void qc.invalidateQueries({ queryKey: crmChatKeys.deal.sendFromOptions(dealId) });
    },
  });
}

export function useSyncContactChatHistory(contactId: string): UseMutationResult<
  { ok: boolean; synced: number },
  ApiClientError,
  void
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<{ ok: boolean; synced: number }>(
        `/api/v1/crm/contacts/${contactId}/sync-chat-history`,
        {},
      );
      return response.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmChatKeys.contact.messages(contactId) });
      void qc.invalidateQueries({ queryKey: crmChatKeys.contact.sendFromOptions(contactId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Унифицированный хук чата для CrmChatView
// ---------------------------------------------------------------------------

export type CrmChatEntityType = "deal" | "contact";

export interface UseCrmChatOptions {
  entityType: CrmChatEntityType;
  entityId: string;
  live?: boolean;
}

export function useCrmChat({ entityType, entityId, live = true }: UseCrmChatOptions) {
  const isDeal = entityType === "deal";

  const dealMessages = useDealChatMessages(isDeal ? entityId : "", { live: live && isDeal });
  const contactMessages = useContactChatMessages(!isDeal ? entityId : "", { live: live && !isDeal });

  const dealSendFrom = useDealSendFromOptions(isDeal ? entityId : "");
  const contactSendFrom = useContactSendFromOptions(!isDeal ? entityId : "");

  const dealAiStatus = useDealAiStatus(isDeal ? entityId : "");
  const contactAiStatus = useContactAiStatus(!isDeal ? entityId : "");

  const dealSend = useSendDealChatMessage(isDeal ? entityId : "");
  const contactSend = useSendContactChatMessage(!isDeal ? entityId : "");

  const dealAiControl = useDealAiControl(isDeal ? entityId : "");
  const contactAiControl = useContactAiControl(!isDeal ? entityId : "");

  const dealAiDraft = useDealAiDraft(isDeal ? entityId : "");
  const contactAiDraft = useContactAiDraft(!isDeal ? entityId : "");

  const dealSyncHistory = useSyncDealChatHistory(isDeal ? entityId : "");
  const contactSyncHistory = useSyncContactChatHistory(!isDeal ? entityId : "");

  return {
    messagesQuery: isDeal ? dealMessages : contactMessages,
    sendFromOptionsQuery: isDeal ? dealSendFrom : contactSendFrom,
    aiStatusQuery: isDeal ? dealAiStatus : contactAiStatus,
    sendMessageMutation: isDeal ? dealSend : contactSend,
    aiControlMutation: isDeal ? dealAiControl : contactAiControl,
    aiDraftMutation: isDeal ? dealAiDraft : contactAiDraft,
    syncHistoryMutation: isDeal ? dealSyncHistory : contactSyncHistory,
  };
}
